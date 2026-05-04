const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/firebase');
const { getPresignedUrl } = require('../services/wasabi');
const { authenticate, requireRole } = require('../middleware/auth');

function getIP(req) {
  return req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0] ||
    req.socket.remoteAddress || '';
}

// ─── CREATE SHARE LINK ────────────────────────────────────────────────────────
router.post('/', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { type, targetId, requiresLogin, allowDownload, expiresIn } = req.body;

    if (!type || !targetId) {
      return res.status(400).json({ error: 'type and targetId required' });
    }

    const token = uuidv4().replace(/-/g, '');
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    const share = {
      token,
      type,
      targetId,
      requiresLogin: requiresLogin || false,
      allowDownload: allowDownload !== false,
      expiresAt,
      createdBy: req.user.uid,
      creatorName: req.user.displayName,
      createdAt: new Date().toISOString(),
      views: 0,
    };

    await db.collection('shares').doc(token).set(share);

    // Log share created
    try {
      const { logEvent } = require('../server');
      logEvent({ type: 'share_created', userEmail: req.user.email, userName: req.user.displayName, role: req.user.role, targetId, targetName: type + ' share', ip: getIP(req), details: 'expires: ' + (expiresAt || 'never') });
    } catch {}

    res.json({ token, url: `${process.env.FRONTEND_URL}/share/${token}`, share });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// ─── GET SHARE LINK INFO (public) ─────────────────────────────────────────────
router.get('/:token', async (req, res) => {
  try {
    const doc = await db.collection('shares').doc(req.params.token).get();
    if (!doc.exists) return res.status(404).json({ error: 'Share link not found' });

    const share = doc.data();

    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return res.status(410).json({ error: 'This share link has expired' });
    }

    if (share.requiresLogin) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Login required to view this link', requiresLogin: true });
      }
    }

    await db.collection('shares').doc(req.params.token).update({
      views: (share.views || 0) + 1
    });

    // Log share accessed
    try {
      const { logEvent } = require('../server');
      logEvent({ type: 'share_accessed', userEmail: 'guest', userName: 'Guest', role: 'guest', targetId: share.targetId, targetName: share.type + ' share', ip: getIP(req), details: 'token: ' + req.params.token });
    } catch {}

    if (share.type === 'photo') {
      const photoDoc = await db.collection('photos').doc(share.targetId).get();
      if (!photoDoc.exists) return res.status(404).json({ error: 'Photo not found' });
      const photo = photoDoc.data();
      const [fullUrl, thumbUrl] = await Promise.all([
        getPresignedUrl(photo.key, 3600),
        getPresignedUrl(photo.thumbKey || photo.key, 3600),
      ]);
      return res.json({ share, content: { ...photo, fullUrl, thumbUrl } });
    }

    if (share.type === 'album') {
      const albumDoc = await db.collection('albums').doc(share.targetId).get();
      if (!albumDoc.exists) return res.status(404).json({ error: 'Album not found' });

      const photosSnap = await db.collection('photos')
        .where('albumId', '==', share.targetId)
        .where('status', '==', 'active')
        .orderBy('createdAt', 'desc')
        .get();

      const photos = await Promise.all(
        photosSnap.docs.map(async d => {
          const p = d.data();
          return { ...p, thumbUrl: await getPresignedUrl(p.thumbKey || p.key, 3600) };
        })
      );

      return res.json({ share, content: { album: albumDoc.data(), photos } });
    }

    res.status(400).json({ error: 'Invalid share type' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load share' });
  }
});

// ─── LIST MY SHARE LINKS (editor+) ───────────────────────────────────────────
router.get('/', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const snap = await db.collection('shares')
      .where('createdBy', '==', req.user.uid)
      .orderBy('createdAt', 'desc')
      .get();
    res.json({ shares: snap.docs.map(d => d.data()) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list shares' });
  }
});

// ─── DELETE SHARE LINK ────────────────────────────────────────────────────────
router.delete('/:token', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const doc = await db.collection('shares').doc(req.params.token).get();
    if (!doc.exists) return res.status(404).json({ error: 'Share not found' });

    const share = doc.data();
    if (share.createdBy !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot delete another user\'s share link' });
    }

    await db.collection('shares').doc(req.params.token).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete share' });
  }
});

module.exports = router;