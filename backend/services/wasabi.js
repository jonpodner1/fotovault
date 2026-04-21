const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

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

/**
 * Upload a file buffer to Wasabi
 */
async function uploadFile({ key, buffer, mimetype, metadata = {} }) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimetype,
    Metadata: metadata,
  });
  await s3.send(command);
  return key;
}

/**
 * Generate a presigned download URL (1 hour default)
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Generate a presigned upload URL for direct browser → Wasabi uploads
 */
async function getPresignedUploadUrl(key, mimetype, expiresIn = 900) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimetype,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Delete a file from Wasabi
 */
async function deleteFile(key) {
  const command = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await s3.send(command);
}

module.exports = { uploadFile, getPresignedUrl, getPresignedUploadUrl, deleteFile };
