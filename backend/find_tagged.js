require('dotenv').config();
const { db } = require('./services/firebase');
db.collection('photos').where('tags', 'array-contains', '5-4 Game').get().then(snap => {
  console.log('Found:', snap.size, 'photos');
  snap.docs.slice(0, 5).forEach(d => {
    const p = d.data();
    console.log(p.id, '| album:', p.albumId, '| filename:', p.filename);
  });
  process.exit(0);
});
