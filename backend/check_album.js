require('dotenv').config();
const { db } = require('./services/firebase');
db.collection('albums').doc('be48e322-b9b3-4bb2-84e1-e242f9612fc2').get().then(doc => {
  console.log(JSON.stringify(doc.data(), null, 2));
  process.exit(0);
});
