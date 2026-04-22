const express = require('express');
const router = express.Router();
const {
  S3Client, ListObjectsV2Command, GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
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
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'];

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function normalizeAlbumName(raw) {
  try {
    return decodeURIComponent(raw).trim().replace(/\s+/g, ' ');
  } catch {
    return raw.trim().replace(/\s+/g, ' ');
  }
}

async function findOrCreateAlbum(albumName) {
  const snap = await db.collection('albums').get();
  const normalized = albumName.toLowerCase().trim();
  for (const doc of snap.docs) {
    const existing = (doc.data().name || '').toLowerCase().trim();
    if (existing === normalized) return doc.id;
  }
  const albumId = uuidv4();
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
  console.log('Created album: ' + albumName);
  return albumId;
}

async function alreadyImported(importKey) {
  const snap = await db.collection('photos')
    .where('importedFrom', '==', importKey)
    .limit(1).get();
  return !snap.empty;
}

async function runSync() {
  const results = { processed: 0, skipped: 0, errors: [], albums: {} };

  const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: IMPORT_PREFIX });
  const listed = await s3.send(listCmd);

  if (!listed.Contents || listed.Contents.length === 0) {
    return { ...results, message: 'No files found in imports/ folder' };
  }

  const imageFiles = listed.Contents.filter(obj => {
    const key = obj.Key.toLowerCase();
    return IMAGE_EXTS.some(ext => key.endsWith(ext)) && obj.Key !== IMPORT_PREFIX;
  });

  if (imageFiles.length === 0) {
    return { ...results, message: 'No image files found in imports/ folder' };
  }

  const albumCache = {};

  for (const obj of imageFiles) {
    try {
      const relativePath = obj.Key.replace(IMPORT_PREFIX, '');
      const parts = relativePath.split('/');

      if (parts.length < 2 || !parts[1]) {
        results.skipped++;
        continue;
      }

      const albumName = normalizeAlbumName(parts[0]);
      const filename = parts[parts.length - 1];
      const ext = filename.split('.').pop().toLowerCase();

      const duplicate = await alreadyImported(obj.Key);
      if (duplicate) {
        results.skipped++;
        continue;
      }

      if (!albumCache[albumName]) {
        albumCache[albumName] = await findOrCreateAlbum(albumName);
      }
      const albumId = albumCache[albumName];
      results.albums[albumId] = albumName;

      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key });
      const response = await s3.send(getCmd);
      const buffer = await streamToBuffer(response.Body);

      const thumbBuffer = await sharp(buffer)
        .resize(400, 400, { fit: 'cover' })
        .webp({ quality: 80 })
        .toBuffer();

      const photoId = uuidv4();
      const newKey = 'photos/' + albumId + '/' + photoId + '.' + ext;
      const thumbKey = 'thumbnails/' + albumId + '/' + photoId + '_thumb.webp';

      await Promise.all([
        uploadFile({ key: newKey, buffer, mimetype: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }),
        uploadFile({ key: thumbKey, buffer: thumbBuffer, mimetype: 'image/webp' }),
      ]);

      const title = filename.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
      await db.collection('photos').doc(photoId).set({
        id: photoId,
        key: newKey,
        thumbKey,
        filename,
        title,
        mimetype: 'image/' + (ext === 'jpg' ? 'jpeg' : ext),
        albumId,
        tags: [],
        uploadedBy: 'wasabi-sync',
        uploaderName: 'Wasabi Sync',
        importedFrom: obj.Key,
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      const albumRef = db.collection('albums').doc(albumId);
      const album = await albumRef.get();
      await albumRef.update({ photoCount: (album.data().photoCount || 0) + 1 });

      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

      results.processed++;
      console.log('Imported: ' + filename + ' into album: ' + albumName);
    } catch (err) {
      console.error('Sync error for', obj.Key, err.message);
      results.errors.push({ file: obj.Key, error: err.message });
    }
  }

  return results;
}

router.post('/run', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const results = await runSync();
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('Sync failed:', err);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
});

router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: IMPORT_PREFIX });
    const listed = await s3.send(listCmd);
    const pending = (listed.Contents || [])
      .filter(obj => IMAGE_EXTS.some(ext => obj.Key.toLowerCase().endsWith(ext)) && obj.Key !== IMPORT_PREFIX)
      .map(obj => ({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified }));
    res.json({ pending, count: pending.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list pending files' });
  }
});

router.get('/album-download/:albumId', authenticate, async (req, res) => {
  try {
    const { albumId } = req.params;
    const albumDoc = await db.collection('albums').doc(albumId).get();
    if (!albumDoc.exists) return res.status(404).json({ error: 'Album not found' });
    const album = albumDoc.data();

    const photosSnap = await db.collection('photos')
      .where('albumId', '==', albumId)
      .where('status', '==', 'active')
      .get();

    if (photosSnap.empty) return res.status(404).json({ error: 'No photos in this album' });

    const files = await Promise.all(
      photosSnap.docs.map(async doc => {
        const photo = doc.data();
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: photo.key });
        const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
        return { filename: photo.filename || photo.title || photo.id, url, photoId: photo.id };
      })
    );

    res.json({ albumName: album.name, photoCount: files.length, files });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to prepare album download' });
  }
});

module.exports = { router, runSync };