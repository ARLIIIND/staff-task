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
const onlineUsers = new Set();
const projectUsers = {}; // Stockage des utilisateurs par projet


// MongoDB Connection
const MONGODB_URI = 'mongodb+srv://blowreed:h6QFs9my0TpKnNzh@staff-task-cluster.vfvjy.mongodb.net/staff-task?retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connecté à MongoDB Atlas'))
  .catch(err => console.error('Erreur de connexion à MongoDB:', err));

// Définition des schémas et modèles
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { 
    type: String, 
    default: null 
  },
  avatarColor: { 
    type: String, 
    default: function() {
      // Couleur par défaut basée sur la première lettre du nom d'utilisateur
      const firstLetter = this.username.charAt(0).toUpperCase();
      return getUserColor(firstLetter);
    }
  },
  resetToken: { type: String, default: null },
  resetTokenExpires: { type: Date, default: null }
});


// Fonction pour générer une couleur d'avatar basée sur la première lettre
function getUserColor(letter) {
  const colors = {
    'A': '#4c6ef5', 'B': '#845ef7', 'C': '#339af0', 'D': '#f06595',
    'E': '#ff922b', 'F': '#e64980', 'G': '#51cf66', 'H': '#22b8cf',
    'I': '#be4bdb', 'J': '#aa8a00', 'K': '#82c91e', 'L': '#4dabf7',
    'M': '#20c997', 'N': '#868e96', 'O': '#e67700', 'P': '#5f3dc4',
    'Q': '#c2255c', 'R': '#fa5252', 'S': '#fab005', 'T': '#fd7e14',
    'U': '#0b7285', 'V': '#1098ad', 'W': '#9c36b5', 'X': '#f03e3e',
    'Y': '#1864ab', 'Z': '#e03131'
  };
  
  return colors[letter] || '#4c6ef5'; // Couleur par défaut si la lettre n'est pas trouvée
}

const mailjet = require('node-mailjet').apiConnect(
  process.env.MJ_APIKEY_PUBLIC || 'votre-api-key',
  process.env.MJ_APIKEY_PRIVATE || 'votre-secret-key'
);

const crypto = require('crypto');



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
    origin: ['https://staff-task.onrender.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
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

// Route pour les pages avec extension .html (compatibilité)
app.get('/:page.html', (req, res) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, 'public', `${page}.html`);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.redirect('/');
  }
});

// Route pour les pages sans extension
app.get('/:page', (req, res) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, 'public', `${page}.html`);
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.redirect('/');
  }
});

// Routes API

// Modifier la route d'inscription pour inclure l'email
app.post('/api/register', async (req, res) => {
  console.log('Requête /api/register reçue:', req.body);
  const { username, email, password } = req.body;
  if (!username || !password || !email) return res.status(400).json({ error: 'Champ manquant' });

  // Validation de l'email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) return res.status(400).json({ error: 'Email invalide' });
  
  try {
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      if (existingUser.username === username) {
        return res.status(400).json({ error: 'Nom d\'utilisateur déjà utilisé' });
      } else {
        return res.status(400).json({ error: 'Email déjà utilisé' });
      }
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const avatarColor = getUserColor(username.charAt(0).toUpperCase());
    
    await User.create({ 
      username, 
      email,
      password: hashedPassword,
      avatarColor
    });
    
    res.status(201).json({ message: 'Utilisateur créé' });
  } catch (error) {
    console.error('Erreur lors de l\'inscription:', error);
    res.status(500).json({ error: 'Erreur lors de l\'inscription' });
  }
});

