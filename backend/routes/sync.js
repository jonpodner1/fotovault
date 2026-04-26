const express = require('express');
const router = express.Router();
const {
  S3Client, ListObjectsV2Command, GetObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const archiver = require('archiver');
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
const YEAR_PATTERN = /^\d{4}-\d{2,4}$/;

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

// Parse path — supports:
//   imports/2025-2026/Boys Tennis/vs Bunker Hill/file.jpg  -> year, parent=Boys Tennis, child=vs Bunker Hill
//   imports/2025-2026/Boys Tennis/file.jpg                 -> year, album=Boys Tennis, no parent
//   imports/Boys Tennis/vs Bunker Hill/file.jpg            -> no year, parent=Boys Tennis, child=vs Bunker Hill
//   imports/Boys Tennis/file.jpg                           -> no year, album=Boys Tennis
function parsePath(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const first = normalizeAlbumName(parts[0]);
  let schoolYear = '';
  let rest = parts;

  // Check if first segment is a year
  if (YEAR_PATTERN.test(first)) {
    schoolYear = first;
    rest = parts.slice(1);
  }

  if (rest.length < 2) return null;

  const filename = rest[rest.length - 1];
  // Must be an image file
  if (!IMAGE_EXTS.some(ext => filename.toLowerCase().endsWith(ext))) return null;

  if (rest.length === 2) {
    // imports/[year/]AlbumName/file.jpg — no sub-album
    return {
      schoolYear,
      parentName: null,
      albumName: normalizeAlbumName(rest[0]),
      filename,
    };
  }

  // imports/[year/]ParentAlbum/SubAlbum/file.jpg — sub-album
  return {
    schoolYear,
    parentName: normalizeAlbumName(rest[0]),
    albumName: normalizeAlbumName(rest[1]),
    filename,
  };
}

// Find or create album — handles both top-level and sub-albums
async function findOrCreateAlbum(albumName, schoolYear, parentId) {
  const snap = await db.collection('albums').get();
  const normalizedName = albumName.toLowerCase().trim();
  const normalizedYear = (schoolYear || '').trim();
  const normalizedParent = parentId || null;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (
      (data.name || '').toLowerCase().trim() === normalizedName &&
      (data.schoolYear || '').trim() === normalizedYear &&
      (data.parentId || null) === normalizedParent
    ) {
      return doc.id;
    }
  }

  const albumId = uuidv4();
  await db.collection('albums').doc(albumId).set({
    id: albumId,
    name: albumName,
    description: '',
    tags: [],
    isPublic: false,
    schoolYear: schoolYear || '',
    parentId: parentId || null,
    photoCount: 0,
    subAlbumCount: 0,
    createdBy: 'wasabi-sync',
    creatorName: 'Wasabi Sync',
    createdAt: new Date().toISOString(),
    coverPhotoUrl: null,
  });

  // Increment parent's subAlbumCount
  if (parentId) {
    const parentRef = db.collection('albums').doc(parentId);
    const parent = await parentRef.get();
    if (parent.exists) {
      await parentRef.update({ subAlbumCount: (parent.data().subAlbumCount || 0) + 1 });
    }
  }

  console.log('Created album: ' + albumName + (schoolYear ? ' (' + schoolYear + ')' : '') + (parentId ? ' [sub]' : ''));
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

  // Cache: albumCacheKey -> albumId
  // Key format: "year||parentId||albumName" or "year||null||albumName"
  const albumCache = {};

  for (const obj of imageFiles) {
    try {
      const relativePath = obj.Key.replace(IMPORT_PREFIX, '');
      const parsed = parsePath(relativePath);

      if (!parsed) {
        results.skipped++;
        continue;
      }

      const { schoolYear, parentName, albumName, filename } = parsed;
      const ext = filename.split('.').pop().toLowerCase();

      const duplicate = await alreadyImported(obj.Key);
      if (duplicate) {
        results.skipped++;
        continue;
      }

      // Resolve parent album first if needed
      let parentId = null;
      if (parentName) {
        const parentCacheKey = schoolYear + '||null||' + parentName;
        if (!albumCache[parentCacheKey]) {
          albumCache[parentCacheKey] = await findOrCreateAlbum(parentName, schoolYear, null);
        }
        parentId = albumCache[parentCacheKey];
      }

      // Resolve the target album
      const albumCacheKey = schoolYear + '||' + parentId + '||' + albumName;
      if (!albumCache[albumCacheKey]) {
        albumCache[albumCacheKey] = await findOrCreateAlbum(albumName, schoolYear, parentId);
      }
      const albumId = albumCache[albumCacheKey];
      results.albums[albumId] = albumName;

      // Download from Wasabi
      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key });
      const response = await s3.send(getCmd);
      const buffer = await streamToBuffer(response.Body);

      // Generate thumbnail
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

      // Count existing photos for rename
      const existingSnap = await db.collection('photos')
        .where('albumId', '==', albumId)
        .where('status', '==', 'active')
        .get();
      const photoNumber = existingSnap.size + 1;
      const displayName = albumName;
      const renamedFilename = displayName + ' ' + photoNumber + '.' + ext;
      const title = displayName + ' ' + photoNumber;

      await db.collection('photos').doc(photoId).set({
        id: photoId,
        key: newKey,
        thumbKey,
        filename: renamedFilename,
        title,
        mimetype: 'image/' + (ext === 'jpg' ? 'jpeg' : ext),
        albumId,
        parentAlbumId: parentId || null,
        schoolYear: schoolYear || '',
        tags: [],
        uploadedBy: 'wasabi-sync',
        uploaderName: 'Wasabi Sync',
        importedFrom: obj.Key,
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      // Update album photo count
      const albumRef = db.collection('albums').doc(albumId);
      const album = await albumRef.get();
      await albumRef.update({ photoCount: (album.data().photoCount || 0) + 1 });

      // Also set cover photo on parent if not set
      if (parentId) {
        const parentRef = db.collection('albums').doc(parentId);
        const parentDoc = await parentRef.get();
        if (parentDoc.exists && !parentDoc.data().coverPhotoUrl) {
          const thumbUrl = 'thumbnails/' + albumId + '/' + photoId + '_thumb.webp';
          await parentRef.update({ coverPhotoUrl: thumbUrl });
        }
      }

      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

      results.processed++;
      const path = (schoolYear ? schoolYear + '/' : '') + (parentName ? parentName + '/' : '') + albumName;
      console.log('Imported: ' + renamedFilename + ' into: ' + path);
    } catch (err) {
      console.error('Sync error for', obj.Key, err.message);
      results.errors.push({ file: obj.Key, error: err.message });
    }
  }

  return results;
}

// ─── MANUAL SYNC ─────────────────────────────────────────────────────────────
router.post('/run', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const results = await runSync();
    res.json({ success: true, ...results });
  } catch (err) {
    console.error('Sync failed:', err);
    res.status(500).json({ error: 'Sync failed', detail: err.message });
  }
});

// ─── LIST PENDING ─────────────────────────────────────────────────────────────
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

// ─── DOWNLOAD ALBUM AS ZIP ────────────────────────────────────────────────────
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

    const zipName = album.name.replace(/[^a-z0-9 _-]/gi, '_') + '.zip';
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + zipName + '"');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    archive.on('error', err => { if (!res.headersSent) res.status(500).end(); });

    let counter = 1;
    for (const doc of photosSnap.docs) {
      const photo = doc.data();
      try {
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: photo.key });
        const response = await s3.send(cmd);
        const buffer = await streamToBuffer(response.Body);
        const ext = (photo.filename || 'photo.jpg').split('.').pop().toLowerCase();
        archive.append(buffer, { name: album.name + ' ' + counter + '.' + ext });
        counter++;
      } catch (err) {
        console.error('Failed to add photo to zip:', photo.id, err.message);
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to prepare album download' });
  }
});

module.exports = { router, runSync };
