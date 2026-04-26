const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/firebase');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── CREATE ALBUM (editor+) ───────────────────────────────────────────────────
router.post('/', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { name, description = '', tags = [], isPublic = false, schoolYear = '', parentId = null } = req.body;
    if (!name) return res.status(400).json({ error: 'Album name required' });
    const albumId = uuidv4();
    const album = {
      id: albumId,
      name,
      description,
      tags,
      isPublic,
      schoolYear: schoolYear || '',
      parentId: parentId || null,
      photoCount: 0,
      subAlbumCount: 0,
      createdBy: req.user.uid,
      creatorName: req.user.displayName,
      createdAt: new Date().toISOString(),
      coverPhotoUrl: null,
    };
    await db.collection('albums').doc(albumId).set(album);
    if (parentId) {
      const parentRef = db.collection('albums').doc(parentId);
      const parent = await parentRef.get();
      if (parent.exists) {
        await parentRef.update({ subAlbumCount: (parent.data().subAlbumCount || 0) + 1 });
      }
    }
    res.status(201).json({ album });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create album' });
  }
});

// ─── LIST TOP-LEVEL ALBUMS (in-memory filter, no composite index needed) ──────
router.get('/', authenticate, async (req, res) => {
  try {
    const { schoolYear } = req.query;
    const snapshot = await db.collection('albums').orderBy('createdAt', 'desc').get();
    let albums = snapshot.docs.map(doc => doc.data());

    // Top-level only — parentId is null, undefined, or empty string
    albums = albums.filter(a => !a.parentId);

    if (schoolYear) {
      albums = albums.filter(a => a.schoolYear === schoolYear);
    }

    res.json({ albums });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch albums' });
  }
});

// ─── GET ALL SCHOOL YEARS ─────────────────────────────────────────────────────
router.get('/years/list', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('albums').get();
    const years = new Set();
    snapshot.docs.forEach(doc => {
      const y = doc.data().schoolYear;
      if (y) years.add(y);
    });
    const sorted = [...years].sort((a, b) => b.localeCompare(a));
    res.json({ years: sorted });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch years' });
  }
});

// ─── GET SUB-ALBUMS OF A PARENT (in-memory filter) ───────────────────────────
router.get('/:albumId/subalbums', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('albums').get();
    const subAlbums = snapshot.docs
      .map(doc => doc.data())
      .filter(a => a.parentId === req.params.albumId)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    res.json({ subAlbums });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sub-albums' });
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
    const { name, description, tags, isPublic, coverPhotoUrl, schoolYear, parentId } = req.body;
    const updates = { updatedAt: new Date().toISOString() };
    if (name !== undefined) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (tags !== undefined) updates.tags = tags;
    if (isPublic !== undefined) updates.isPublic = isPublic;
    if (coverPhotoUrl !== undefined) updates.coverPhotoUrl = coverPhotoUrl;
    if (schoolYear !== undefined) updates.schoolYear = schoolYear;
    if (parentId !== undefined) updates.parentId = parentId;
    await db.collection('albums').doc(req.params.albumId).update(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update album' });
  }
});

// ─── DELETE ALBUM (admin only) ────────────────────────────────────────────────
router.delete('/:albumId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const photosSnap = await db.collection('photos')
      .where('albumId', '==', req.params.albumId)
      .where('status', '==', 'active')
      .limit(1).get();
    if (!photosSnap.empty) {
      return res.status(400).json({ error: 'Cannot delete album with photos. Remove photos first.' });
    }
    const subSnap = await db.collection('albums').get();
    const hasSubs = subSnap.docs.some(d => d.data().parentId === req.params.albumId);
    if (hasSubs) {
      return res.status(400).json({ error: 'Cannot delete album with sub-albums. Remove sub-albums first.' });
    }
    const albumDoc = await db.collection('albums').doc(req.params.albumId).get();
    if (albumDoc.exists) {
      const album = albumDoc.data();
      if (album.parentId) {
        const parentRef = db.collection('albums').doc(album.parentId);
        const parent = await parentRef.get();
        if (parent.exists) {
          await parentRef.update({ subAlbumCount: Math.max(0, (parent.data().subAlbumCount || 1) - 1) });
        }
      }
    }
    await db.collection('albums').doc(req.params.albumId).delete();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete album' });
  }
});

module.exports = router;