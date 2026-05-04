require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { db } = require('./services/firebase');
const { startLogger, logEvent } = require('./services/logger');

const photosRouter = require('./routes/photos');
const albumsRouter = require('./routes/albums');
const usersRouter = require('./routes/users');
const configRouter = require('./routes/config');
const { router: syncRouter } = require('./routes/sync');
const sharesRouter = require('./routes/shares');
const cleanupRouter = require('./routes/cleanup');
const logsRouter = require('./routes/logs');

const app = express();

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── IP HELPER ────────────────────────────────────────────────────────────────
function getIP(req) {
  return req.headers['cf-connecting-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress || '';
}

// ─── LOGIN LOGGING MIDDLEWARE ─────────────────────────────────────────────────
app.use('/api/users/register', (req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (data) => {
    if (data && data.uid && req.user) {
      logEvent({
        type: 'user_login',
        userEmail: req.user.email,
        userName: req.user.displayName || req.user.email,
        role: req.user.role || 'user',
        ip: getIP(req),
        details: 'User registered/logged in',
      });
    }
    return origJson(data);
  };
  next();
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/api/photos', photosRouter);
app.use('/api/albums', albumsRouter);
app.use('/api/users', usersRouter);
app.use('/api/config', configRouter);
app.use('/api/sync', syncRouter);
app.use('/api/shares', sharesRouter);
app.use('/api/cleanup', cleanupRouter);
app.use('/api/logs', logsRouter);

// ─── ERROR HANDLER ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;

// ─── AUTO SYNC SCHEDULE ───────────────────────────────────────────────────────
const { runSync } = require('./routes/sync');
const SYNC_INTERVAL_MINUTES = 15;
setInterval(async () => {
  try {
    const configDoc = await db.collection('config').doc('app_config').get();
    const autoSyncEnabled = configDoc.exists ? configDoc.data().autoSyncEnabled : true;
    if (!autoSyncEnabled) return;
    console.log('⏱  Running scheduled Wasabi import sync...');
    const results = await runSync();
    if (results.processed > 0) {
      console.log('✓ Sync complete: ' + results.processed + ' imported, ' + results.skipped + ' skipped');
    }
  } catch (err) {
    console.error('Scheduled sync error:', err.message);
  }
}, SYNC_INTERVAL_MINUTES * 60 * 1000);

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('🚀 FotoVault backend running on port ' + PORT);
  startLogger();
});

// Export logEvent for use in route files
module.exports = { logEvent, getIP };
