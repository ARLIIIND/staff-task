const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://blowreed:h6QFs9my0TpKnNzh@staff-task-cluster.vfvjy.mongodb.net/?retryWrites=true&w=majority&appName=staff-task-cluster';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connecté à MongoDB Atlas'))
  .catch(err => console.error('Erreur de connexion à MongoDB:', err));

// Définition des schémas et modèles
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

const projectSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  title: { type: String, required: true },
  members: [String],
  columns: [mongoose.Schema.Types.Mixed]
});

const User = mongoose.model('User', userSchema);
const Project = mongoose.model('Project', projectSchema);

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-username']
}));

// Servir les fichiers frontend statiques
app.use(express.static(path.join(__dirname, 'public')));

// Middleware d'authentification
async function authMiddleware(req, res, next) {
    const username = req.headers['x-username'];
    if (!username) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: 'Utilisateur invalide' });
    
    req.user = username;
    next();
}

// Route de ping pour garder le serveur actif
app.get('/ping', (req, res) => {
    console.log('Ping reçu pour garder le serveur actif');
    res.status(200).send('Serveur actif');
});

// Routes HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/:page.html', (req, res) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, 'public', `${page}.html`);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.redirect('/');
  }
});

// Routes API
app.post('/api/register', async (req, res) => {
    console.log('Requête /api/register reçue:', req.body);
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Champ manquant' });
    
    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Utilisateur déjà existant' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ username, password: hashedPassword });
        
        res.status(201).json({ message: 'Utilisateur créé' });
    } catch (error) {
        console.error('Erreur lors de l\'inscription:', error);
        res.status(500).json({ error: 'Erreur lors de l\'inscription' });
    }
});

app.post('/api/login', async (req, res) => {
    console.log('Requête /api/login reçue:', req.body);
    const { username, password } = req.body;
    
    try {
        const user = await User.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Identifiants invalides' });
        }
        res.json({ message: 'Connexion réussie', username });
    } catch (error) {
        console.error('Erreur lors de la connexion:', error);
        res.status(500).json({ error: 'Erreur lors de la connexion' });
    }
});

app.get('/api/projects', authMiddleware, async (req, res) => {
    try {
        const projects = await Project.find({ members: req.user });
        res.json(projects);
    } catch (error) {
        console.error('Erreur lors du chargement des projets:', error);
        res.status(500).json({ error: 'Erreur lors du chargement des projets' });
    }
});

app.post('/api/projects', authMiddleware, async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'Titre manquant' });
    
    try {
        const newProject = await Project.create({
            id: 'proj-' + Date.now(),
            title,
            members: [req.user],
            columns: []
        });
        
        res.status(201).json(newProject);
    } catch (error) {
        console.error('Erreur lors de la création du projet:', error);
        res.status(500).json({ error: 'Erreur lors de la création du projet' });
    }
});

app.post('/api/projects/:projectId/members', authMiddleware, async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Nom d\'utilisateur manquant' });
    
    try {
        const project = await Project.findOne({ id: req.params.projectId });
        if (!project) return res.status(404).json({ error: 'Projet non trouvé' });
        if (!project.members.includes(req.user)) return res.status(403).json({ error: 'Accès interdit' });
        
        const userExists = await User.findOne({ username });
        if (!userExists) return res.status(404).json({ error: 'Utilisateur non trouvé' });
        
        if (!project.members.includes(username)) {
            project.members.push(username);
            await project.save();
        }
        
        res.json({ members: project.members });
    } catch (error) {
        console.error('Erreur lors de l\'ajout du membre:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/board/:projectId', authMiddleware, async (req, res) => {
    try {
        const project = await Project.findOne({ id: req.params.projectId });
        if (!project) return res.status(404).json({ error: 'Projet non trouvé' });
        if (!project.members.includes(req.user)) return res.status(403).json({ error: 'Accès interdit' });
        
        res.json(project);
    } catch (error) {
        console.error('Erreur lors du chargement du tableau:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/board/:projectId', authMiddleware, async (req, res) => {
    try {
        const project = await Project.findOne({ id: req.params.projectId });
        if (!project) return res.status(404).json({ error: 'Projet non trouvé' });
        if (!project.members.includes(req.user)) return res.status(403).json({ error: 'Accès interdit' });
        
        // Mise à jour du projet avec les données envoyées
        if (req.body.title) project.title = req.body.title;
        if (req.body.columns) project.columns = req.body.columns;
        await project.save();
        
        // Notification Socket.IO
        io.emit('boardUpdate', { projectId: req.params.projectId, board: project });
        
        res.json({ message: 'Tableau sauvegardé avec succès' });
    } catch (error) {
        console.error('Erreur lors de la sauvegarde du tableau:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// API pour les templates
app.get('/api/templates', async (req, res) => {
    try {
        const templates = await Project.find({ isTemplate: true });
        res.json(templates);
    } catch (error) {
        console.error('Erreur lors du chargement des templates:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.post('/api/templates', authMiddleware, async (req, res) => {
    try {
        const templateData = req.body;
        templateData.id = 'template-' + Date.now();
        templateData.isTemplate = true;
        
        const newTemplate = await Project.create(templateData);
        res.status(201).json(newTemplate);
    } catch (error) {
        console.error('Erreur lors de la création du template:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.delete('/api/templates/:templateId', authMiddleware, async (req, res) => {
    try {
        await Project.deleteOne({ id: req.params.templateId, isTemplate: true });
        res.json({ message: 'Template supprimé avec succès' });
    } catch (error) {
        console.error('Erreur lors de la suppression du template:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// API pour obtenir la liste des utilisateurs
app.get('/api/users', authMiddleware, async (req, res) => {
    try {
        const users = await User.find({}, 'username');
        res.json(users);
    } catch (error) {
        console.error('Erreur lors du chargement des utilisateurs:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Utilisateur connecté via Socket.IO');
    socket.on('disconnect', () => {
        console.log('Utilisateur déconnecté');
    });
    
    socket.on('joinProject', (projectId) => {
        socket.join(projectId);
        console.log(`Utilisateur a rejoint le projet ${projectId}`);
    });
    
    socket.on('boardUpdate', (data) => {
        socket.to(data.projectId).emit('boardUpdate', data);
    });
});

// Function pour garder le serveur actif (auto-ping)
function keepAlive() {
    setInterval(() => {
        http.get(`http://localhost:${PORT}/ping`, (res) => {
            console.log(`Auto-ping effectué, statut: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`Erreur d'auto-ping: ${err.message}`);
        });
    }, 840000); // 14 minutes
}

// Utiliser le port fourni par Render ou 3000 localement
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
    if (process.env.NODE_ENV === 'production') {
        keepAlive();
    }
});