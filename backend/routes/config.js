const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, requireRole } = require('../middleware/auth');

const CONFIG_DOC = 'app_config';

// ─── GET APP CONFIG (public - no auth required) ───────────────────────────────
router.get('/', async (req, res) => {
  try {
    const doc = await db.collection('config').doc(CONFIG_DOC).get();
    const defaults = {
      appName: 'FotoVault',
      tagline: 'Your photos. Your storage.',
      primaryColor: '#1a1a2e',
      accentColor: '#e94560',
      logoUrl: null,
      allowPublicBrowsing: false,
      allowGuestDownloads: false,
      maxUploadSizeMB: 50,
      defaultAlbumView: 'grid',
      watermarkEnabled: false,
      watermarkText: '',
    };
    res.json(doc.exists ? { ...defaults, ...doc.data() } : defaults);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ─── UPDATE APP CONFIG (admin only) ───────────────────────────────────────────
router.patch('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const allowed = [
      'appName', 'tagline', 'primaryColor', 'accentColor', 'logoUrl',
      'allowPublicBrowsing', 'allowGuestDownloads', 'maxUploadSizeMB',
      'defaultAlbumView', 'watermarkEnabled', 'watermarkText',
    ];

    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.updatedAt = new Date().toISOString();
    updates.updatedBy = req.user.uid;

    await db.collection('config').doc(CONFIG_DOC).set(updates, { merge: true });
    res.json({ success: true, config: updates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

module.exports = router;
