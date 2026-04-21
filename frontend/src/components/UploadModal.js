import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import api from '../utils/api';

export default function UploadModal({ albums, onClose, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [albumId, setAlbumId] = useState('');
  const [tags, setTags] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({});

  const onDrop = useCallback((accepted) => {
    const mapped = accepted.map(f => ({
      file: f,
      preview: URL.createObjectURL(f),
      id: Math.random().toString(36).slice(2),
    }));
    setFiles(prev => [...prev, ...mapped]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'] },
    maxSize: 50 * 1024 * 1024,
  });

  const removeFile = (id) => setFiles(prev => prev.filter(f => f.id !== id));

  const uploadAll = async () => {
    if (!files.length) return;
    setUploading(true);
    const parsedTags = JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean));

    await Promise.all(files.map(async ({ file, id }) => {
      setProgress(p => ({ ...p, [id]: 0 }));
      try {
        const formData = new FormData();
        formData.append('photo', file);
        if (albumId) formData.append('albumId', albumId);
        formData.append('tags', parsedTags);
        formData.append('title', file.name.replace(/\.[^/.]+$/, ''));

        await api.post('/photos/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            setProgress(p => ({ ...p, [id]: Math.round((e.loaded / e.total) * 100) }));
          },
        });
        setProgress(p => ({ ...p, [id]: 100 }));
      } catch (err) {
        setProgress(p => ({ ...p, [id]: -1 }));
        console.error('Upload failed:', file.name, err);
      }
    }));

    setUploading(false);
    setTimeout(onUploaded, 600);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Upload Photos</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`}>
          <input {...getInputProps()} />
          <div className="dropzone-content">
            <span className="dropzone-icon">⬆</span>
            <p>{isDragActive ? 'Drop photos here…' : 'Drag & drop photos, or click to browse'}</p>
            <small>JPG, PNG, WebP, GIF, HEIC — max 50MB each</small>
          </div>
        </div>

        {files.length > 0 && (
          <div className="upload-preview-grid">
            {files.map(({ file, preview, id }) => (
              <div key={id} className="upload-thumb">
                <img src={preview} alt={file.name} />
                {progress[id] !== undefined && progress[id] >= 0 && (
                  <div className="upload-progress-bar">
                    <div style={{ width: `${progress[id]}%` }} className={progress[id] === 100 ? 'done' : ''} />
                  </div>
                )}
                {progress[id] === -1 && <div className="upload-error-badge">✗</div>}
                {!uploading && (
                  <button className="thumb-remove" onClick={() => removeFile(id)}>✕</button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="upload-options">
          <select value={albumId} onChange={e => setAlbumId(e.target.value)} className="filter-select">
            <option value="">No album</option>
            {albums.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input
            placeholder="Tags (comma separated)"
            value={tags}
            onChange={e => setTags(e.target.value)}
            className="auth-input"
          />
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose} disabled={uploading}>Cancel</button>
          <button
            className="btn-primary"
            onClick={uploadAll}
            disabled={uploading || !files.length}
          >
            {uploading ? `Uploading ${files.length} photo${files.length > 1 ? 's' : ''}…` : `Upload ${files.length} photo${files.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
