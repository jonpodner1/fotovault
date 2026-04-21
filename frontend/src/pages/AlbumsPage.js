import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

export default function AlbumsPage() {
  const { isEditor, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAlbum, setNewAlbum] = useState({ name: '', description: '', tags: '' });

  const fetchAlbums = async () => {
    setLoading(true);
    try {
      const res = await api.get('/albums');
      setAlbums(res.data.albums);
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAlbums(); }, []);

  const createAlbum = async (e) => {
    e.preventDefault();
    const tags = newAlbum.tags.split(',').map(t => t.trim()).filter(Boolean);
    await api.post('/albums', { ...newAlbum, tags });
    setNewAlbum({ name: '', description: '', tags: '' });
    setShowCreate(false);
    fetchAlbums();
  };

  const deleteAlbum = async (id) => {
    if (!window.confirm('Delete this album? It must be empty first.')) return;
    try {
      await api.delete(`/albums/${id}`);
      setAlbums(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Delete failed');
    }
  };

  return (
    <div className="albums-page">
      <div className="albums-header">
        <h2>Albums</h2>
        {isEditor && (
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
            + New Album
          </button>
        )}
      </div>

      {showCreate && (
        <form className="create-album-form" onSubmit={createAlbum}>
          <input placeholder="Album name" value={newAlbum.name} required
            onChange={e => setNewAlbum({ ...newAlbum, name: e.target.value })} />
          <input placeholder="Description (optional)" value={newAlbum.description}
            onChange={e => setNewAlbum({ ...newAlbum, description: e.target.value })} />
          <input placeholder="Tags (comma separated)" value={newAlbum.tags}
            onChange={e => setNewAlbum({ ...newAlbum, tags: e.target.value })} />
          <div className="form-actions">
            <button type="submit" className="btn-primary">Create</button>
            <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="loading-grid">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card tall" />)}
        </div>
      ) : albums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <p>No albums yet.{isEditor ? ' Create one above.' : ''}</p>
        </div>
      ) : (
        <div className="albums-grid">
          {albums.map(album => (
            <div key={album.id} className="album-card" onClick={() => navigate(`/?album=${album.id}`)}>
              <div className="album-cover">
                {album.coverPhotoUrl
                  ? <img src={album.coverPhotoUrl} alt={album.name} />
                  : <div className="album-cover-placeholder">◈</div>
                }
              </div>
              <div className="album-info">
                <h3>{album.name}</h3>
                {album.description && <p>{album.description}</p>}
                <div className="album-meta">
                  <span>{album.photoCount || 0} photos</span>
                  {album.tags?.length > 0 && (
                    <div className="album-tags">
                      {album.tags.map(t => <span key={t} className="tag-chip">#{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
              {isAdmin && (
                <button className="album-delete-btn" onClick={e => { e.stopPropagation(); deleteAlbum(album.id); }}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
