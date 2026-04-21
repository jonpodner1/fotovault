import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import PhotoGrid from '../components/PhotoGrid';
import UploadModal from '../components/UploadModal';
import PhotoLightbox from '../components/PhotoLightbox';

export default function GalleryPage() {
  const { isEditor } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);

  const albumFilter = searchParams.get('album') || '';
  const tagFilter = searchParams.get('tag') || '';

  const fetchPhotos = async () => {
    setLoading(true);
    try {
      const params = {};
      if (albumFilter) params.albumId = albumFilter;
      if (tagFilter) params.tag = tagFilter;
      const res = await api.get('/photos', { params });
      setPhotos(res.data.photos);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlbums = async () => {
    try {
      const res = await api.get('/albums');
      setAlbums(res.data.albums);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchPhotos(); }, [albumFilter, tagFilter]);
  useEffect(() => { fetchAlbums(); }, []);

  const handleDownload = async (photo) => {
    const res = await api.get(`/photos/${photo.id}`);
    const link = document.createElement('a');
    link.href = res.data.fullUrl;
    link.download = photo.filename;
    link.click();
  };

  const handleDelete = async (photoId) => {
    if (!window.confirm('Delete this photo permanently?')) return;
    await api.delete(`/photos/${photoId}`);
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  // Collect all unique tags from current photos
  const allTags = [...new Set(photos.flatMap(p => p.tags || []))];

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <div className="gallery-filters">
          <select
            value={albumFilter}
            onChange={e => setSearchParams(prev => { e.target.value ? prev.set('album', e.target.value) : prev.delete('album'); return prev; })}
            className="filter-select"
          >
            <option value="">All Albums</option>
            {albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {allTags.length > 0 && (
            <div className="tag-filters">
              {allTags.map(tag => (
                <button
                  key={tag}
                  className={`tag-chip ${tagFilter === tag ? 'active' : ''}`}
                  onClick={() => setSearchParams(prev => {
                    tagFilter === tag ? prev.delete('tag') : prev.set('tag', tag);
                    return prev;
                  })}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
        </div>

        {isEditor && (
          <button className="btn-primary upload-btn" onClick={() => setShowUpload(true)}>
            + Upload Photos
          </button>
        )}
      </div>

      {loading ? (
        <div className="loading-grid">
          {[...Array(12)].map((_, i) => <div key={i} className="skeleton-card" />)}
        </div>
      ) : (
        <PhotoGrid
          photos={photos}
          onPhotoClick={setLightboxPhoto}
          onDownload={handleDownload}
          onDelete={handleDelete}
        />
      )}

      {showUpload && (
        <UploadModal
          albums={albums}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); fetchPhotos(); }}
        />
      )}

      {lightboxPhoto && (
        <PhotoLightbox
          photo={lightboxPhoto}
          photos={photos}
          onClose={() => setLightboxPhoto(null)}
          onNavigate={setLightboxPhoto}
          onDownload={handleDownload}
        />
      )}
    </div>
  );
}
