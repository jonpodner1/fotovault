require('dotenv').config();
const { db } = require('./services/firebase');

async function fixCounts() {
  const snap = await db.collection('albums').get();
  const albums = snap.docs.map(d => ({ ref: d.ref, ...d.data() }));

  console.log('Fixing sub-album counts for', albums.length, 'albums...');

  for (const album of albums) {
    // Count actual sub-albums
    const actualSubs = albums.filter(a => a.parentId === album.id).length;
    
    // Count actual photos
    const photosSnap = await db.collection('photos')
      .where('albumId', '==', album.id)
      .where('status', '==', 'active')
      .get();
    const actualPhotos = photosSnap.size;

    if (actualSubs !== (album.subAlbumCount || 0) || actualPhotos !== (album.photoCount || 0)) {
      await album.ref.update({ subAlbumCount: actualSubs, photoCount: actualPhotos });
      console.log('Fixed:', album.name, '| subAlbums:', album.subAlbumCount, '->', actualSubs, '| photos:', album.photoCount, '->', actualPhotos);
    }
  }

  console.log('Done!');
  process.exit(0);
}

fixCounts().catch(e => { console.error(e); process.exit(1); });
