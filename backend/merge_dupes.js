require('dotenv').config();
const { db } = require('./services/firebase');

async function mergeDuplicates() {
  const snap = await db.collection('albums').get();
  const albums = snap.docs.map(d => ({ docRef: d.ref, ...d.data() }));

  const groups = {};
  for (const album of albums) {
    const key = (album.name + '||' + (album.schoolYear || '') + '||' + (album.parentId || 'null')).toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(album);
  }

  const dupes = Object.entries(groups).filter(([k, v]) => v.length > 1);
  console.log('Found', dupes.length, 'duplicate groups to merge\n');

  let totalMerged = 0;
  let totalDeleted = 0;

  for (const [key, group] of dupes) {
    group.sort((a, b) => {
      const aScore = (a.photoCount || 0) + (a.subAlbumCount || 0) * 100;
      const bScore = (b.photoCount || 0) + (b.subAlbumCount || 0) * 100;
      return bScore - aScore;
    });

    const winner = group[0];
    const losers = group.slice(1);

    console.log('Merging into:', winner.name, '(' + winner.id + ') photos:', winner.photoCount, 'subAlbums:', winner.subAlbumCount);

    for (const loser of losers) {
      const photosSnap = await db.collection('photos').where('albumId', '==', loser.id).get();
      if (!photosSnap.empty) {
        console.log('  Moving', photosSnap.size, 'photos from', loser.id);
        const batch = db.batch();
        photosSnap.docs.forEach(doc => batch.update(doc.ref, { albumId: winner.id }));
        await batch.commit();
        totalMerged += photosSnap.size;
      }

      const allAlbumsSnap = await db.collection('albums').get();
      const subs = allAlbumsSnap.docs.filter(d => d.data().parentId === loser.id);
      if (subs.length > 0) {
        console.log('  Moving', subs.length, 'sub-albums from', loser.id);
        const batch = db.batch();
        subs.forEach(doc => batch.update(doc.ref, { parentId: winner.id }));
        await batch.commit();
      }

      await loser.docRef.delete();
      totalDeleted++;
      console.log('  Deleted duplicate:', loser.id);
    }

    const finalPhotos = await db.collection('photos').where('albumId', '==', winner.id).where('status', '==', 'active').get();
    const allAlbumsSnap2 = await db.collection('albums').get();
    const subCount = allAlbumsSnap2.docs.filter(d => d.data().parentId === winner.id).length;
    await winner.docRef.update({ photoCount: finalPhotos.size, subAlbumCount: subCount });
    console.log('  Winner updated: photos=' + finalPhotos.size + ' subAlbums=' + subCount + '\n');
  }

  console.log('Done! Merged', totalMerged, 'photos, deleted', totalDeleted, 'duplicate albums');
  process.exit(0);
}

mergeDuplicates().catch(e => { console.error(e); process.exit(1); });
