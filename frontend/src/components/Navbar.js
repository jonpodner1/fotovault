import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function Navbar({ appName, logoUrl }) {
  const { user, profile, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand" onClick={() => navigate('/')}>
        {logoUrl
          ? <img src={logoUrl} alt={appName} className="navbar-logo" />
          : <span className="navbar-logo-text"><span className="logo-icon">◈</span> {appName}</span>
        }
      </div>

      <div className="navbar-links">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Photos
        </NavLink>
        <NavLink to="/albums" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Albums
        </NavLink>
        <NavLink to="/years" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
          Years
        </NavLink>
        {isAdmin && (
          <NavLink to="/admin" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Admin
          </NavLink>
        )}
      </div>

      <div className="navbar-user">
        <span className="user-chip">
          <span className={`role-dot role-${profile?.role || 'user'}`} />
          {profile?.displayName || user?.email}
        </span>
        <button className="btn-ghost small" onClick={handleLogout}>Sign Out</button>
      </div>
    </nav>
  );
}
