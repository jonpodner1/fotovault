require('dotenv').config();
const { db } = require('./services/firebase');
db.collection('photos').where('albumId', '==', 'f0bc4d15-043c-4dcd-b9d4-098dfa6a2e36').limit(5).get().then(snap => {
  console.log('Photos in 5-4 Game:', snap.size);
  snap.docs.forEach(d => console.log(d.data().id, '| status:', d.data().status, '| filename:', d.data().filename));
  process.exit(0);
});
