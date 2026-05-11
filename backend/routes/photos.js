const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { db } = require('../services/firebase');
const { uploadFile, getPresignedUrl, getPresignedUploadUrl, deleteFile } = require('../services/wasabi');
const { authenticate, requireRole } = require('../middleware/auth');
const multer = require('multer');
const sharp = require('sharp');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function getIP(req) {
  return req.headers['cf-connecting-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0] ||
    req.socket.remoteAddress || '';
}

// ─── GET PRESIGNED UPLOAD URL (editor+) ──────────────────────────────────────
router.post('/upload-url', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { filename, mimetype, albumId } = req.body;
    if (!filename || !mimetype) return res.status(400).json({ error: 'filename and mimetype required' });

    const photoId = uuidv4();
    const ext = filename.split('.').pop().toLowerCase();
    const key = `photos/${albumId || 'uncategorized'}/${photoId}.${ext}`;
    const thumbKey = `thumbnails/${albumId || 'uncategorized'}/${photoId}_thumb.webp`;

    const uploadUrl = await getPresignedUploadUrl(key, mimetype);

    await db.collection('photos').doc(photoId).set({
      id: photoId,
      key,
      thumbKey,
      filename,
      mimetype,
      albumId: albumId || null,
      tags: [],
      uploadedBy: req.user.uid,
      uploaderName: req.user.displayName,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    res.json({ photoId, uploadUrl, key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// ─── CONFIRM UPLOAD (editor+) ─────────────────────────────────────────────────
router.post('/confirm/:photoId', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { photoId } = req.params;
    const photoDoc = await db.collection('photos').doc(photoId).get();
    if (!photoDoc.exists) return res.status(404).json({ error: 'Photo not found' });
    await db.collection('photos').doc(photoId).update({ status: 'active' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
});

// ─── SERVER-SIDE UPLOAD WITH AUTO THUMBNAIL (editor+) ────────────────────────
router.post('/upload', authenticate, requireRole(['admin', 'editor']), upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const { albumId, tags = '[]', title = '' } = req.body;
    const photoId = uuidv4();
    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const key = `photos/${albumId || 'uncategorized'}/${photoId}.${ext}`;
    const thumbKey = `thumbnails/${albumId || 'uncategorized'}/${photoId}_thumb.webp`;

    const thumbBuffer = await sharp(req.file.buffer)
      .rotate()
      .resize(400, 400, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    await Promise.all([
      uploadFile({ key, buffer: req.file.buffer, mimetype: req.file.mimetype }),
      uploadFile({ key: thumbKey, buffer: thumbBuffer, mimetype: 'image/webp' }),
    ]);

    const parsedTags = JSON.parse(tags);

    const photoData = {
      id: photoId,
      key,
      thumbKey,
      filename: req.file.originalname,
      title: title || req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      albumId: albumId || null,
      tags: parsedTags,
      uploadedBy: req.user.uid,
      uploaderName: req.user.displayName,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    await db.collection('photos').doc(photoId).set(photoData);

    if (albumId) {
      const albumRef = db.collection('albums').doc(albumId);
      const album = await albumRef.get();
      if (album.exists) {
        await albumRef.update({ photoCount: (album.data().photoCount || 0) + 1 });
      }
    }

    // Log upload event
    try {
      const { logEvent } = require('../server');
      logEvent({ type: 'photo_uploaded', userEmail: req.user.email, userName: req.user.displayName, role: req.user.role, targetName: photoData.title || photoData.filename, targetId: photoId, albumName: albumId || '', ip: getIP(req) });
    } catch {}

    res.json({ success: true, photo: photoData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ─── LIST PHOTOS (with cursor-based pagination) ───────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { albumId, tag, limit = 50, cursor } = req.query;
    const pageSize = Math.min(parseInt(limit), 100);

    let query = db.collection('photos')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc');

    if (albumId) {
      // Check if this album has sub-albums
      const albumsSnap = await db.collection('albums').get();
      const subAlbumIds = albumsSnap.docs
        .map(d => d.data())
        .filter(a => a.parentId === albumId)
        .map(a => a.id);
    
      if (subAlbumIds.length > 0) {
        // Include photos from all sub-albums too
        const allAlbumIds = [albumId, ...subAlbumIds];
        query = query.where('albumId', 'in', allAlbumIds);
      } else {
        query = query.where('albumId', '==', albumId);
      }
    }
    if (tag) query = query.where('tags', 'array-contains', tag);

    if (cursor) {
      const cursorDoc = await db.collection('photos').doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    query = query.limit(pageSize);

    const snapshot = await query.get();
    const photos = snapshot.docs.map(doc => doc.data());

    const photosWithUrls = await Promise.all(
      photos.map(async (photo) => ({
        ...photo,
        thumbUrl: await getPresignedUrl(photo.thumbKey || photo.key, 3600),
      }))
    );

    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
    const nextCursor = snapshot.docs.length === pageSize ? lastDoc?.id : null;

    res.json({ photos: photosWithUrls, nextCursor, hasMore: !!nextCursor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// ─── GET SINGLE PHOTO WITH FULL URL ──────────────────────────────────────────
router.get('/:photoId', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('photos').doc(req.params.photoId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Photo not found' });

    const photo = doc.data();
    const [fullUrl, thumbUrl] = await Promise.all([
      getPresignedUrl(photo.key, 3600),
      getPresignedUrl(photo.thumbKey || photo.key, 3600),
    ]);

    // Log download event (single photo fetch = download intent)
    try {
      const { logEvent } = require('../server');
      logEvent({ type: 'photo_downloaded', userEmail: req.user.email, userName: req.user.displayName, role: req.user.role, targetName: photo.title || photo.filename, targetId: req.params.photoId, albumName: photo.albumId || '', ip: getIP(req) });
    } catch {}

    res.json({ ...photo, fullUrl, thumbUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch photo' });
  }
});
// ─── MOVE PHOTO TO ALBUM (editor+) ───────────────────────────────────────────
router.patch('/:photoId/move', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { albumId } = req.body;
    if (!albumId) return res.status(400).json({ error: 'albumId required' });

    const photoDoc = await db.collection('photos').doc(req.params.photoId).get();
    if (!photoDoc.exists) return res.status(404).json({ error: 'Photo not found' });
    const photo = photoDoc.data();
    const oldAlbumId = photo.albumId;

    // Get new album to find its parentId
    const newAlbumDoc = await db.collection('albums').doc(albumId).get();
    if (!newAlbumDoc.exists) return res.status(404).json({ error: 'Target album not found' });
    const newAlbum = newAlbumDoc.data();

    // Update photo
    await db.collection('photos').doc(req.params.photoId).update({
      albumId,
      parentAlbumId: newAlbum.parentId || null,
      updatedAt: new Date().toISOString(),
    });

    // Decrement old album count
    if (oldAlbumId) {
      const oldAlbum = await db.collection('albums').doc(oldAlbumId).get();
      if (oldAlbum.exists) {
        await db.collection('albums').doc(oldAlbumId).update({
          photoCount: Math.max(0, (oldAlbum.data().photoCount || 1) - 1)
        });
      }
    }

    // Increment new album count
    await db.collection('albums').doc(albumId).update({
      photoCount: (newAlbum.photoCount || 0) + 1
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to move photo' });
  }
});
// ─── UPDATE PHOTO METADATA (editor+) ─────────────────────────────────────────
router.patch('/:photoId', authenticate, requireRole(['admin', 'editor']), async (req, res) => {
  try {
    const { title, tags, albumId } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (tags !== undefined) updates.tags = tags;
    if (albumId !== undefined) updates.albumId = albumId;
    updates.updatedAt = new Date().toISOString();
    await db.collection('photos').doc(req.params.photoId).update(updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update photo' });
  }
});

// ─── DELETE PHOTO (admin only) ────────────────────────────────────────────────
router.delete('/:photoId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const doc = await db.collection('photos').doc(req.params.photoId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Photo not found' });

    const photo = doc.data();

    await Promise.all([
      deleteFile(photo.key),
      photo.thumbKey ? deleteFile(photo.thumbKey) : Promise.resolve(),
      db.collection('photos').doc(req.params.photoId).delete(),
    ]);

    if (photo.albumId) {
      const albumRef = db.collection('albums').doc(photo.albumId);
      const album = await albumRef.get();
      if (album.exists) {
        await albumRef.update({ photoCount: Math.max(0, (album.data().photoCount || 1) - 1) });
      }
    }

    // Log delete event
    try {
      const { logEvent } = require('../server');
      logEvent({ type: 'photo_deleted', userEmail: req.user.email, userName: req.user.displayName, role: req.user.role, targetName: photo.title || photo.filename, targetId: req.params.photoId, albumName: photo.albumId || '', ip: getIP(req) });
    } catch {}

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

module.exports = router;