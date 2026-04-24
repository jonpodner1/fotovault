import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import ShareModal from '../components/ShareModal';

export default function AlbumsPage() {
  const { isEditor, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newAlbum, setNewAlbum] = useState({ name: '', description: '', tags: '' });
  const [shareTarget, setShareTarget] = useState(null);
  const [downloading, setDownloading] = useState(null);

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

  const downloadAlbum = async (album) => {
    setDownloading(album.id);
    try {
      const { auth } = await import('../firebase');
      const token = await auth.currentUser.getIdToken();
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const url = apiUrl + '/api/sync/album-download/' + album.id;

      const response = await fetch(url, {
        headers: { Authorization: 'Bearer ' + token }
      });

      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = album.name + '.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert('Download failed: ' + err.message);
    } finally {
      setDownloading(null);
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

              <div className="album-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="album-action-btn"
                  title="Download album as zip"
                  onClick={() => downloadAlbum(album)}
                  disabled={downloading === album.id}
                >
                  {downloading === album.id ? '⟳' : '↓'}
                </button>
                {isEditor && (
                  <button
                    className="album-action-btn"
                    title="Share album"
                    onClick={() => setShareTarget(album)}
                  >
                    ⤴
                  </button>
                )}
                {isAdmin && (
                  <button
                    className="album-action-btn danger"
                    title="Delete album"
                    onClick={() => deleteAlbum(album.id)}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {shareTarget && (
        <ShareModal
          type="album"
          targetId={shareTarget.id}
          targetName={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}