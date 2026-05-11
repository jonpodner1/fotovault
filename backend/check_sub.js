require('dotenv').config();
const { db } = require('./services/firebase');
db.collection('albums').where('parentId', '==', 'be48e322-b9b3-4bb2-84e1-e242f9612fc2').get().then(snap => {
  console.log('Sub-albums found:', snap.size);
  snap.docs.forEach(d => console.log(JSON.stringify(d.data())));
  process.exit(0);
});
