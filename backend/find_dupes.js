require('dotenv').config();
const { db } = require('./services/firebase');

async function findDuplicates() {
  const snap = await db.collection('albums').get();
  const albums = snap.docs.map(d => d.data());
  
  const groups = {};
  for (const album of albums) {
    const key = (album.name + '||' + (album.schoolYear || '') + '||' + (album.parentId || 'null')).toLowerCase();
    if (!groups[key]) groups[key] = [];
    groups[key].push(album);
  }
  
  const dupes = Object.entries(groups).filter(([k, v]) => v.length > 1);
  console.log('Found', dupes.length, 'duplicate groups:');
  for (const [key, group] of dupes) {
    console.log('');
    console.log('Group:', group[0].name, '(' + group[0].schoolYear + ')');
    group.forEach(a => console.log('  -', a.id, '| subAlbums:', a.subAlbumCount, '| photos:', a.photoCount));
  }
  process.exit(0);
}

findDuplicates().catch(e => { console.error(e); process.exit(1); });
