import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

export default function SharePage() {
  const { token } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    api.get(`/shares/${token}`)
      .then(r => setData(r.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDownload = async (photo) => {
    const res = await api.get(`/shares/${token}`);
    const p = res.data.content?.photos
      ? res.data.content.photos.find(x => x.id === photo.id)
      : res.data.content;
    const link = document.createElement('a');
    link.href = p.fullUrl || p.thumbUrl;
    link.download = photo.filename;
    link.click();
  };

  if (loading) return (
    <div className="share-page">
      <div className="full-loading"><span className="logo-icon spin">◈</span></div>
    </div>
  );

  if (error) return (
    <div className="share-page">
      <div className="share-error">
        <div className="empty-icon">◻</div>
        <h2>{error}</h2>
        <p>This link may have expired or been removed.</p>
      </div>
    </div>
  );

  const { share, content } = data;
  const isAlbum = share.type === 'album';

  return (
    <div className="share-page">
      <div className="share-header">
        <div className="share-brand">
          <span className="logo-icon">◈</span>
          <span>FotoVault</span>
        </div>
        {isAlbum ? (
          <div className="share-title">
            <h1>{content.album.name}</h1>
            {content.album.description && <p>{content.album.description}</p>}
            <span className="share-meta">{content.photos.length} photos</span>
          </div>
        ) : (
          <div className="share-title">
            <h1>{content.title || content.filename}</h1>
          </div>
        )}
      </div>

      {isAlbum ? (
        <div className="share-grid">
          {content.photos.map(photo => (
            <div key={photo.id} className="photo-card" onClick={() => setLightbox(photo)}>
              <div className="photo-thumb-wrap">
                <img src={photo.thumbUrl} alt={photo.title} className="photo-thumb" loading="lazy" />
                <div className="photo-overlay">
                  {share.allowDownload && (
                    <div className="photo-actions" onClick={e => e.stopPropagation()}>
                      <button className="photo-action-btn" onClick={() => handleDownload(photo)}>↓</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="share-single">
          <img src={content.fullUrl} alt={content.title} className="share-single-img" />
          {share.allowDownload && (
            <button className="btn-primary share-download" onClick={() => handleDownload(content)}>
              ↓ Download
            </button>
          )}
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-box" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setLightbox(null)}>✕</button>
            <div className="lightbox-image-wrap">
              <img src={lightbox.fullUrl || lightbox.thumbUrl} alt={lightbox.title} className="lightbox-image" />
            </div>
            <div className="lightbox-meta">
              <div>
                {lightbox.title && <h3 className="lightbox-title">{lightbox.title}</h3>}
              </div>
              {share.allowDownload && (
                <button className="btn-primary" onClick={() => handleDownload(lightbox)}>↓ Download</button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="share-footer">
        Shared via FotoVault
        {share.expiresAt && (
          <span> · Expires {new Date(share.expiresAt).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}
