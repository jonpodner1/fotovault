import React, { useEffect, useState } from 'react';
import api from '../utils/api';

export default function PhotoLightbox({ photo, photos, onClose, onNavigate, onDownload }) {
  const [fullUrl, setFullUrl] = useState(null);
  const currentIndex = photos.findIndex(p => p.id === photo.id);

  useEffect(() => {
    setFullUrl(null);
    api.get(`/photos/${photo.id}`).then(r => setFullUrl(r.data.fullUrl));
  }, [photo.id]);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(photos[currentIndex - 1]);
      if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) onNavigate(photos[currentIndex + 1]);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentIndex, photos, onClose, onNavigate]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-box" onClick={e => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>✕</button>

        <div className="lightbox-image-wrap">
          {!fullUrl ? (
            <div className="lightbox-loading">Loading…</div>
          ) : (
            <img src={fullUrl} alt={photo.title || photo.filename} className="lightbox-image" />
          )}
        </div>

        <div className="lightbox-nav">
          <button
            className="lightbox-arrow"
            disabled={currentIndex === 0}
            onClick={() => onNavigate(photos[currentIndex - 1])}
          >←</button>
          <span className="lightbox-counter">{currentIndex + 1} / {photos.length}</span>
          <button
            className="lightbox-arrow"
            disabled={currentIndex === photos.length - 1}
            onClick={() => onNavigate(photos[currentIndex + 1])}
          >→</button>
        </div>

        <div className="lightbox-meta">
          <div>
            {photo.title && <h3 className="lightbox-title">{photo.title}</h3>}
            {photo.tags?.length > 0 && (
              <div className="photo-tags">
                {photo.tags.map(t => <span key={t} className="tag-chip">#{t}</span>)}
              </div>
            )}
            <p className="lightbox-info">
              Uploaded by {photo.uploaderName} · {new Date(photo.createdAt).toLocaleDateString()}
            </p>
          </div>
          <button className="btn-primary" onClick={() => onDownload(photo)}>↓ Download</button>
        </div>
      </div>
    </div>
  );
}