// Route pour la demande de réinitialisation de mot de passe
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email manquant' });

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    // Génération du token de réinitialisation
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 3600000); // 1 heure

    // Mise à jour de l'utilisateur avec le token
    user.resetToken = resetToken;
    user.resetTokenExpires = resetTokenExpires;
    await user.save();

    // Envoi de l'email de réinitialisation avec Mailjet
    const resetLink = `${req.headers.origin}/reset-password?token=${resetToken}`;
    
    const request = mailjet.post("send", { version: "v3.1" }).request({
      Messages: [
        {
          From: {
            Email: "staffntask@gmail.com",
            Name: "Staff&Task"
          },
          To: [
            {
              Email: user.email,
              Name: user.username
            }
          ],
          Subject: "Réinitialisation de mot de passe Staff&Task",
          TextPart: `Vous recevez cet email car vous (ou quelqu'un d'autre) avez demandé la réinitialisation du mot de passe de votre compte.
            Veuillez cliquer sur le lien suivant, ou le coller dans votre navigateur pour terminer le processus:
            ${resetLink}
            Si vous n'avez pas demandé cela, veuillez ignorer cet email et votre mot de passe restera inchangé.`
        }
      ]
    });
    
    await request;
    res.json({ message: 'Un email de réinitialisation a été envoyé à ' + user.email });
  } catch (error) {
    console.error('Erreur lors de la demande de réinitialisation:', error);
    res.status(500).json({ error: 'Erreur lors de la demande de réinitialisation' });
  }
});

// Route pour réinitialiser le mot de passe avec le token
app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Données manquantes' });

  try {
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: Date.now() }
    });

    if (!user) return res.status(400).json({ error: 'Token invalide ou expiré' });

    // Mise à jour du mot de passe
    user.password = await bcrypt.hash(password, 10);
    user.resetToken = null;
    user.resetTokenExpires = null;
    await user.save();

    res.json({ message: 'Mot de passe réinitialisé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la réinitialisation du mot de passe:', error);
    res.status(500).json({ error: 'Erreur lors de la réinitialisation du mot de passe' });
  }
});

app.post('/api/change-password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }
  
  try {
    const user = await User.findOne({ username: req.user });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
    
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    
    res.json({ message: 'Mot de passe mis à jour avec succès' });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du mot de passe:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du mot de passe' });
  }
});

