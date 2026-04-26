import React, { useState, useEffect } from 'react';
import api from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const TABS = ['Branding', 'Users', 'Settings', 'Sync', 'Cleanup'];

export default function AdminPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('Branding');
  const [config, setConfig] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [pending, setPending] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [cleanupResult, setCleanupResult] = useState(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);

  useEffect(() => {
	api.get('/config').then(r => setConfig(r.data));
	api.get('/users').then(r => setUsers(r.data.users));
  }, []);

  useEffect(() => {
	if (tab === 'Sync') fetchPending();
  }, [tab]);

  const fetchPending = async () => {
	try {
	  const res = await api.get('/sync/pending');
	  setPending(res.data.pending);
	} catch (err) { console.error(err); }
  };

  const saveConfig = async () => {
	setSaving(true);
	try {
	  await api.patch('/config', config);
	  setMsg('Saved successfully');
	  setTimeout(() => setMsg(''), 3000);
	} catch { setMsg('Save failed'); }
	finally { setSaving(false); }
  };

  const updateRole = async (uid, role) => {
	await api.patch('/users/' + uid + '/role', { role });
	setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role } : u));
  };

  const deleteUser = async (uid) => {
	if (!window.confirm('Delete this user?')) return;
	await api.delete('/users/' + uid);
	setUsers(prev => prev.filter(u => u.uid !== uid));
  };

  const runSync = async () => {
	setSyncing(true);
	setSyncResult(null);
	try {
	  const res = await api.post('/sync/run');
	  setSyncResult(res.data);
	  fetchPending();
	} catch (err) {
	  setSyncResult({ error: err.response?.data?.error || 'Sync failed' });
	} finally {
	  setSyncing(false);
	}
  };

  const runPreview = async () => {
	setCleanupPreview(null);
	setCleanupResult(null);
	try {
	  const res = await api.get('/cleanup/preview');
	  setCleanupPreview(res.data);
	} catch (err) {
	  console.error('Preview failed', err);
	  alert('Preview failed: ' + (err.response?.data?.error || err.message));
	}
  };

  const runCleanup = async () => {
	if (!cleanupPreview) return;
	if (!window.confirm(
	  'This will permanently delete ' + cleanupPreview.orphanedPhotos + ' photo records, ' +
	  cleanupPreview.orphanedAlbums + ' empty albums, and their thumbnails. Are you sure?'
	)) return;
	setCleanupRunning(true);
	try {
	  const res = await api.post('/cleanup/run');
	  setCleanupResult(res.data);
	  setCleanupPreview(null);
	} catch (err) {
	  alert('Cleanup failed: ' + (err.response?.data?.error || err.message));
	} finally {
	  setCleanupRunning(false);
	}
  };

  if (!isAdmin) return <div className="admin-denied">Admin access required.</div>;
  if (!config) return <div className="loading">Loading...</div>;

  return (
	<div className="admin-page">
	  <div className="admin-header">
		<h2>Admin Panel</h2>
		<div className="admin-tabs">
		  {TABS.map(t => (
			<button key={t} className={'admin-tab ' + (tab === t ? 'active' : '')} onClick={() => setTab(t)}>
			  {t}
			</button>
		  ))}
		</div>
	  </div>

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
				<input type="color" value={config.primaryColor} onChange={e => setConfig({ ...config, primaryColor: e.target.value })} />
				<input type="text" value={config.primaryColor} onChange={e => setConfig({ ...config, primaryColor: e.target.value })} />
			  </div>
			</label>
			<label>Accent Color
			  <div className="color-row">
				<input type="color" value={config.accentColor} onChange={e => setConfig({ ...config, accentColor: e.target.value })} />
				<input type="text" value={config.accentColor} onChange={e => setConfig({ ...config, accentColor: e.target.value })} />
			  </div>
			</label>
			<label>Logo URL
			  <input value={config.logoUrl || ''} placeholder="https://..." onChange={e => setConfig({ ...config, logoUrl: e.target.value })} />
			</label>
		  </div>
		  {config.logoUrl && (
			<div className="logo-preview">
			  <img src={config.logoUrl} alt="Logo preview" style={{ maxHeight: 80 }} />
			</div>
		  )}
		  <div className="toggle-group" style={{ marginBottom: 16 }}>
			  <label className="toggle-label">
				<input type="checkbox" checked={config.allowGoogleSignIn !== false}
				  onChange={e => setConfig({ ...config, allowGoogleSignIn: e.target.checked })} />
				Allow Google Sign-In
			  </label>
			</div>
		  <button className="btn-primary" onClick={saveConfig} disabled={saving}>
			{saving ? 'Saving...' : 'Save Branding'}
		  </button>
		  {msg && <span className="save-msg">{msg}</span>}
		</div>
	  )}

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
					<select value={u.role} onChange={e => updateRole(u.uid, e.target.value)} className={'role-badge role-' + u.role}>
					  <option value="user">User</option>
					  <option value="editor">Editor</option>
					  <option value="admin">Admin</option>
					</select>
				  </td>
				  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
				  <td><button className="btn-danger-sm" onClick={() => deleteUser(u.uid)}>Remove</button></td>
				</tr>
			  ))}
			</tbody>
		  </table>
		</div>
	  )}

	  {tab === 'Settings' && (
		<div className="admin-section">
		  <div className="form-grid">
			<label>Max Upload Size (MB)
			  <input type="number" value={config.maxUploadSizeMB} onChange={e => setConfig({ ...config, maxUploadSizeMB: parseInt(e.target.value) })} />
			</label>
			<label>Default Album View
			  <select value={config.defaultAlbumView} onChange={e => setConfig({ ...config, defaultAlbumView: e.target.value })}>
				<option value="grid">Grid</option>
				<option value="masonry">Masonry</option>
				<option value="list">List</option>
			  </select>
			</label>
		  </div>
		  <div className="toggle-group">
			<label className="toggle-label">
			  <input type="checkbox" checked={config.allowPublicBrowsing} onChange={e => setConfig({ ...config, allowPublicBrowsing: e.target.checked })} />
			  Allow public browsing (no login required)
			</label>
			<label className="toggle-label">
			  <input type="checkbox" checked={config.allowGuestDownloads} onChange={e => setConfig({ ...config, allowGuestDownloads: e.target.checked })} />
			  Allow guest downloads
			</label>
			<label className="toggle-label">
			  <input type="checkbox" checked={config.watermarkEnabled} onChange={e => setConfig({ ...config, watermarkEnabled: e.target.checked })} />
			  Enable watermark on downloads
			</label>
		  </div>
		  {config.watermarkEnabled && (
			<label>Watermark Text
			  <input value={config.watermarkText} onChange={e => setConfig({ ...config, watermarkText: e.target.value })} placeholder="Your Name" />
			</label>
		  )}
		  <button className="btn-primary" onClick={saveConfig} disabled={saving}>
			{saving ? 'Saving...' : 'Save Settings'}
		  </button>
		  {msg && <span className="save-msg">{msg}</span>}
		</div>
	  )}

	  {tab === 'Sync' && (
		<div className="admin-section">
		  <h3 style={{ marginBottom: 8 }}>Wasabi Import Sync</h3>
		  <p style={{ color: 'var(--text-2)', fontSize: '0.9rem', marginBottom: 20 }}>
			Drop photos into your Wasabi bucket under imports/AlbumName/photo.jpg and sync them here.
			Albums are auto-created if they do not exist. Auto-sync runs every 15 minutes.
		  </p>
	<div className="toggle-group" style={{ marginBottom: 20 }}>
		<label className="toggle-label">
		  <input
			type="checkbox"
			checked={config.autoSyncEnabled !== false}
			onChange={async e => {
			  const updated = { ...config, autoSyncEnabled: e.target.checked };
			  setConfig(updated);
			  await api.patch('/config', { autoSyncEnabled: e.target.checked });
			}}
		  />
		  Auto-sync every 15 minutes
		</label>
	  </div>
	
	  <div style={{ marginBottom: 20 }}>
		<button className="btn-primary" onClick={runSync} disabled={syncing}>
		  {syncing ? 'Syncing...' : 'Run Sync Now'}
		</button>
		<button className="btn-ghost" onClick={fetchPending} style={{ marginLeft: 10 }}>
		  Refresh Pending
		</button>
	  </div>
		  {syncResult && (
			<div style={{
			  padding: '12px 16px', borderRadius: 8, marginBottom: 20,
			  background: syncResult.error ? 'rgba(233,69,96,0.1)' : 'rgba(34,217,138,0.1)',
			  border: '1px solid ' + (syncResult.error ? 'rgba(233,69,96,0.3)' : 'rgba(34,217,138,0.3)'),
			  color: syncResult.error ? 'var(--accent)' : 'var(--green)',
			  fontSize: '0.9rem',
			}}>
			  {syncResult.error
				? 'Error: ' + syncResult.error
				: syncResult.processed + ' imported, ' + syncResult.skipped + ' skipped'
			  }
			</div>
		  )}
		  <h4 style={{ marginBottom: 10, fontSize: '0.95rem' }}>Pending in imports/ ({pending.length} files)</h4>
		  {pending.length === 0 ? (
			<p style={{ color: 'var(--text-3)', fontSize: '0.85rem' }}>No files waiting to be imported.</p>
		  ) : (
			<table className="users-table">
			  <thead><tr><th>File</th><th>Album</th><th>Size</th><th>Added</th></tr></thead>
			  <tbody>
				{pending.map(f => {
				  const parts = f.key.replace('imports/', '').split('/');
				  const album = parts.length > 1 ? parts[0] : '(no album)';
				  const file = parts[parts.length - 1];
				  return (
					<tr key={f.key}>
					  <td>{file}</td>
					  <td>{album}</td>
					  <td>{(f.size / 1024).toFixed(0)} KB</td>
					  <td>{new Date(f.lastModified).toLocaleString()}</td>
					</tr>
				  );
				})}
			  </tbody>
			</table>
		  )}
		</div>
	  )}

	  {tab === 'Cleanup' && (
		<div className="admin-section">
		  <h3 style={{ marginBottom: 8 }}>Storage Cleanup</h3>
		  <p style={{ color: 'var(--text-2)', fontSize: '0.9rem', marginBottom: 20 }}>
			Scans Firestore for photos whose files no longer exist in Wasabi, removes orphaned
			thumbnails, and deletes empty albums. Run Preview first to see what will be removed.
		  </p>
		  <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
			<button className="btn-ghost" onClick={runPreview}>Preview</button>
			<button className="btn-primary" onClick={runCleanup} disabled={cleanupRunning || !cleanupPreview}>
			  {cleanupRunning ? 'Running...' : 'Run Cleanup'}
			</button>
		  </div>
		  {cleanupPreview && (
			<div style={{ marginBottom: 20 }}>
			  <p style={{ fontSize: '0.9rem', color: 'var(--text-2)', marginBottom: 12 }}>
				Found <strong style={{ color: 'var(--accent)' }}>{cleanupPreview.orphanedPhotos}</strong> orphaned photo records
				and <strong style={{ color: 'var(--accent)' }}>{cleanupPreview.orphanedAlbums}</strong> empty albums to remove.
			  </p>
			  {cleanupPreview.photos?.length > 0 && (
				<table className="users-table">
				  <thead><tr><th>Filename</th><th>Wasabi Key</th></tr></thead>
				  <tbody>
					{cleanupPreview.photos.map(p => (
					  <tr key={p.id}>
						<td>{p.filename}</td>
						<td style={{ fontSize: '0.75rem', color: 'var(--text-3)' }}>{p.key}</td>
					  </tr>
					))}
				  </tbody>
				</table>
			  )}
			</div>
		  )}
		  {cleanupResult && (
			<div style={{
			  padding: '12px 16px', borderRadius: 8,
			  background: 'rgba(34,217,138,0.1)',
			  border: '1px solid rgba(34,217,138,0.3)',
			  color: 'var(--green)', fontSize: '0.9rem',
			}}>
			  Removed {cleanupResult.photosRemoved} photo records, {cleanupResult.thumbnailsRemoved} thumbnails, {cleanupResult.albumsRemoved} empty albums
			</div>
		  )}
		</div>
	  )}
	</div>
  );
}