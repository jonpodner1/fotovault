const express = require('express');
const router = express.Router();
const { db, auth } = require('../services/firebase');
const { authenticate, requireRole } = require('../middleware/auth');

// ─── GET CURRENT USER PROFILE ─────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.user.uid).get();
    res.json(doc.exists ? doc.data() : { ...req.user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ─── UPSERT USER ON FIRST LOGIN ───────────────────────────────────────────────
router.post('/register', authenticate, async (req, res) => {
  try {
    const { displayName } = req.body;
    const userRef = db.collection('users').doc(req.user.uid);
    const existing = await userRef.get();

    if (!existing.exists) {
      await userRef.set({
        uid: req.user.uid,
        email: req.user.email,
        displayName: displayName || req.user.displayName || req.user.email,
        role: 'user',
        createdAt: new Date().toISOString(),
      });
    }

    const doc = await userRef.get();
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// ─── LIST ALL USERS (admin only) ──────────────────────────────────────────────
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
    const users = snapshot.docs.map(doc => doc.data());
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// ─── UPDATE USER ROLE (admin only) ────────────────────────────────────────────
router.patch('/:uid/role', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['user', 'editor', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });
    }

    // Prevent self-demotion
    if (req.params.uid === req.user.uid && role !== 'admin') {
      return res.status(400).json({ error: 'Cannot change your own admin role' });
    }

    await db.collection('users').doc(req.params.uid).update({
      role,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── DELETE USER (admin only) ─────────────────────────────────────────────────
router.delete('/:uid', authenticate, requireRole('admin'), async (req, res) => {
  try {
    if (req.params.uid === req.user.uid) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    await Promise.all([
      auth.deleteUser(req.params.uid),
      db.collection('users').doc(req.params.uid).delete(),
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
