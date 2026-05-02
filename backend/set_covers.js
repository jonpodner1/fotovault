// Run this once to set cover photos for all existing albums
// node set_covers.js
require('dotenv').config();
const { db } = require('./services/firebase');
const { getPresignedUrl } = require('./services/wasabi');

async function setCoverPhotos() {
  const albumsSnap = await db.collection('albums').get();
  let updated = 0;
  let skipped = 0;

  for (const albumDoc of albumsSnap.docs) {
	const album = albumDoc.data();

	// Skip if already has a cover
	if (album.coverPhotoUrl && !album.coverPhotoUrl.startsWith('thumbnails/')) {
	  skipped++;
	  continue;
	}

	// Find the first active photo in this album
	const photosSnap = await db.collection('photos')
	  .where('albumId', '==', album.id)
	  .where('status', '==', 'active')
	  .limit(1)
	  .get();

	if (photosSnap.empty) {
	  skipped++;
	  continue;
	}

	const photo = photosSnap.docs[0].data();
	const thumbKey = photo.thumbKey || photo.key;

	// Store just the key — we generate presigned URLs on the fly
	await albumDoc.ref.update({ coverPhotoUrl: thumbKey });
	console.log('Set cover for:', album.name, '->', thumbKey);
	updated++;
  }

  console.log('\nDone! Updated:', updated, '| Skipped:', skipped);
  process.exit(0);
}

setCoverPhotos().catch(e => { console.error(e); process.exit(1); });