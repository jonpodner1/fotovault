import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../utils/api';

// ─── YEARBOOKS LIST PAGE ───────────────────────────────────────────────────────
function YearbooksList() {
  const navigate = useNavigate();
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
	api.get('/yearbooks/years').then(r => setYears(r.data.years)).catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
	<div className="albums-page">
	  <div className="albums-header">
		<h2>Yearbooks</h2>
	  </div>

	  {loading ? (
		<div className="loading-grid">
		  {[...Array(6)].map((_, i) => <div key={i} className="skeleton-card tall" />)}
		</div>
	  ) : years.length === 0 ? (
		<div className="empty-state">
		  <div className="empty-icon">📖</div>
		  <p>No yearbooks yet. Upload pages to <code>imports/yearbooks/YEAR/</code> in Wasabi and run sync.</p>
		</div>
	  ) : (
		<div className="albums-grid">
		  {years.map(y => (
			<div key={y.year} className="album-card" onClick={() => navigate('/yearbooks/' + y.year)}>
			  <div className="album-cover">
				{y.coverUrl
				  ? <img src={y.coverUrl} alt={y.year + ' Yearbook'} style={{ objectFit: 'cover' }} />
				  : <div className="album-cover-placeholder">📖</div>
				}
			  </div>
			  <div className="album-info">
				<h3>{y.year} Yearbook</h3>
				<div className="album-meta">
				  <span>{y.pageCount} pages</span>
				</div>
			  </div>
			</div>
		  ))}
		</div>
	  )}
	</div>
  );
}

