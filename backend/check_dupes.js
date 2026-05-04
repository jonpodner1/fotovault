require('dotenv').config();
const { db } = require('./services/firebase');
db.collection('albums').get().then(snap => {
  snap.docs.forEach(d => {
    const a = d.data();
    if (a.name === '10-14 Game') {
      console.log(a.id, '| parent:', a.parentId, '| photos:', a.photoCount);
    }
  });
  process.exit(0);
});
