const express = require('express');
const router = express.Router();
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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
    const wasabiKeys = await getAllWasabiKeys();

    const orphanedPhotos = [];
    const orphanedAlbums = [];

    // Check every Firestore photo against Wasabi keys
    const photosSnap = await db.collection('photos').get();
    const activeAlbumIds = new Set();

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
      } else if (photo.status === 'active' && photo.albumId) {
        activeAlbumIds.add(photo.albumId);
      }
    }

    // Check for empty albums (no active photos)
    const albumsSnap = await db.collection('albums').get();
    for (const doc of albumsSnap.docs) {
      const album = doc.data();
      if (!activeAlbumIds.has(album.id)) {
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

    // 1. Remove orphaned photo records
    const photosSnap = await db.collection('photos').get();
    const activeAlbumIds = new Set();

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
        } catch (err) {
          results.errors.push({ id: photo.id, error: err.message });
        }
      } else if (photo.status === 'active' && photo.albumId) {
        activeAlbumIds.add(photo.albumId);
      }
    }

    // 2. Remove empty albums
    const albumsSnap = await db.collection('albums').get();
    for (const doc of albumsSnap.docs) {
      const album = doc.data();
      if (!activeAlbumIds.has(album.id)) {
        try {
          await db.collection('albums').doc(album.id).delete();
          results.albumsRemoved++;
          console.log('Deleted empty album:', album.name);
        } catch (err) {
          results.errors.push({ albumId: album.id, error: err.message });
        }
      }
    }

    res.json({ success: true, ...results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Cleanup failed', detail: err.message });
  }
});

module.exports = router;