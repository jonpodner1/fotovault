require('dotenv').config();
const express = require('express');
const cors = require('cors');

const photosRouter = require('./routes/photos');
const albumsRouter = require('./routes/albums');
const usersRouter = require('./routes/users');
const configRouter = require('./routes/config');

const app = express();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/photos', photosRouter);
app.use('/api/albums', albumsRouter);
app.use('/api/users', usersRouter);
app.use('/api/config', configRouter);

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 FotoVault backend running on port ${PORT}`);
});
