const express = require('express');
const router = express.Router();
const { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../services/firebase');

const s3 = new S3Client({
  endpoint: process.env.WASABI_ENDPOINT,
  region: process.env.WASABI_REGION,
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY,
    secretAccessKey: process.env.WASABI_SECRET_KEY,
  },
  forcePathStyle: true,
});

const BUCKET = process.env.WASABI_BUCKET;

// Get ALL keys in Wasabi bucket at once (much faster than checking one by one)
async function getAllWasabiKeys() {
  const keys = new Set();
  let continuationToken = null;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      ContinuationToken: continuationToken,
    });
    const res = await s3.send(cmd);
    (res.Contents || []).forEach(obj => keys.add(obj.Key));
    continuationToken = res.IsTruncated ? res.NextContinuationToken : null;
  } while (continuationToken);

  return keys;
}

// ─── PREVIEW ──────────────────────────────────────────────────────────────────
router.get('/preview', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Get all Wasabi keys in one bulk listing
    const wasabiKeys = await getAllWasabiKeys();

    const orphanedPhotos = [];
    const orphanedAlbums = [];

    // Check every Firestore photo against the bulk key set
    const photosSnap = await db.collection('photos').get();
    for (const doc of photosSnap.docs) {
      const photo = doc.data();
      if (!wasabiKeys.has(photo.key)) {
        orphanedPhotos.push({
          id: photo.id,
          filename: photo.filename,
          albumId: photo.albumId,
          key: photo.key,
          thumbKey: photo.thumbKey,
        });
      }
    }

    // Check for empty albums
    const albumsSnap = await db.collection('albums').get();
    const activePhotosByAlbum = {};
    photosSnap.docs.forEach(doc => {
      const p = doc.data();
      if (p.status === 'active' && p.albumId) {
        activePhotosByAlbum[p.albumId] = (activePhotosByAlbum[p.albumId] || 0) + 1;
      }
    });

    for (const doc of albumsSnap.docs) {
      const album = doc.data();
      if (!activePhotosByAlbum[album.id]) {
        orphanedAlbums.push({ id: album.id, name: album.name });
      }
    }

    res.json({
      orphanedPhotos: orphanedPhotos.length,
      orphanedAlbums: orphanedAlbums.length,
      photos: orphanedPhotos,
      albums: orphanedAlbums,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Preview failed', detail: err.message });
  }
});

// ─── RUN CLEANUP ──────────────────────────────────────────────────────────────
router.post('/run', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const wasabiKeys = await getAllWasabiKeys();

    const results = {
      photosRemoved: 0,
      thumbnailsRemoved: 0,
      albumsRemoved: 0,
      errors: [],
    };

    const photosSnap = await db.collection('photos').get();
    const affectedAlbumIds = new Set();

    for (const doc of photosSnap.docs) {
      const photo = doc.data();
      if (!wasabiKeys.has(photo.key)) {
        try {
          await db.collection('photos').doc(photo.id).delete();
          results.photosRemoved++;

          if (photo.thumbKey && wasabiKeys.has(photo.thumbKey)) {
            await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: photo.thumbKey }));
            results.thumbnailsRemoved++;
          }

          if (photo.albumId) affectedAlbumIds.add(photo.albumId);
        } catch (err) {
          results.errors.push({ id: photo.id, error: err.message });
        }
      }
    }

    // Fix album counts or delete empty albums
    for (const albumId of affectedAlbumIds) {
      try {
        const remaining = await db.collection('photos')
          .where('albumId', '==', albumId)
          .where('status', '==', 'active')
          .get();

        if (remaining.empty) {
          await db.collection('albums').doc(albumId).delete();
          results.albumsRemoved++;
        } else {
          await db.collection('albums').doc(albumId).update({ photoCount: remaining.size });
        }
      } catch (err) {
        results.errors.push({ albumId, error: err.message });
      }
    }

    res.json({ success: true, ...results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Cleanup failed', detail: err.message });
  }
});

module.exports = router;