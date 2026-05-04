import React, { useState, useEffect } from 'react';

export default function PolicyModal({ onAccept }) {
  const [accepted, setAccepted] = useState(false);

  // Check if already accepted in localStorage
  useEffect(() => {
    const hasAccepted = localStorage.getItem('mchs_policy_accepted');
    if (hasAccepted) onAccept();
  }, []);

  const handleAccept = () => {
    localStorage.setItem('mchs_policy_accepted', 'true');
    onAccept();
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px',
    }}>
      <div style={{
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        width: '100%',
        maxWidth: 600,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 28px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
            <span style={{ fontSize: '1.5rem' }}>◈</span>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>MCHS Photos</h2>
          </div>
          <p style={{ margin: 0, color: 'var(--text-2)', fontSize: '0.9rem' }}>
            Photo Platform Usage Policy — Marquette Catholic High School
          </p>
        </div>

        {/* Scrollable content */}
        <div style={{
          padding: '20px 28px',
          overflowY: 'auto',
          flex: 1,
          fontSize: '0.875rem',
          lineHeight: 1.7,
          color: 'var(--text-2)',
        }}>
          <Section title="Overview">
            MCHS Photos is the official photo platform of Marquette Catholic High School, 
            provided for students, parents, staff, and the broader MCHS community to share 
            and access photos from school events, athletics, and activities.
          </Section>

          <Section title="Photo Consent">
            Upon enrollment at Marquette Catholic High School, students and families 
            automatically provide consent for photos taken at school-sponsored events and 
            activities to be shared on this platform.
          </Section>

          <Section title="Downloading and Sharing">
            You are permitted to download and share photos for personal use, on social media, 
            and with friends and family. You may not sell, commercially distribute, or use 
            photos in a defamatory or harmful manner.
          </Section>

          <Section title="Privacy">
            We collect basic account information (name and email) to provide platform access. 
            We do not sell your personal information. Activity logs are maintained for security 
            purposes and are only accessible to administrators. This platform operates in 
            accordance with FERPA guidelines.
          </Section>

          <Section title="Account Responsibilities">
            You are responsible for keeping your credentials secure, all activity under your 
            account, and ensuring your use complies with this policy.
          </Section>

          <Section title="Contact">
            Questions or concerns? Contact the platform administrator at{' '}
            <a href="mailto:jpodner@mymchs.org" style={{ color: 'var(--accent)' }}>
              jpodner@mymchs.org
            </a>
          </Section>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 28px 24px',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            marginBottom: 16, cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              style={{ marginTop: 3, flexShrink: 0, width: 16, height: 16, cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-2)', lineHeight: 1.5 }}>
              I have read and agree to the MCHS Photos usage policy. I understand that by 
              using this platform I am bound by these terms.
            </span>
          </label>
          <button
            onClick={handleAccept}
            disabled={!accepted}
            className="btn-primary"
            style={{
              width: '100%',
              opacity: accepted ? 1 : 0.4,
              cursor: accepted ? 'pointer' : 'not-allowed',
              padding: '12px',
              fontSize: '0.95rem',
            }}
          >
            Accept &amp; Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 4px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text)' }}>
        {title}
      </h4>
      <p style={{ margin: 0 }}>{children}</p>
    </div>
  );
}
