import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import PhotoGrid from '../components/PhotoGrid';
import UploadModal from '../components/UploadModal';
import PhotoLightbox from '../components/PhotoLightbox';
import ShareModal from '../components/ShareModal';

export default function GalleryPage() {
  const { isEditor } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [photos, setPhotos] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const observerRef = useRef(null);
  const sentinelRef = useRef(null);

  const albumFilter = searchParams.get('album') || '';
  const tagFilter = searchParams.get('tag') || '';
  const yearFilter = searchParams.get('year') || '';

  // Fetch first page
  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    setPhotos([]);
    setNextCursor(null);
    setHasMore(true);
    try {
      const params = { limit: 50 };
      if (albumFilter) params.albumId = albumFilter;
      if (tagFilter) params.tag = tagFilter;
      const res = await api.get('/photos', { params });
      setPhotos(res.data.photos);
      setNextCursor(res.data.nextCursor);
      setHasMore(res.data.hasMore);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [albumFilter, tagFilter]);

  // Fetch next page
  const fetchMore = useCallback(async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    setLoadingMore(true);
    try {
      const params = { limit: 50, cursor: nextCursor };
      if (albumFilter) params.albumId = albumFilter;
      if (tagFilter) params.tag = tagFilter;
      const res = await api.get('/photos', { params });
      setPhotos(prev => [...prev, ...res.data.photos]);
      setNextCursor(res.data.nextCursor);
      setHasMore(res.data.hasMore);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, nextCursor, albumFilter, tagFilter]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) {
        fetchMore();
      }
    }, { threshold: 0.1 });
    if (sentinelRef.current) observerRef.current.observe(sentinelRef.current);
    return () => observerRef.current?.disconnect();
  }, [fetchMore, hasMore, loadingMore]);

  const fetchAlbums = async () => {
    try {
      const params = {};
      if (yearFilter) params.schoolYear = yearFilter;
      const res = await api.get('/albums', { params });
      setAlbums(res.data.albums);
    } catch (err) { console.error(err); }
  };

  const fetchYears = async () => {
    try {
      const res = await api.get('/albums/years/list');
      setYears(res.data.years);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchPhotos(); }, [albumFilter, tagFilter]);
  useEffect(() => { fetchAlbums(); }, [yearFilter]);
  useEffect(() => { fetchYears(); }, []);

  const handleDownload = async (photo) => {
    try {
      const res = await api.get(`/photos/${photo.id}`);
      const response = await fetch(res.data.fullUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = photo.filename || 'photo.jpg';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed', err);
      alert('Download failed');
    }
  };

  const handleDelete = async (photoId) => {
    if (!window.confirm('Delete this photo permanently?')) return;
    await api.delete(`/photos/${photoId}`);
    setPhotos(prev => prev.filter(p => p.id !== photoId));
  };

  const handleShare = (photo) => {
    setShareTarget({
      type: 'photo',
      id: photo.id,
      name: photo.title || photo.filename,
    });
  };

  const setParam = (key, value) => {
    setSearchParams(prev => {
      if (value) {
        prev.set(key, value);
      } else {
        prev.delete(key);
      }
      if (key === 'year') prev.delete('album');
      return prev;
    });
  };

  const allTags = [...new Set(photos.flatMap(p => p.tags || []))];

  return (
    <div className="gallery-page">
      <div className="gallery-header">
        <div className="gallery-filters">
          {years.length > 0 && (
            <select
              value={yearFilter}
              onChange={e => setParam('year', e.target.value)}
              className="filter-select"
            >
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}

          <select
            value={albumFilter}
            onChange={e => setParam('album', e.target.value)}
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
                  onClick={() => setParam('tag', tagFilter === tag ? '' : tag)}
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
        <>
          <PhotoGrid
            photos={photos}
            onPhotoClick={setLightboxPhoto}
            onDownload={handleDownload}
            onDelete={handleDelete}
            onShare={handleShare}
          />

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 40, margin: '20px 0' }}>
            {loadingMore && (
              <div className="loading-grid" style={{ marginTop: 0 }}>
                {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card" />)}
              </div>
            )}
            {!hasMore && photos.length > 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: '0.85rem', padding: '20px 0' }}>
                All {photos.length} photos loaded
              </p>
            )}
          </div>
        </>
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

      {shareTarget && (
        <ShareModal
          type={shareTarget.type}
          targetId={shareTarget.id}
          targetName={shareTarget.name}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}