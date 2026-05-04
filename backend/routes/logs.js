const express = require('express');
const router = express.Router();
const { S3Client, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { authenticate, requireRole } = require('../middleware/auth');
const { flushLogs } = require('../services/logger');

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

// ─── LIST AVAILABLE LOG DATES ─────────────────────────────────────────────────
router.get('/dates', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'logs/' }));
    const dates = (listed.Contents || [])
      .map(obj => obj.Key.replace('logs/', '').replace('.csv', ''))
      .filter(d => d.match(/^\d{4}-\d{2}-\d{2}$/))
      .sort((a, b) => b.localeCompare(a)); // newest first
    res.json({ dates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list log dates' });
  }
});

// ─── GET LOG FOR A SPECIFIC DATE ──────────────────────────────────────────────
router.get('/:date', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { date } = req.params;
    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const key = 'logs/' + date + '.csv';

    try {
      const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
      const result = await s3.send(getCmd);
      const chunks = [];
      for await (const chunk of result.Body) chunks.push(chunk);
      const csv = Buffer.concat(chunks).toString('utf-8');

      // Parse CSV to JSON for the frontend
      const lines = csv.trim().split('\n');
      if (lines.length < 2) return res.json({ events: [], date });

      const headers = lines[0].split(',');
      const events = lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        const obj = {};
        headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
        return obj;
      }).filter(e => e.timestamp);

      res.json({ events, date, total: events.length });
    } catch {
      res.json({ events: [], date, total: 0, message: 'No logs for this date' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ─── DOWNLOAD RAW CSV ─────────────────────────────────────────────────────────
router.get('/:date/download', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { date } = req.params;
    const key = 'logs/' + date + '.csv';
    const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const result = await s3.send(getCmd);
    const chunks = [];
    for await (const chunk of result.Body) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf-8');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fotovault-logs-' + date + '.csv"');
    res.send(csv);
  } catch {
    res.status(404).json({ error: 'No log file for this date' });
  }
});

// ─── FORCE FLUSH (admin only) ─────────────────────────────────────────────────
router.post('/flush', authenticate, requireRole('admin'), async (req, res) => {
  try {
    await flushLogs();
    res.json({ success: true, message: 'Logs flushed to Wasabi' });
  } catch (err) {
    res.status(500).json({ error: 'Flush failed' });
  }
});

// Simple CSV line parser that handles quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (line[i] === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += line[i];
    }
  }
  result.push(current);
  return result;
}

module.exports = router;
