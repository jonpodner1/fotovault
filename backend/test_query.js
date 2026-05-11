require('dotenv').config();
const { db } = require('./services/firebase');
async function test() {
  const snap = await db.collection('photos')
    .where('albumId', '==', 'f0bc4d15-043c-4dcd-b9d4-098dfa6a2e36')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  console.log('Results:', snap.size);
  process.exit(0);
}
test().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
