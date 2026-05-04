import React, { useState, useEffect } from 'react';
import api from '../utils/api';

const EVENT_COLORS = {
  photo_viewed:     '#4f8ef7',
  photo_downloaded: '#16a34a',
  album_downloaded: '#16a34a',
  photo_uploaded:   '#7c3aed',
  photo_deleted:    '#e94560',
  user_login:       '#d97706',
  share_accessed:   '#0891b2',
  share_created:    '#0891b2',
};

const EVENT_ICONS = {
  photo_viewed:     '👁',
  photo_downloaded: '↓',
  album_downloaded: '📦',
  photo_uploaded:   '↑',
  photo_deleted:    '✕',
  user_login:       '🔑',
  share_accessed:   '🔗',
  share_created:    '🔗',
};

export default function LogsTab() {
  const [dates, setDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [flushing, setFlushing] = useState(false);
  const [flushMsg, setFlushMsg] = useState('');

  useEffect(() => {
    api.get('/logs/dates').then(r => {
      setDates(r.data.dates);
      if (r.data.dates.length > 0) {
        setSelectedDate(r.data.dates[0]);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    setLoading(true);
    api.get('/logs/' + selectedDate).then(r => {
      setEvents(r.data.events || []);
    }).catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, [selectedDate]);

  const handleFlush = async () => {
    setFlushing(true);
    try {
      await api.post('/logs/flush');
      setFlushMsg('✓ Flushed');
      setTimeout(() => setFlushMsg(''), 3000);
      // Reload dates and current day
      const r = await api.get('/logs/dates');
      setDates(r.data.dates);
      if (selectedDate) {
        const r2 = await api.get('/logs/' + selectedDate);
        setEvents(r2.data.events || []);
      }
    } catch {
      setFlushMsg('✗ Failed');
    } finally {
      setFlushing(false);
    }
  };

  const handleDownload = () => {
    const { auth } = require('../firebase');
    auth.currentUser.getIdToken().then(token => {
      const apiUrl = process.env.REACT_APP_API_URL || '';
      const link = document.createElement('a');
      link.href = apiUrl + '/api/logs/' + selectedDate + '/download';
      link.download = 'fotovault-logs-' + selectedDate + '.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  };

  const uniqueUsers = [...new Set(events.map(e => e.user_email).filter(Boolean))];
  const uniqueTypes = [...new Set(events.map(e => e.event_type).filter(Boolean))];

  const filtered = events.filter(e => {
    if (filter && e.event_type !== filter) return false;
    if (userFilter && e.user_email !== userFilter) return false;
    return true;
  });

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <select
          value={selectedDate}
          onChange={e => setSelectedDate(e.target.value)}
          className="filter-select"
          style={{ minWidth: 150 }}
        >
          {dates.length === 0 && <option value="">No logs yet</option>}
          {dates.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All Events</option>
          {uniqueTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>

        <select
          value={userFilter}
          onChange={e => setUserFilter(e.target.value)}
          className="filter-select"
        >
          <option value="">All Users</option>
          {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        <button className="btn-ghost" onClick={handleFlush} disabled={flushing}>
          {flushing ? 'Flushing...' : '⟳ Flush Now'}
        </button>

        {flushMsg && <span style={{ color: 'var(--green)', fontSize: '0.85rem' }}>{flushMsg}</span>}

        {selectedDate && events.length > 0 && (
          <button className="btn-ghost" onClick={handleDownload}>
            ↓ Download CSV
          </button>
        )}
      </div>

      {/* Stats bar */}
      {!loading && filtered.length > 0 && (
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16,
        }}>
          {Object.entries(
            filtered.reduce((acc, e) => {
              acc[e.event_type] = (acc[e.event_type] || 0) + 1;
              return acc;
            }, {})
          ).map(([type, count]) => (
            <span key={type} style={{
              fontSize: '0.78rem', fontWeight: 600,
              padding: '3px 10px', borderRadius: 20,
              background: (EVENT_COLORS[type] || '#888') + '22',
              color: EVENT_COLORS[type] || '#888',
              border: '1px solid ' + (EVENT_COLORS[type] || '#888') + '44',
            }}>
              {EVENT_ICONS[type]} {type.replace(/_/g, ' ')} ({count})
            </span>
          ))}
        </div>
      )}

      {/* Events list */}
      {loading ? (
        <div style={{ color: 'var(--text-3)', padding: '40px 0', textAlign: 'center' }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: 'var(--text-3)', padding: '40px 0', textAlign: 'center' }}>
          {dates.length === 0 ? 'No logs yet. Activity will appear here after the first flush.' : 'No events for this date/filter.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map((event, i) => (
            <div key={i} style={{
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid ' + (EVENT_COLORS[event.event_type] || '#888'),
              borderRadius: 6,
              padding: '10px 14px',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '4px 12px',
              alignItems: 'start',
            }}>
              <div>
                <span style={{
                  fontSize: '0.78rem', fontWeight: 700,
                  color: EVENT_COLORS[event.event_type] || 'var(--text-2)',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  {EVENT_ICONS[event.event_type]} {event.event_type?.replace(/_/g, ' ')}
                </span>
                {event.target_name && (
                  <span style={{ fontSize: '0.85rem', color: 'var(--text)', marginLeft: 8, fontWeight: 500 }}>
                    {event.target_name}
                  </span>
                )}
                {event.album_name && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginLeft: 6 }}>
                    in {event.album_name}
                  </span>
                )}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-2)', marginTop: 2 }}>
                  {event.user_name || event.user_email}
                  {event.role && event.role !== 'user' && (
                    <span style={{ marginLeft: 6, color: 'var(--text-3)' }}>({event.role})</span>
                  )}
                  {event.ip_address && (
                    <span style={{ marginLeft: 8, color: 'var(--text-3)', fontSize: '0.75rem' }}>
                      {event.ip_address}
                    </span>
                  )}
                </div>
                {event.details && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: 2 }}>
                    {event.details}
                  </div>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: '0.78rem', color: 'var(--text-3)', marginTop: 16, textAlign: 'right' }}>
        Showing {filtered.length} of {events.length} events
      </div>
    </div>
  );
}
