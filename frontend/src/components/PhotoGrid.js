import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import MovePhotoModal from './MovePhotoModal';

export default function PhotoGrid({ photos, onPhotoClick, onDownload, onDelete, onShare, onMoved }) {
  const { isAdmin, isEditor } = useAuth();
  const [moveTarget, setMoveTarget] = useState(null);

  if (photos.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◻</div>
        <p>No photos here yet.</p>
      </div>
    );
  }

  return (
    <>
      <div className="photo-grid">
        {photos.map(photo => (
          <div key={photo.id} className="photo-card" onClick={() => onPhotoClick(photo)}>
            <div className="photo-thumb-wrap">
              <img
                src={photo.thumbUrl}
                alt={photo.title || photo.filename}
                className="photo-thumb"
                loading="lazy"
              />
              <div className="photo-overlay">
                <div className="photo-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="photo-action-btn"
                    title="Download"
                    onClick={() => onDownload(photo)}
                  >
                    ↓
                  </button>
                  {isEditor && (
                    <button
                      className="photo-action-btn"
                      title="Share"
                      onClick={() => onShare(photo)}
                    >
                      ⤴
                    </button>
                  )}
                  {isEditor && (
                    <button
                      className="photo-action-btn"
                      title="Move to album"
                      onClick={() => setMoveTarget(photo)}
                    >
                      ⇄
                    </button>
                  )}
                  {isAdmin && (
                    <button
                      className="photo-action-btn danger"
                      title="Delete"
                      onClick={() => onDelete(photo.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
            {(photo.title || photo.tags?.length > 0) && (
              <div className="photo-caption">
                {photo.title && <span className="photo-title">{photo.title}</span>}
                {photo.tags?.length > 0 && (
                  <div className="photo-tags">
                    {photo.tags.map(t => <span key={t} className="tag-chip small">#{t}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {moveTarget && (
        <MovePhotoModal
          photo={moveTarget}
          onClose={() => setMoveTarget(null)}
          onMoved={(photoId, newAlbumId) => {
            if (onMoved) onMoved(photoId, newAlbumId);
            setMoveTarget(null);
          }}
        />
      )}
    </>
  );
}
