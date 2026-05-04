require('dotenv').config();
const { db } = require('./services/firebase');
db.collection('albums').get().then(snap => {
  console.log('Total albums:', snap.size);
  snap.docs.forEach(d => {
    const a = d.data();
    console.log(JSON.stringify({
      id: a.id,
      name: a.name,
      parentId: a.parentId || null,
      schoolYear: a.schoolYear || '',
      photoCount: a.photoCount || 0,
      subAlbumCount: a.subAlbumCount || 0
    }));
  });
  process.exit(0);
});
