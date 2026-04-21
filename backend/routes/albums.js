const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/firebase');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── CREATE ALBUM (editor+) ───────────────────────────────────────────────────
router.post('/', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { name, description = '', tags = [], isPublic = false } = req.body;
    if (!name) return res.status(400).json({ error: 'Album name required' });

    const albumId = uuidv4();
    const album = {
      id: albumId,
      name,
      description,
      tags,
      isPublic,
      photoCount: 0,
      createdBy: req.user.uid,
      creatorName: req.user.displayName,
      createdAt: new Date().toISOString(),
      coverPhotoUrl: null,
    };

    await db.collection('albums').doc(albumId).set(album);
    res.status(201).json({ album });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create album' });
  }
});

// ─── LIST ALBUMS ──────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('albums').orderBy('createdAt', 'desc').get();
    const albums = snapshot.docs.map(doc => doc.data());
    res.json({ albums });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch albums' });
  }
});

// ─── GET SINGLE ALBUM ─────────────────────────────────────────────────────────
router.get('/:albumId', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('albums').doc(req.params.albumId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Album not found' });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch album' });
  }
});

// ─── UPDATE ALBUM (editor+) ───────────────────────────────────────────────────
router.patch('/:albumId', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { name, description, tags, isPublic, coverPhotoUrl } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (tags !== undefined) updates.tags = tags;
    if (isPublic !== undefined) updates.isPublic = isPublic;
    if (coverPhotoUrl !== undefined) updates.coverPhotoUrl = coverPhotoUrl;

    await db.collection('albums').doc(req.params.albumId).update(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update album' });
  }
});

// ─── DELETE ALBUM (admin only) ────────────────────────────────────────────────
router.delete('/:albumId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Soft-check: don't delete if photos exist
    const photosSnap = await db.collection('photos')
      .where('albumId', '==', req.params.albumId)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (!photosSnap.empty) {
      return res.status(400).json({ error: 'Cannot delete album with photos. Remove photos first.' });
    }

    await db.collection('albums').doc(req.params.albumId).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete album' });
  }
});

module.exports = router;
