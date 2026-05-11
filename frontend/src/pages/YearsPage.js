import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import ShareModal from '../components/ShareModal';

export default function YearsPage() {
  const { year } = useParams();
  const navigate = useNavigate();
  const { isEditor, isAdmin } = useAuth();
  const [years, setYears] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [shareTarget, setShareTarget] = useState(null);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    api.get('/albums/years/list').then(r => setYears(r.data.years)).catch(() => {});
  }, []);

  useEffect(() => {
    if (year) {
      setLoading(true);
      api.get('/albums', { params: { schoolYear: year } })
        .then(r => setAlbums(r.data.albums))
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [year]);

  const handleAlbumClick = (album) => {
    if (album.parentId) {
      // Already a sub-album — go straight to photos
      navigate('/?album=' + album.id);
    } else if (album.subAlbumCount > 0 || isEditor) {
      // Top-level album — go to sub-album view
      navigate('/albums/' + album.id);
    } else {
      navigate('/?album=' + album.id);
    }
  };

  const downloadAlbum = async (album) => {
    setDownloading(album.id);
    try {
      const { auth } = await import('../firebase');
      const token = await auth.currentUser.getIdToken();
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const url = apiUrl + '/api/sync/album-download/' + album.id;
      const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
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

  // No year selected — show year picker
  if (!year) {
    return (
      <div className="years-page">
        <div className="years-header">
          <h2>School Years</h2>
        </div>
        {years.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◻</div>
            <p>No school years yet. Upload photos with a year folder like <code>imports/2025-2026/Album Name/</code></p>
          </div>
        ) : (
          <div className="years-grid">
            {years.map(y => (
              <div key={y} className="year-card" onClick={() => navigate('/years/' + y)}>
                <div className="year-icon">◈</div>
                <h3>{y}</h3>
                <p>School Year</p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Year selected — show albums for that year
  return (
    <div className="years-page">
      <div className="years-header">
        <div className="years-breadcrumb">
          <button className="btn-ghost small" onClick={() => navigate('/years')}>← All Years</button>
          <h2>{year}</h2>
        </div>
      </div>

      {loading ? (
        <div className="loading-grid">
          {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card tall" />)}
        </div>
      ) : albums.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◻</div>
          <p>No albums for {year} yet.</p>
        </div>
      ) : (
        <div className="albums-grid">
          {albums.map(album => (
            <div key={album.id} className="album-card" onClick={() => handleAlbumClick(album)}>
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
                  {album.subAlbumCount > 0 && (
                    <span style={{ marginLeft: 8, color: 'var(--accent)' }}>
                      {album.subAlbumCount} sub-albums
                    </span>
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