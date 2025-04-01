const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatarColor: { type: String, default: '#4c6ef5' }, // Couleur par défaut
  avatarImage: { type: String, default: null }, // URL de l'image si uploadée
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);