app.post('/api/update-profile', authMiddleware, async (req, res) => {
  const { newUsername, avatarColor, avatar } = req.body;
  
  try {
    const user = await User.findOne({ username: req.user });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    // Mettre à jour uniquement les champs fournis
    if (newUsername && newUsername !== user.username) {
      const existingUsername = await User.findOne({ username: newUsername });
      if (existingUsername) return res.status(400).json({ error: 'Nom d\'utilisateur déjà utilisé' });
      user.username = newUsername;
    }
    
    if (avatarColor) user.avatarColor = avatarColor;
    if (avatar !== undefined) user.avatar = avatar;
    
    await user.save();
    
    res.json({ 
      message: 'Profil mis à jour avec succès',
      user: {
        username: user.username,
        email: user.email,
        avatarColor: user.avatarColor,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du profil:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du profil' });
  }
});

// Route pour mettre à jour le profil utilisateur
app.post('/api/profile', authMiddleware, async (req, res) => {
  const { username, avatarColor, avatar } = req.body;
  
  try {
    const user = await User.findOne({ username: req.user });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    // Mettre à jour uniquement les champs fournis
    if (username && username !== user.username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) return res.status(400).json({ error: 'Nom d\'utilisateur déjà utilisé' });
      user.username = username;
    }
    
    if (avatarColor) user.avatarColor = avatarColor;
    if (avatar !== undefined) user.avatar = avatar; // Accepter aussi null pour réinitialiser
    
    await user.save();
    
    res.json({ 
      message: 'Profil mis à jour avec succès',
      user: {
        username: user.username,
        email: user.email,
        avatarColor: user.avatarColor,
        avatar: user.avatar
      }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du profil:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du profil' });
  }
});

// Route pour mettre à jour les paramètres utilisateur (email et mot de passe)
app.post('/api/settings', authMiddleware, async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  
  try {
    const user = await User.findOne({ username: req.user });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    // Vérifier le mot de passe actuel si on souhaite le modifier
    if (newPassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Mot de passe actuel manquant' });
      
      const isValidPassword = await bcrypt.compare(currentPassword, user.password);
      if (!isValidPassword) return res.status(401).json({ error: 'Mot de passe actuel incorrect' });
      
      user.password = await bcrypt.hash(newPassword, 10);
    }
    
    // Mettre à jour l'email si fourni
    if (email && email !== user.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ error: 'Email invalide' });
      
      const existingEmail = await User.findOne({ email });
      if (existingEmail) return res.status(400).json({ error: 'Email déjà utilisé' });
      
      user.email = email;
    }
    
    await user.save();
    
    res.json({ 
      message: 'Paramètres mis à jour avec succès',
      user: {
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Erreur lors de la mise à jour des paramètres:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour des paramètres' });
  }
});

// Route pour obtenir les informations du profil utilisateur
app.get('/api/profile', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.user });
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    
    res.json({
      username: user.username,
      email: user.email,
      avatarColor: user.avatarColor,
      avatar: user.avatar
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du profil:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Augmenter la route d'informations utilisateurs pour inclure les couleurs et avatars
app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({}, 'username avatarColor avatar');
    res.json(users);
  } catch (error) {
    console.error('Erreur lors du chargement des utilisateurs:', error);
    res.status(500).json({ error: 'Erreur serveur' });
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
        // Rechercher des documents dont l'ID commence par "template-"
        const templates = await Project.find({ id: { $regex: /^template-/ } });
        console.log("Templates trouvés:", templates.length);
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

io.on('connection', (socket) => {
    console.log('Utilisateur connecté via Socket.IO');
    let currentProject = null;
    const username = socket.handshake.query.username;
    
    // Quand un utilisateur rejoint un projet
    socket.on('joinProject', (projectId) => {
        // Si l'utilisateur était déjà dans un projet, le quitter
        if (currentProject && projectUsers[currentProject]) {
            projectUsers[currentProject] = projectUsers[currentProject].filter(user => user !== username);
            
            // Informer les autres utilisateurs qu'il a quitté
            io.to(currentProject).emit('projectUsers', projectUsers[currentProject]);
        }
        
        // Rejoindre le nouveau projet
        socket.join(projectId);
        currentProject = projectId;
        
        // Initialiser le tableau d'utilisateurs si nécessaire
        if (!projectUsers[projectId]) {
            projectUsers[projectId] = [];
        }
        
        // Ajouter l'utilisateur s'il n'est pas déjà présent
        if (!projectUsers[projectId].includes(username)) {
            projectUsers[projectId].push(username);
        }
        
        // Informer tous les membres du projet des utilisateurs actuellement connectés
        io.to(projectId).emit('projectUsers', projectUsers[projectId]);
        
        console.log(`Utilisateur ${username} a rejoint le projet ${projectId}`);
    });
    
    // Quand un utilisateur se déconnecte
    socket.on('disconnect', () => {
        console.log(`Utilisateur ${username} déconnecté`);
        
        // Si l'utilisateur était dans un projet, le retirer de la liste
        if (currentProject && projectUsers[currentProject]) {
            projectUsers[currentProject] = projectUsers[currentProject].filter(user => user !== username);
            
            // Informer les autres utilisateurs
            io.to(currentProject).emit('projectUsers', projectUsers[currentProject]);
        }
    });
    
    // Quand un utilisateur quitte explicitement un projet
    socket.on('leaveProject', (projectId) => {
        if (projectUsers[projectId]) {
            projectUsers[projectId] = projectUsers[projectId].filter(user => user !== username);
            socket.leave(projectId);
            io.to(projectId).emit('projectUsers', projectUsers[projectId]);
            currentProject = null;
        }
    });
    
    // Pour les mises à jour du tableau
    socket.on('boardUpdate', (data) => {
        socket.to(data.projectId).emit('boardUpdate', data);
    });
});

// Function pour garder le serveur actif (auto-ping)
function keepAlive() {
    setInterval(() => {
        http.get(`https://staff-task.onrender.com/ping`, (res) => {
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