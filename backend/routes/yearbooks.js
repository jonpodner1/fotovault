const express = require('express');
const router = express.Router();
const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { authenticate } = require('../middleware/auth');
const { db } = require('../services/firebase');
const { uploadFile, getPresignedUrl } = require('../services/wasabi');
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
const IMPORT_PREFIX = 'imports/yearbooks/';
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

// ─── SYNC YEARBOOKS ───────────────────────────────────────────────────────────
router.post('/sync', authenticate, async (req, res) => {
  res.json({ success: true, message: 'Yearbook sync started in background' });

  (async () => {
    try {
      // Paginate through all files
      let allContents = [];
      let continuationToken = null;
      do {
        const listed = await s3.send(new ListObjectsV2Command({
          Bucket: BUCKET,
          Prefix: IMPORT_PREFIX,
          ContinuationToken: continuationToken,
        }));
        allContents = allContents.concat(listed.Contents || []);
        continuationToken = listed.IsTruncated ? listed.NextContinuationToken : null;
      } while (continuationToken);

      const imageFiles = allContents.filter(obj => {
        const key = obj.Key.toLowerCase();
        return IMAGE_EXTS.some(ext => key.endsWith(ext)) && obj.Key !== IMPORT_PREFIX;
      });

      console.log('Yearbook sync: found', imageFiles.length, 'pages to process');

      let processed = 0;
      let skipped = 0;

      for (const obj of imageFiles) {
        try {
          // Parse path: imports/yearbooks/YEAR/page.jpg
          const relativePath = obj.Key.replace(IMPORT_PREFIX, '');
          const parts = relativePath.split('/').filter(Boolean);
          if (parts.length < 2) { skipped++; continue; }

          const year = parts[0];
          const filename = parts[parts.length - 1];
          const ext = filename.split('.').pop().toLowerCase();

          // Check if already imported
          const existing = await db.collection('yearbooks')
            .where('importedFrom', '==', obj.Key)
            .limit(1).get();
          if (!existing.empty) { skipped++; continue; }

          // Download from Wasabi
          const response = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
          const buffer = await streamToBuffer(response.Body);

          // Generate thumbnail
          const thumbBuffer = await sharp(buffer)
            .rotate()
            .resize(300, 400, { fit: 'inside' })
            .webp({ quality: 75 })
            .toBuffer();

          // Determine page number from filename
          const pageNum = parseInt(filename.replace(/[^0-9]/g, '')) || (processed + 1);

          const pageId = uuidv4();
          const newKey = 'yearbooks/' + year + '/' + pageId + '.' + ext;
          const thumbKey = 'yearbooks/' + year + '/' + pageId + '_thumb.webp';

          await Promise.all([
            uploadFile({ key: newKey, buffer, mimetype: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }),
            uploadFile({ key: thumbKey, buffer: thumbBuffer, mimetype: 'image/webp' }),
          ]);

          await db.collection('yearbooks').doc(pageId).set({
            id: pageId,
            year,
            pageNumber: pageNum,
            key: newKey,
            thumbKey,
            filename,
            importedFrom: obj.Key,
            createdAt: new Date().toISOString(),
          });

          await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));

          processed++;
          console.log('Yearbook imported: ' + year + ' page ' + pageNum);
        } catch (err) {
          console.error('Yearbook sync error for', obj.Key, err.message);
          skipped++;
        }
      }

      console.log('Yearbook sync complete:', processed, 'imported,', skipped, 'skipped');
    } catch (err) {
      console.error('Yearbook sync failed:', err.message);
    }
  })();
});

// ─── LIST YEARBOOK YEARS ──────────────────────────────────────────────────────
router.get('/years', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('yearbooks').get();
    const yearMap = {};

    for (const doc of snap.docs) {
      const page = doc.data();
      if (!yearMap[page.year]) {
        yearMap[page.year] = { year: page.year, pageCount: 0, coverThumbKey: null };
      }
      yearMap[page.year].pageCount++;
      // Cover = page with lowest page number
      if (!yearMap[page.year].coverPage || page.pageNumber < yearMap[page.year].coverPage) {
        yearMap[page.year].coverPage = page.pageNumber;
        yearMap[page.year].coverThumbKey = page.thumbKey;
      }
    }

    // Attach presigned URLs for covers
    const years = await Promise.all(
      Object.values(yearMap)
        .sort((a, b) => b.year.localeCompare(a.year))
        .map(async y => ({
          ...y,
          coverUrl: y.coverThumbKey ? await getPresignedUrl(y.coverThumbKey, 86400) : null,
        }))
    );

    res.json({ years });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch yearbook years' });
  }
});

// ─── GET PAGES FOR A YEAR ─────────────────────────────────────────────────────
router.get('/:year/pages', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('yearbooks')
      .where('year', '==', req.params.year)
      .orderBy('pageNumber', 'asc')
      .get();

    if (snap.empty) return res.json({ pages: [] });

    const pages = await Promise.all(
      snap.docs.map(async doc => {
        const page = doc.data();
        return {
          ...page,
          thumbUrl: await getPresignedUrl(page.thumbKey, 86400),
          fullUrl: await getPresignedUrl(page.key, 3600),
        };
      })
    );

    res.json({ pages, year: req.params.year, total: pages.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch yearbook pages' });
  }
});

// ─── LIST PENDING YEARBOOK IMPORTS ────────────────────────────────────────────
router.get('/pending', authenticate, async (req, res) => {
  try {
    let allContents = [];
    let continuationToken = null;
    do {
      const listed = await s3.send(new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: IMPORT_PREFIX,
        ContinuationToken: continuationToken,
      }));
      allContents = allContents.concat(listed.Contents || []);
      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : null;
    } while (continuationToken);

    const pending = allContents
      .filter(obj => IMAGE_EXTS.some(ext => obj.Key.toLowerCase().endsWith(ext)))
      .map(obj => ({ key: obj.Key, size: obj.Size }));

    res.json({ count: pending.length, pending });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list pending yearbooks' });
  }
});

module.exports = router;
