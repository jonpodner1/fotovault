require('dotenv').config();
const { db } = require('./services/firebase');
async function fix() {
  // Girls Soccer parent has no direct photos now, only sub-albums
  await db.collection('albums').doc('be48e322-b9b3-4bb2-84e1-e242f9612fc2').update({
    photoCount: 0,
    subAlbumCount: 1,
  });
  console.log('Fixed Girls Soccer counts');
  process.exit(0);
}
fix().catch(e => { console.error(e); process.exit(1); });
