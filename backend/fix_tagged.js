require('dotenv').config();
const { db } = require('./services/firebase');
const { v4: uuidv4 } = require('uuid');

async function fix() {
  const PARENT_ID = 'be48e322-b9b3-4bb2-84e1-e242f9612fc2';
  const TAG = '5-4 Game';

  // Create the sub-album
  const subAlbumId = uuidv4();
  await db.collection('albums').doc(subAlbumId).set({
    id: subAlbumId,
    name: '5-4 Game',
    description: '',
    tags: [],
    isPublic: false,
    schoolYear: '',
    parentId: PARENT_ID,
    photoCount: 0,
    subAlbumCount: 0,
    createdBy: 'admin-fix',
    creatorName: 'Admin Fix',
    createdAt: new Date().toISOString(),
    coverPhotoUrl: null,
  });
  console.log('Created sub-album:', subAlbumId);

  // Move photos into sub-album and clear tag
  const snap = await db.collection('photos')
    .where('tags', 'array-contains', TAG).get();

  console.log('Moving', snap.size, 'photos...');
  let count = 0;
  for (const doc of snap.docs) {
    const photo = doc.data();
    const newTags = (photo.tags || []).filter(t => t !== TAG);
    await doc.ref.update({
      albumId: subAlbumId,
      parentAlbumId: PARENT_ID,
      tags: newTags,
    });
    count++;
  }

  // Update sub-album photo count
  await db.collection('albums').doc(subAlbumId).update({ photoCount: count });

  // Update parent sub-album count
  const parent = await db.collection('albums').doc(PARENT_ID).get();
  await db.collection('albums').doc(PARENT_ID).update({
    subAlbumCount: (parent.data().subAlbumCount || 0) + 1,
    photoCount: Math.max(0, (parent.data().photoCount || 0) - count),
  });

  console.log('Done! Moved', count, 'photos to 5-4 Game sub-album');
  process.exit(0);
}

fix().catch(e => { console.error(e); process.exit(1); });
