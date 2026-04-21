import React, { useState } from 'react';
import api from '../utils/api';

const EXPIRY_OPTIONS = [
  { label: 'Never', value: null },
  { label: '24 hours', value: 86400 },
  { label: '7 days', value: 604800 },
  { label: '30 days', value: 2592000 },
];

export default function ShareModal({ type, targetId, targetName, onClose }) {
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [allowDownload, setAllowDownload] = useState(true);
  const [expiresIn, setExpiresIn] = useState(null);
  const [creating, setCreating] = useState(false);
  const [shareUrl, setShareUrl] = useState(null);
  const [copied, setCopied] = useState(false);

  const createLink = async () => {
    setCreating(true);
    try {
      const res = await api.post('/shares', {
        type, targetId, requiresLogin, allowDownload, expiresIn
      });
      setShareUrl(res.data.url);
    } catch (err) {
      alert('Failed to create share link');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Share {type === 'album' ? 'Album' : 'Photo'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: '20px 24px' }}>
          <p style={{ color: 'var(--text-2)', fontSize: '0.9rem', marginBottom: 20 }}>
            Sharing: <strong style={{ color: 'var(--text)' }}>{targetName}</strong>
          </p>

          {!shareUrl ? (
            <>
              <div className="toggle-group" style={{ marginBottom: 20 }}>
                <label className="toggle-label">
                  <input type="checkbox" checked={requiresLogin}
                    onChange={e => setRequiresLogin(e.target.checked)} />
                  Require login to view
                </label>
                <label className="toggle-label">
                  <input type="checkbox" checked={allowDownload}
                    onChange={e => setAllowDownload(e.target.checked)} />
                  Allow downloads
                </label>
              </div>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 6,
                fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: 20 }}>
                Link expires
                <select value={expiresIn || ''} className="filter-select"
                  onChange={e => setExpiresIn(e.target.value ? parseInt(e.target.value) : null)}>
                  {EXPIRY_OPTIONS.map(o => (
                    <option key={o.label} value={o.value || ''}>{o.label}</option>
                  ))}
                </select>
              </label>

              <button className="btn-primary" onClick={createLink} disabled={creating}
                style={{ width: '100%' }}>
                {creating ? 'Creating…' : 'Create Share Link'}
              </button>
            </>
          ) : (
            <div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-2)', marginBottom: 10 }}>
                Your share link is ready:
              </p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input
                  readOnly
                  value={shareUrl}
                  style={{ flex: 1, fontSize: '0.8rem' }}
                  onClick={e => e.target.select()}
                />
                <button className="btn-primary" onClick={copyLink}>
                  {copied ? '✓ Copied!' : 'Copy'}
                </button>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-3)' }}>
                {requiresLogin ? '🔒 Requires login' : '🌐 Public link'} ·
                {allowDownload ? ' Downloads allowed' : ' View only'} ·
                {expiresIn ? ` Expires in ${EXPIRY_OPTIONS.find(o => o.value === expiresIn)?.label}` : ' Never expires'}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
