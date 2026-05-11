import React, { useState, useEffect } from 'react';
import api from '../utils/api';

export default function MovePhotoModal({ photo, onClose, onMoved }) {
  const [albums, setAlbums] = useState([]);
  const [selectedAlbum, setSelectedAlbum] = useState('');
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    // Load all albums including sub-albums
    async function loadAllAlbums() {
      try {
        const res = await api.get('/albums');
        const topLevel = res.data.albums;
        const all = [];

        for (const album of topLevel) {
          all.push({ ...album, displayName: album.name, level: 0 });
          if (album.subAlbumCount > 0) {
            const subRes = await api.get('/albums/' + album.id + '/subalbums');
            for (const sub of subRes.data.subAlbums) {
              all.push({ ...sub, displayName: album.name + ' / ' + sub.name, level: 1 });
            }
          }
        }

        setAlbums(all);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadAllAlbums();
  }, []);

  const handleMove = async () => {
    if (!selectedAlbum) return;
    setMoving(true);
    try {
      await api.patch('/photos/' + photo.id + '/move', { albumId: selectedAlbum });
      onMoved(photo.id, selectedAlbum);
      onClose();
    } catch (err) {
      alert('Failed to move photo: ' + (err.response?.data?.error || err.message));
    } finally {
      setMoving(false);
    }
  };

  const filtered = albums.filter(a =>
    a.id !== photo.albumId &&
    a.displayName.toLowerCase().includes(search.toLowerCase())
  );

  const selectedAlbumName = albums.find(a => a.id === selectedAlbum)?.displayName;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Move Photo</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '16px 20px' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: 12 }}>
            Moving: <strong>{photo.title || photo.filename}</strong>
          </p>

          <input
            type="text"
            placeholder="Search albums..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="auth-input"
            style={{ marginBottom: 8 }}
          />

          {loading ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)' }}>
              Loading albums...
            </div>
          ) : (
            <div style={{
              maxHeight: 280,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 6,
              marginBottom: 16,
            }}>
              {filtered.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem' }}>
                  No albums found
                </div>
              ) : (
                filtered.map(album => (
                  <div
                    key={album.id}
                    onClick={() => setSelectedAlbum(album.id)}
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      background: selectedAlbum === album.id ? 'var(--accent-dim)' : 'transparent',
                      color: selectedAlbum === album.id ? 'var(--accent)' : 'var(--text)',
                      fontSize: '0.875rem',
                      paddingLeft: album.level === 1 ? 28 : 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {album.level === 1 && <span style={{ color: 'var(--text-3)' }}>↳</span>}
                    {album.displayName}
                    <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-3)' }}>
                      {album.photoCount || 0} photos
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleMove}
              disabled={!selectedAlbum || moving}
            >
              {moving ? 'Moving...' : selectedAlbumName ? 'Move to ' + selectedAlbumName : 'Select an album'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
