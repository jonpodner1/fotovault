require('dotenv').config();
const { db } = require('./services/firebase');
async function count() {
  const snap = await db.collection('photos')
    .where('albumId', '==', 'f0bc4d15-043c-4dcd-b9d4-098dfa6a2e36')
    .where('status', '==', 'active')
    .get();
  console.log('Total active photos in 5-4 Game:', snap.size);
  process.exit(0);
}
count().catch(e => { console.error(e.message); process.exit(1); });
