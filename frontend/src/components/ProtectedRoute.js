import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, requiredRole, config }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="full-loading">Loading…</div>;

  if (!user && config?.allowPublicBrowsing) return children;
  if (!user) return <Navigate to="/login" replace />;

  if (requiredRole) {
    const hierarchy = { user: 0, editor: 1, admin: 2 };
    if (hierarchy[profile?.role || 'user'] < hierarchy[requiredRole]) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}
