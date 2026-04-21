const express = require('express');
const router = express.Router();
const { S3Client, ListObjectsV2Command, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../services/firebase');
const { uploadFile } = require('../services/wasabi');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

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
const IMPORT_PREFIX = 'imports/';

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function runSync() {
  const results = { processed: 0, skipped: 0, errors: [] };

  // List everything under imports/
  const listCmd = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: IMPORT_PREFIX,
  });
  const listed = await s3.send(listCmd);

  if (!listed.Contents || listed.Contents.length === 0) {
    return { ...results, message: 'No files found in imports/ folder' };
  }

  // Filter to image files only
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
  const imageFiles = listed.Contents.filter(obj => {
    const key = obj.Key.toLowerCase();
    return imageExts.some(ext => key.endsWith(ext)) && obj.Key !== IMPORT_PREFIX;
  });

  for (const obj of imageFiles) {
    try {
      // Parse folder name as album name
      // Expected structure: imports/AlbumName/filename.jpg
      const parts = obj.Key.replace(IMPORT_PREFIX, '').split('/');
      if (parts.length < 2) {
        results.skipped++;
        continue; // skip files directly in imports/ with no album folder
      }

      const albumName = decodeURIComponent(parts[0]);
      const filename = parts[parts.length - 1];
      const ext = filename.split('.').pop().toLowerCase();

      // Find or create album in Firestore
      let albumId;
      const albumSnap = await db.collection('albums')
        .where('name', '==', albumName).limit(1).get();

      if (!albumSnap.empty) {
        albumId = albumSnap.docs[0].id;
      } else {
        albumId = uuidv4();
        await db.collection('albums').doc(albumId).set({
          id: albumId,
          name: albumName,
          description: '',
          tags: [],
          isPublic: false,
          photoCount: 0,
          createdBy: 'wasabi-sync',
          creatorName: 'Wasabi Sync',
          createdAt: new Date().toISOString(),
          coverPhotoUrl: null,
        });
      }

      // Download file from Wasabi
      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key });
      const response = await s3.send(getCmd);
      const buffer = await streamToBuffer(response.Body);

      // Generate thumbnail
      const thumbBuffer = await sharp(buffer)
        .resize(400, 400, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();

      // Upload to proper location
      const photoId = uuidv4();
      const newKey = `photos/${albumId}/${photoId}.${ext}`;
      const thumbKey = `thumbnails/${albumId}/${photoId}_thumb.webp`;

      await Promise.all([
        uploadFile({ key: newKey, buffer, mimetype: `image/${ext === 'jpg' ? 'jpeg' : ext}` }),
        uploadFile({ key: thumbKey, buffer: thumbBuffer, mimetype: 'image/webp' }),
      ]);

      // Write Firestore record
      const title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      await db.collection('photos').doc(photoId).set({
        id: photoId,
        key: newKey,
        thumbKey,
        filename,
        title,
        mimetype: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        albumId,
        tags: [],
        uploadedBy: 'wasabi-sync',
        uploaderName: 'Wasabi Sync',
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      // Update album photo count
      const albumRef = db.collection('albums').doc(albumId);
      const album = await albumRef.get();
      await albumRef.update({ photoCount: (album.data().photoCount || 0) + 1 });

      // Delete original from imports/
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

      results.processed++;
    } catch (err) {
      console.error('Sync error for', obj.Key, err.message);
      results.errors.push({ file: obj.Key, error: err.message });
    }
  }

  return results;
}

// ─── MANUAL SYNC TRIGGER (admin only) ────────────────────────────────────────
router.post('/run', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const results = await runSync();
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('Sync failed:', err);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
});

// ─── SYNC STATUS - list what's waiting in imports/ ───────────────────────────
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const listCmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: IMPORT_PREFIX,
    });
    const listed = await s3.send(listCmd);
    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];
    const pending = (listed.Contents || [])
      .filter(obj => imageExts.some(ext => obj.Key.toLowerCase().endsWith(ext)) && obj.Key !== IMPORT_PREFIX)
      .map(obj => ({
        key: obj.Key,
        size: obj.Size,
        lastModified: obj.LastModified,
      }));
    res.json({ pending, count: pending.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list pending files' });
  }
});

module.exports = { router, runSync };
