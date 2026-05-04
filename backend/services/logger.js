// Activity Logger Service
// Buffers events in memory and flushes to Wasabi every 5 minutes as daily CSV files

const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

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
const FLUSH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LOG_RETENTION_DAYS = 365; // 1 year

// In-memory buffer
let eventBuffer = [];

function getDateString(date = new Date()) {
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getLogKey(dateStr) {
  return 'logs/' + dateStr + '.csv';
}

const CSV_HEADER = 'timestamp,event_type,user_email,user_name,role,target_name,target_id,album_name,ip_address,details\n';

function escapeCSV(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function eventToCSVRow(event) {
  return [
    event.timestamp,
    event.event_type,
    event.user_email,
    event.user_name,
    event.role,
    event.target_name,
    event.target_id,
    event.album_name,
    event.ip_address,
    event.details,
  ].map(escapeCSV).join(',') + '\n';
}

// Add an event to the buffer
function logEvent(event) {
  eventBuffer.push({
    timestamp: new Date().toISOString(),
    event_type: event.type || 'unknown',
    user_email: event.userEmail || 'anonymous',
    user_name: event.userName || 'anonymous',
    role: event.role || 'user',
    target_name: event.targetName || '',
    target_id: event.targetId || '',
    album_name: event.albumName || '',
    ip_address: event.ip || '',
    details: event.details || '',
  });
}

// Flush buffer to Wasabi
async function flushLogs() {
  if (eventBuffer.length === 0) return;

  const toFlush = [...eventBuffer];
  eventBuffer = [];

  // Group events by date
  const byDate = {};
  for (const event of toFlush) {
    const dateStr = event.timestamp.split('T')[0];
    if (!byDate[dateStr]) byDate[dateStr] = [];
    byDate[dateStr].push(event);
  }

  for (const [dateStr, events] of Object.entries(byDate)) {
    try {
      const key = getLogKey(dateStr);
      let existing = '';

      // Try to fetch existing log for this date
      try {
        const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
        const res = await s3.send(getCmd);
        const chunks = [];
        for await (const chunk of res.Body) chunks.push(chunk);
        existing = Buffer.concat(chunks).toString('utf-8');
      } catch {
        // File doesn't exist yet — start with header
        existing = CSV_HEADER;
      }

      // Append new rows
      const newRows = events.map(eventToCSVRow).join('');
      const updated = existing + newRows;

      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: updated,
        ContentType: 'text/csv',
      }));

      console.log('Flushed', events.length, 'log events to', key);
    } catch (err) {
      console.error('Failed to flush logs for', dateStr, err.message);
      // Put events back in buffer to retry
      eventBuffer = [...events, ...eventBuffer];
    }
  }
}

// Delete logs older than 1 year
async function cleanupOldLogs() {
  try {
    const { ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOG_RETENTION_DAYS);

    const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'logs/' }));
    for (const obj of (listed.Contents || [])) {
      const dateStr = obj.Key.replace('logs/', '').replace('.csv', '');
      if (new Date(dateStr) < cutoff) {
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
        console.log('Deleted old log:', obj.Key);
      }
    }
  } catch (err) {
    console.error('Log cleanup error:', err.message);
  }
}

// Start flush interval
function startLogger() {
  setInterval(flushLogs, FLUSH_INTERVAL_MS);
  // Run cleanup once a day at midnight
  setInterval(cleanupOldLogs, 24 * 60 * 60 * 1000);
  console.log('Activity logger started - flushing every 5 minutes to Wasabi logs/');
}

module.exports = { logEvent, flushLogs, startLogger };
