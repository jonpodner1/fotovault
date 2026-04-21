import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const TABS = ['Branding', 'Users', 'Settings'];

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('Branding');
  const [config, setConfig] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/config').then(r => setConfig(r.data));
    api.get('/users').then(r => setUsers(r.data.users));
  }, []);

  const saveConfig = async () => {
    setSaving(true);
    try {
      await api.patch('/config', config);
      setMsg('✓ Saved successfully');
      setTimeout(() => setMsg(''), 3000);
    } catch { setMsg('✗ Save failed'); }
    finally { setSaving(false); }
  };

  const updateRole = async (uid, role) => {
    await api.patch(`/users/${uid}/role`, { role });
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
  };

  const deleteUser = async (uid) => {
    if (!window.confirm('Delete this user?')) return;
    await api.delete(`/users/${uid}`);
    setUsers(prev => prev.filter(u => u.uid !== uid));
  };

  if (!isAdmin) return <div className="admin-denied">Admin access required.</div>;
  if (!config) return <div className="loading">Loading...</div>;

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h2>Admin Panel</h2>
        <div className="admin-tabs">
          {TABS.map(t => (
            <button key={t} className={`admin-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ── BRANDING ── */}
      {tab === 'Branding' && (
        <div className="admin-section">
          <div className="form-grid">
            <label>App Name
              <input value={config.appName} onChange={e => setConfig({ ...config, appName: e.target.value })} />
            </label>
            <label>Tagline
              <input value={config.tagline} onChange={e => setConfig({ ...config, tagline: e.target.value })} />
            </label>
            <label>Primary Color
              <div className="color-row">
                <input type="color" value={config.primaryColor}
                  onChange={e => setConfig({ ...config, primaryColor: e.target.value })} />
                <input type="text" value={config.primaryColor}
                  onChange={e => setConfig({ ...config, primaryColor: e.target.value })} />
              </div>
            </label>
            <label>Accent Color
              <div className="color-row">
                <input type="color" value={config.accentColor}
                  onChange={e => setConfig({ ...config, accentColor: e.target.value })} />
                <input type="text" value={config.accentColor}
                  onChange={e => setConfig({ ...config, accentColor: e.target.value })} />
              </div>
            </label>
            <label>Logo URL
              <input value={config.logoUrl || ''} placeholder="https://..."
                onChange={e => setConfig({ ...config, logoUrl: e.target.value })} />
            </label>
          </div>
          {config.logoUrl && (
            <div className="logo-preview">
              <img src={config.logoUrl} alt="Logo preview" style={{ maxHeight: 80 }} />
            </div>
          )}
          <button className="btn-primary" onClick={saveConfig} disabled={saving}>
            {saving ? 'Saving…' : 'Save Branding'}
          </button>
          {msg && <span className="save-msg">{msg}</span>}
        </div>
      )}

      {/* ── USERS ── */}
      {tab === 'Users' && (
        <div className="admin-section">
          <table className="users-table">
            <thead>
              <tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.uid}>
                  <td>{u.displayName}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} onChange={e => updateRole(u.uid, e.target.value)}
                      className={`role-badge role-${u.role}`}>
                      <option value="user">User</option>
                      <option value="editor">Editor</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <button className="btn-danger-sm" onClick={() => deleteUser(u.uid)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SETTINGS ── */}
      {tab === 'Settings' && (
        <div className="admin-section">
          <div className="form-grid">
            <label>Max Upload Size (MB)
              <input type="number" value={config.maxUploadSizeMB}
                onChange={e => setConfig({ ...config, maxUploadSizeMB: parseInt(e.target.value) })} />
            </label>
            <label>Default Album View
              <select value={config.defaultAlbumView}
                onChange={e => setConfig({ ...config, defaultAlbumView: e.target.value })}>
                <option value="grid">Grid</option>
                <option value="masonry">Masonry</option>
                <option value="list">List</option>
              </select>
            </label>
          </div>

          <div className="toggle-group">
            <label className="toggle-label">
              <input type="checkbox" checked={config.allowPublicBrowsing}
                onChange={e => setConfig({ ...config, allowPublicBrowsing: e.target.checked })} />
              Allow public browsing (no login required)
            </label>
            <label className="toggle-label">
              <input type="checkbox" checked={config.allowGuestDownloads}
                onChange={e => setConfig({ ...config, allowGuestDownloads: e.target.checked })} />
              Allow guest downloads
            </label>
            <label className="toggle-label">
              <input type="checkbox" checked={config.watermarkEnabled}
                onChange={e => setConfig({ ...config, watermarkEnabled: e.target.checked })} />
              Enable watermark on downloads
            </label>
          </div>

          {config.watermarkEnabled && (
            <label>Watermark Text
              <input value={config.watermarkText}
                onChange={e => setConfig({ ...config, watermarkText: e.target.value })}
                placeholder="© Your Name" />
            </label>
          )}

          <button className="btn-primary" onClick={saveConfig} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          {msg && <span className="save-msg">{msg}</span>}
        </div>
      )}
    </div>
  );
}
