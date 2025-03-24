const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-username']
}));

// Servir les fichiers frontend statiques
app.use(express.static(path.join(__dirname, 'public')));

// Fichiers de données
const DB_DIR = path.join(__dirname, 'db');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const PROJECTS_FILE = path.join(DB_DIR, 'projects.json');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify([]));
if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, JSON.stringify([]));

// Fonctions utilitaires
function loadData(file) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function saveData(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Middleware d'authentification
function authMiddleware(req, res, next) {
    const username = req.headers['x-username'];
    if (!username) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const users = loadData(USERS_FILE);
    if (!users.some(u => u.username === username)) return res.status(401).json({ error: 'Utilisateur invalide' });
    req.user = username;
    next();
}

// Route de ping pour garder le serveur actif
app.get('/ping', (req, res) => {
    console.log('Ping reçu pour garder le serveur actif');
    res.status(200).send('Serveur actif');
});

// Route pour renvoyer index.html pour toutes les routes non-API (pour le frontend SPA)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route fallback pour les autres pages du frontend
app.get('/:page.html', (req, res) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, 'public', `${page}.html`);
  
  // Vérifie si le fichier existe
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
    const users = loadData(USERS_FILE);
    if (users.some(u => u.username === username)) return res.status(400).json({ error: 'Utilisateur déjà existant' });
    const hashedPassword = await bcrypt.hash(password, 10);
    users.push({ username, password: hashedPassword });
    saveData(USERS_FILE, users);
    res.status(201).json({ message: 'Utilisateur créé' });
});

app.post('/api/login', async (req, res) => {
    console.log('Requête /api/login reçue:', req.body);
    const { username, password } = req.body;
    const users = loadData(USERS_FILE);
    const user = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: 'Identifiants invalides' });
    }
    res.json({ message: 'Connexion réussie', username });
});

app.get('/api/projects', authMiddleware, (req, res) => {
    const projects = loadData(PROJECTS_FILE);
    const userProjects = projects.filter(p => p.members.includes(req.user));
    res.json(userProjects);
});

// Socket.IO
io.on('connection', (socket) => {
    console.log('Utilisateur connecté via Socket.IO');
    socket.on('disconnect', () => {
        console.log('Utilisateur déconnecté');
    });
});

// Function pour garder le serveur actif (auto-ping)
function keepAlive() {
    setInterval(() => {
        // On fait une requête à notre propre serveur
        http.get(`http://localhost:${PORT}/ping`, (res) => {
            console.log(`Auto-ping effectué, statut: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error(`Erreur d'auto-ping: ${err.message}`);
        });
    }, 840000); // 14 minutes (840000 ms)
}

// Utiliser le port fourni par Render ou 3000 localement
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT}`);
    // Démarre le auto-ping uniquement en production
    if (process.env.NODE_ENV === 'production') {
        keepAlive();
    }
});