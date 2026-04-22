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

// Normalize album name — decode URI encoding, trim whitespace, normalize spaces
function normalizeAlbumName(raw) {
  try {
    return decodeURIComponent(raw).trim().replace(/\s+/g, ' ');
  } catch {
    return raw.trim().replace(/\s+/g, ' ');
  }
}

// Find album by normalized name, case-insensitive
async function findOrCreateAlbum(albumName) {
  // Get all albums and compare normalized names
  const snap = await db.collection('albums').get();
  const normalized = albumName.toLowerCase().trim();

  for (const doc of snap.docs) {
    const existing = (doc.data().name || '').toLowerCase().trim();
    if (existing === normalized) {
      return doc.id;
    }
  }

  // Not found — create it
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
  console.log(`Created new album: "${albumName}" (${albumId})`);
  return albumId;
}

// Check if this file was already imported (by original import path stored in metadata)
async function alreadyImported(importKey) {
  const snap = await db.collection('photos')
    .where('importedFrom', '==', importKey)
    .limit(1)
    .get();
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

  // Pre-build album ID cache so we don't re-query for every file in the same folder
  const albumCache = {};

  for (const obj of imageFiles) {
    try {
      const relativePath = obj.Key.replace(IMPORT_PREFIX, '');
      const parts = relativePath.split('/');

      if (parts.length < 2 || !parts[1]) {
        console.log(`Skipping ${obj.Key} - not in a subfolder`);
        results.skipped++;
        continue;
      }

      const rawAlbumName = parts[0];
      const filename = parts[parts.length - 1];
      const albumName = normalizeAlbumName(rawAlbumName);
      const ext = filename.split('.').pop().toLowerCase();

      // Check if already imported
      const duplicate = await alreadyImported(obj.Key);
      if (duplicate) {
        console.log(`Skipping duplicate: ${obj.Key}`);
        results.skipped++;
        continue;
      }

      // Get or create album (use cache to avoid duplicate creation)
      if (!albumCache[albumName]) {
        albumCache[albumName] = await findOrCreateAlbum(albumName);
      }
      const albumId = albumCache[albumName];

      // Track album names in results
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

      // Upload to proper location
      const photoId = uuidv4();
      const newKey = `photos/${albumId}/${photoId}.${ext}`;
      const thumbKey = `thumbnails/${albumId}/${photoId}_thumb.webp`;

      await Promise.all([
        uploadFile({ key: newKey, buffer, mimetype: `image/${ext === 'jpg' ? 'jpeg' : ext}` }),
        uploadFile({ key: thumbKey, buffer: thumbBuffer, mimetype: 'image/webp' }),
      ]);

      // Write Firestore record — store importedFrom so we can detect duplicates
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
        importedFrom: obj.Key,
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      // Update album photo count
      const albumRef = db.collection('albums').doc(albumId);
      const album = await albumRef.get();
      await albumRef.update({ photoCount: (album.data().photoCount || 0) + 1 });

      // Delete from imports/ after successful processing
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

      results.processed++;
      console.log(`Imported: ${filename} → album "${albumName}"`);
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

// ─── LIST PENDING (admin only) ────────────────────────────────────────────────
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: IMPORT_PREFIX });
    const listed = await s3.send(listCmd);
    const pending = (listed.Contents || [])
      .filter(obj => IMAGE_EXTS.some(ext => obj.Key.toLowerCase().endsWith(ext)) && obj.Key !== IMPORT_PREFIX)
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

// ─── DOWNLOAD ENTIRE ALBUM as zip of presigned URLs ──────────────────────────
// Returns a list of {filename, url} objects the frontend uses to download all photos
router.get('/album-download/:albumId', authenticate, async (req, res) => {
  try {
    const { albumId } = req.params;

    // Get album info
    const albumDoc = await db.collection('albums').doc(albumId).get();
    if (!albumDoc.exists) return res.status(404).json({ error: 'Album not found' });
    const album = albumDoc.data();

    // Get all photos in album
    const photosSnap = await db.collection('photos')
      .where('albumId', '==', albumId)
      .where('status', '==', 'active')
      .get();

    if (photosSnap.empty) {
      return res.status(404).json({ error: 'No photos in this album' });
    }

    // Generate presigned URLs for each photo
    const files = await Promise.all(
      photosSnap.docs.map(async doc => {
        const photo = doc.data();
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: photo.key });
        const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
        return {
          filename: photo.filename || photo.title || photo.id,
          url,
          photoId: photo.id,
        };
      })
    );

    res.json({
      albumName: album.name,
      photoCount: files.length,
      files,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to prepare album download' });
  }
});

module.exports = { router, runSync };
EOFNow add the album download button to AlbumsPage:bashrm ~/fotovault/frontend/src/pages/AlbumsPage.js
cat > ~/fotovault/frontend/src/pages/AlbumsPage.js << 'EOF'
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import ShareModal from '../components/ShareModal';

export default function AlbumsPage() {
  const { isEditor, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAlbum, setNewAlbum] = useState({ name: '', description: '', tags: '' });
  const [shareTarget, setShareTarget] = useState(null);
  const [downloading, setDownloading] = useState(null);

  const fetchAlbums = async () => {
    setLoading(true);
    try {
      const res = await api.get('/albums');
      setAlbums(res.data.albums);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAlbums(); }, []);

  const createAlbum = async (e) => {
    e.preventDefault();
    const tags = newAlbum.tags.split(',').map(t => t.trim()).filter(Boolean);
    await api.post('/albums', { ...newAlbum, tags });
    setNewAlbum({ name: '', description: '', tags: '' });
    setShowCreate(false);
    fetchAlbums();
  };

  const deleteAlbum = async (id) => {
    if (!window.confirm('Delete this album? It must be empty first.')) return;
    try {
      await api.delete(`/albums/${id}`);
      setAlbums(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const downloadAlbum = async (album) => {
    setDownloading(album.id);
    try {
      const res = await api.get(`/sync/album-download/${album.id}`);
      const { files, albumName } = res.data;

      // Download each file sequentially with correct filename
      for (const file of files) {
        const link = document.createElement('a');
        link.href = file.url;
        link.download = file.filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Small delay between downloads so browser doesn't block them
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="albums-page">
      <div className="albums-header">
        <h2>Albums</h2>
        {isEditor && (
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
            + New Album
          </button>
        )}
      </div>

      {showCreate && (
        <form className="create-album-form" onSubmit={createAlbum}>
          <input placeholder="Album name" value={newAlbum.name} required
            onChange={e => setNewAlbum({ ...newAlbum, name: e.target.value })} />
          <input placeholder="Description (optional)" value={newAlbum.description}
            onChange={e => setNewAlbum({ ...newAlbum, description: e.target.value })} />
          <input placeholder="Tags (comma separated)" value={newAlbum.tags}
            onChange={e => setNewAlbum({ ...newAlbum, tags: e.target.value })} />
          <div className="form-actions">
            <button type="submit" className="btn-primary">Create</button>
            <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-grid">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card tall" />)}
        </div>
      ) : albums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <p>No albums yet.{isEditor ? ' Create one above.' : ''}</p>
        </div>
      ) : (
        <div className="albums-grid">
          {albums.map(album => (
            <div key={album.id} className="album-card" onClick={() => navigate(`/?album=${album.id}`)}>
              <div className="album-cover">
                {album.coverPhotoUrl
                  ? <img src={album.coverPhotoUrl} alt={album.name} />
                  : <div className="album-cover-placeholder">◈</div>
                }
              </div>
              <div className="album-info">
                <h3>{album.name}</h3>
                {album.description && <p>{album.description}</p>}
                <div className="album-meta">
                  <span>{album.photoCount || 0} photos</span>
                  {album.tags?.length > 0 && (
                    <div className="album-tags">
                      {album.tags.map(t => <span key={t} className="tag-chip">#{t}</span>)}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="album-actions" onClick={e => e.stopPropagation()}>
                {/* Download entire album */}
                <button
                  className="album-action-btn"
                  title={`Download all photos in ${album.name}`}
                  onClick={() => downloadAlbum(album)}
                  disabled={downloading === album.id}
                >
                  {downloading === album.id ? '⟳' : '↓'}
                </button>

                {/* Share album */}
                {isEditor && (
                  <button
                    className="album-action-btn"
                    title="Share album"
                    onClick={() => setShareTarget(album)}
                  >
                    ⤴
                  </button>
                )}

                {/* Delete album */}
                {isAdmin && (
                  <button
                    className="album-action-btn danger"
                    title="Delete album"
                    onClick={() => deleteAlbum(album.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {shareTarget && (
        <ShareModal
          type="album"
          targetId={shareTarget.id}
          targetName={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
EOFcat > ~/fotovault/backend/routes/sync.js << 'EOF'
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

// Normalize album name — decode URI encoding, trim whitespace, normalize spaces
function normalizeAlbumName(raw) {
  try {
    return decodeURIComponent(raw).trim().replace(/\s+/g, ' ');
  } catch {
    return raw.trim().replace(/\s+/g, ' ');
  }
}

// Find album by normalized name, case-insensitive
async function findOrCreateAlbum(albumName) {
  // Get all albums and compare normalized names
  const snap = await db.collection('albums').get();
  const normalized = albumName.toLowerCase().trim();

  for (const doc of snap.docs) {
    const existing = (doc.data().name || '').toLowerCase().trim();
    if (existing === normalized) {
      return doc.id;
    }
  }

  // Not found — create it
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
  console.log(`Created new album: "${albumName}" (${albumId})`);
  return albumId;
}

// Check if this file was already imported (by original import path stored in metadata)
async function alreadyImported(importKey) {
  const snap = await db.collection('photos')
    .where('importedFrom', '==', importKey)
    .limit(1)
    .get();
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

  // Pre-build album ID cache so we don't re-query for every file in the same folder
  const albumCache = {};

  for (const obj of imageFiles) {
    try {
      const relativePath = obj.Key.replace(IMPORT_PREFIX, '');
      const parts = relativePath.split('/');

      if (parts.length < 2 || !parts[1]) {
        console.log(`Skipping ${obj.Key} - not in a subfolder`);
        results.skipped++;
        continue;
      }

      const rawAlbumName = parts[0];
      const filename = parts[parts.length - 1];
      const albumName = normalizeAlbumName(rawAlbumName);
      const ext = filename.split('.').pop().toLowerCase();

      // Check if already imported
      const duplicate = await alreadyImported(obj.Key);
      if (duplicate) {
        console.log(`Skipping duplicate: ${obj.Key}`);
        results.skipped++;
        continue;
      }

      // Get or create album (use cache to avoid duplicate creation)
      if (!albumCache[albumName]) {
        albumCache[albumName] = await findOrCreateAlbum(albumName);
      }
      const albumId = albumCache[albumName];

      // Track album names in results
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

      // Upload to proper location
      const photoId = uuidv4();
      const newKey = `photos/${albumId}/${photoId}.${ext}`;
      const thumbKey = `thumbnails/${albumId}/${photoId}_thumb.webp`;

      await Promise.all([
        uploadFile({ key: newKey, buffer, mimetype: `image/${ext === 'jpg' ? 'jpeg' : ext}` }),
        uploadFile({ key: thumbKey, buffer: thumbBuffer, mimetype: 'image/webp' }),
      ]);

      // Write Firestore record — store importedFrom so we can detect duplicates
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
        importedFrom: obj.Key,
        status: 'active',
        createdAt: new Date().toISOString(),
      });

      // Update album photo count
      const albumRef = db.collection('albums').doc(albumId);
      const album = await albumRef.get();
      await albumRef.update({ photoCount: (album.data().photoCount || 0) + 1 });

      // Delete from imports/ after successful processing
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

      results.processed++;
      console.log(`Imported: ${filename} → album "${albumName}"`);
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

// ─── LIST PENDING (admin only) ────────────────────────────────────────────────
router.get('/pending', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const listCmd = new ListObjectsV2Command({ Bucket: BUCKET, Prefix: IMPORT_PREFIX });
    const listed = await s3.send(listCmd);
    const pending = (listed.Contents || [])
      .filter(obj => IMAGE_EXTS.some(ext => obj.Key.toLowerCase().endsWith(ext)) && obj.Key !== IMPORT_PREFIX)
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

// ─── DOWNLOAD ENTIRE ALBUM as zip of presigned URLs ──────────────────────────
// Returns a list of {filename, url} objects the frontend uses to download all photos
router.get('/album-download/:albumId', authenticate, async (req, res) => {
  try {
    const { albumId } = req.params;

    // Get album info
    const albumDoc = await db.collection('albums').doc(albumId).get();
    if (!albumDoc.exists) return res.status(404).json({ error: 'Album not found' });
    const album = albumDoc.data();

    // Get all photos in album
    const photosSnap = await db.collection('photos')
      .where('albumId', '==', albumId)
      .where('status', '==', 'active')
      .get();

    if (photosSnap.empty) {
      return res.status(404).json({ error: 'No photos in this album' });
    }

    // Generate presigned URLs for each photo
    const files = await Promise.all(
      photosSnap.docs.map(async doc => {
        const photo = doc.data();
        const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: photo.key });
        const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
        return {
          filename: photo.filename || photo.title || photo.id,
          url,
          photoId: photo.id,
        };
      })
    );

    res.json({
      albumName: album.name,
      photoCount: files.length,
      files,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to prepare album download' });
  }
});

module.exports = { router, runSync };
EOFNow add the album download button to AlbumsPage:bashrm ~/fotovault/frontend/src/pages/AlbumsPage.js
cat > ~/fotovault/frontend/src/pages/AlbumsPage.js << 'EOF'
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import ShareModal from '../components/ShareModal';

export default function AlbumsPage() {
  const { isEditor, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAlbum, setNewAlbum] = useState({ name: '', description: '', tags: '' });
  const [shareTarget, setShareTarget] = useState(null);
  const [downloading, setDownloading] = useState(null);

  const fetchAlbums = async () => {
    setLoading(true);
    try {
      const res = await api.get('/albums');
      setAlbums(res.data.albums);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAlbums(); }, []);

  const createAlbum = async (e) => {
    e.preventDefault();
    const tags = newAlbum.tags.split(',').map(t => t.trim()).filter(Boolean);
    await api.post('/albums', { ...newAlbum, tags });
    setNewAlbum({ name: '', description: '', tags: '' });
    setShowCreate(false);
    fetchAlbums();
  };

  const deleteAlbum = async (id) => {
    if (!window.confirm('Delete this album? It must be empty first.')) return;
    try {
      await api.delete(`/albums/${id}`);
      setAlbums(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  const downloadAlbum = async (album) => {
    setDownloading(album.id);
    try {
      const res = await api.get(`/sync/album-download/${album.id}`);
      const { files, albumName } = res.data;

      // Download each file sequentially with correct filename
      for (const file of files) {
        const link = document.createElement('a');
        link.href = file.url;
        link.download = file.filename;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Small delay between downloads so browser doesn't block them
        await new Promise(r => setTimeout(r, 300));
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Download failed');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="albums-page">
      <div className="albums-header">
        <h2>Albums</h2>
        {isEditor && (
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
            + New Album
          </button>
        )}
      </div>

      {showCreate && (
        <form className="create-album-form" onSubmit={createAlbum}>
          <input placeholder="Album name" value={newAlbum.name} required
            onChange={e => setNewAlbum({ ...newAlbum, name: e.target.value })} />
          <input placeholder="Description (optional)" value={newAlbum.description}
            onChange={e => setNewAlbum({ ...newAlbum, description: e.target.value })} />
          <input placeholder="Tags (comma separated)" value={newAlbum.tags}
            onChange={e => setNewAlbum({ ...newAlbum, tags: e.target.value })} />
          <div className="form-actions">
            <button type="submit" className="btn-primary">Create</button>
            <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-grid">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card tall" />)}
        </div>
      ) : albums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <p>No albums yet.{isEditor ? ' Create one above.' : ''}</p>
        </div>
      ) : (
        <div className="albums-grid">
          {albums.map(album => (
            <div key={album.id} className="album-card" onClick={() => navigate(`/?album=${album.id}`)}>
              <div className="album-cover">
                {album.coverPhotoUrl
                  ? <img src={album.coverPhotoUrl} alt={album.name} />
                  : <div className="album-cover-placeholder">◈</div>
                }
              </div>
              <div className="album-info">
                <h3>{album.name}</h3>
                {album.description && <p>{album.description}</p>}
                <div className="album-meta">
                  <span>{album.photoCount || 0} photos</span>
                  {album.tags?.length > 0 && (
                    <div className="album-tags">
                      {album.tags.map(t => <span key={t} className="tag-chip">#{t}</span>)}
                    </div>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="album-actions" onClick={e => e.stopPropagation()}>
                {/* Download entire album */}
                <button
                  className="album-action-btn"
                  title={`Download all photos in ${album.name}`}
                  onClick={() => downloadAlbum(album)}
                  disabled={downloading === album.id}
                >
                  {downloading === album.id ? '⟳' : '↓'}
                </button>

                {/* Share album */}
                {isEditor && (
                  <button
                    className="album-action-btn"
                    title="Share album"
                    onClick={() => setShareTarget(album)}
                  >
                    ⤴
                  </button>
                )}

                {/* Delete album */}
                {isAdmin && (
                  <button
                    className="album-action-btn danger"
                    title="Delete album"
                    onClick={() => deleteAlbum(album.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {shareTarget && (
        <ShareModal
          type="album"
          targetId={shareTarget.id}
          targetName={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