// ─── FLIPBOOK VIEWER ───────────────────────────────────────────────────────────
function YearbookViewer({ year }) {
  const navigate = useNavigate();
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [imageLoading, setImageLoading] = useState(true);
  const [showThumbs, setShowThumbs] = useState(true);
  const thumbRef = useRef(null);
  const touchStartX = useRef(null);

  useEffect(() => {
	api.get('/yearbooks/' + year + '/pages')
	  .then(r => setPages(r.data.pages))
	  .catch(console.error)
	  .finally(() => setLoading(false));
  }, [year]);

  useEffect(() => {
	const handleKey = (e) => {
	  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
	  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
	  if (e.key === 'Escape') navigate('/yearbooks');
	};
	window.addEventListener('keydown', handleKey);
	return () => window.removeEventListener('keydown', handleKey);
  }, [currentPage, pages.length]);

  useEffect(() => {
	if (thumbRef.current) {
	  const active = thumbRef.current.querySelector('.thumb-active');
	  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
	}
  }, [currentPage]);

  const goNext = useCallback(() => {
	setCurrentPage(p => Math.min(p + 1, pages.length - 1));
	setImageLoading(true);
  }, [pages.length]);

  const goPrev = useCallback(() => {
	setCurrentPage(p => Math.max(p - 1, 0));
	setImageLoading(true);
  }, []);

  const goToPage = (idx) => {
	setCurrentPage(idx);
	setImageLoading(true);
  };

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
	if (touchStartX.current === null) return;
	const diff = touchStartX.current - e.changedTouches[0].clientX;
	if (Math.abs(diff) > 50) { diff > 0 ? goNext() : goPrev(); }
	touchStartX.current = null;
  };

  if (loading) {
	return (
	  <div className="full-loading">
		<span className="logo-icon spin">◈</span>
	  </div>
	);
  }

  if (pages.length === 0) {
	return (
	  <div className="empty-state">
		<div className="empty-icon">📖</div>
		<p>No pages found for {year}.</p>
		<button className="btn-ghost" onClick={() => navigate('/yearbooks')}>← Back</button>
	  </div>
	);
  }

  const page = pages[currentPage];

  return (
	<div style={{
	  display: 'flex', flexDirection: 'column', height: '100vh',
	  background: 'var(--bg)', overflow: 'hidden',
	}}>
	  <div style={{
		display: 'flex', alignItems: 'center', justifyContent: 'space-between',
		padding: '12px 20px', borderBottom: '1px solid var(--border)',
		flexShrink: 0, gap: 12,
	  }}>
		<button className="btn-ghost small" onClick={() => navigate('/yearbooks')}>
		  ← Yearbooks
		</button>
		<div style={{ fontWeight: 700, fontSize: '1rem' }}>{year} Yearbook</div>
		<div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
		  <span style={{ fontSize: '0.85rem', color: 'var(--text-2)' }}>
			Page {currentPage + 1} of {pages.length}
		  </span>
		  <button
			className="btn-ghost small"
			onClick={() => setShowThumbs(s => !s)}
			title="Toggle thumbnails"
		  >
			⊞
		  </button>
		</div>
	  </div>

	  <div
		style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '20px' }}
		onTouchStart={handleTouchStart}
		onTouchEnd={handleTouchEnd}
	  >
		<button
		  onClick={goPrev}
		  disabled={currentPage === 0}
		  style={{
			position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
			background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white',
			width: 44, height: 44, borderRadius: '50%', fontSize: '1.2rem',
			cursor: currentPage === 0 ? 'not-allowed' : 'pointer',
			opacity: currentPage === 0 ? 0.3 : 1, zIndex: 10,
			display: 'flex', alignItems: 'center', justifyContent: 'center',
		  }}
		>
		  ‹
		</button>

		<div style={{ position: 'relative', maxHeight: '100%', maxWidth: '100%' }}>
		  {imageLoading && (
			<div style={{
			  position: 'absolute', inset: 0, display: 'flex',
			  alignItems: 'center', justifyContent: 'center',
			  background: 'var(--bg-2)', borderRadius: 4,
			  minWidth: 300, minHeight: 400,
			}}>
			  <span className="logo-icon spin">◈</span>
			</div>
		  )}
		  <img
			key={page.id}
			src={page.fullUrl}
			alt={'Page ' + (currentPage + 1)}
			onLoad={() => setImageLoading(false)}
			style={{
			  maxHeight: 'calc(100vh - 200px)',
			  maxWidth: '100%',
			  objectFit: 'contain',
			  borderRadius: 4,
			  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
			  display: imageLoading ? 'none' : 'block',
			}}
		  />
		</div>

		<button
		  onClick={goNext}
		  disabled={currentPage === pages.length - 1}
		  style={{
			position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
			background: 'rgba(0,0,0,0.5)', border: 'none', color: 'white',
			width: 44, height: 44, borderRadius: '50%', fontSize: '1.2rem',
			cursor: currentPage === pages.length - 1 ? 'not-allowed' : 'pointer',
			opacity: currentPage === pages.length - 1 ? 0.3 : 1, zIndex: 10,
			display: 'flex', alignItems: 'center', justifyContent: 'center',
		  }}
		>
		  ›
		</button>
	  </div>

	  {showThumbs && (
		<div
		  ref={thumbRef}
		  style={{
			display: 'flex', gap: 6, padding: '8px 12px',
			overflowX: 'auto', borderTop: '1px solid var(--border)',
			flexShrink: 0, background: 'var(--bg-2)',
		  }}
		>
		  {pages.map((p, idx) => (
			<div
			  key={p.id}
			  className={idx === currentPage ? 'thumb-active' : ''}
			  onClick={() => goToPage(idx)}
			  style={{
				flexShrink: 0, cursor: 'pointer',
				border: idx === currentPage ? '2px solid var(--accent)' : '2px solid transparent',
				borderRadius: 3, overflow: 'hidden',
				opacity: idx === currentPage ? 1 : 0.6,
				transition: 'all 0.15s',
			  }}
			>
			  <img
				src={p.thumbUrl}
				alt={'Page ' + (idx + 1)}
				style={{ width: 48, height: 64, objectFit: 'cover', display: 'block' }}
				loading="lazy"
			  />
			</div>
		  ))}
		</div>
	  )}
	</div>
  );
}

export default function YearbooksPage() {
  const { year } = useParams();
  if (year) return <YearbookViewer year={year} />;
  return <YearbooksList />;
}