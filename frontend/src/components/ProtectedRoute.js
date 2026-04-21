import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, profile, loading } = useAuth();

  if (loading) return <div className="full-loading">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;

  if (requiredRole) {
    const hierarchy = { user: 0, editor: 1, admin: 2 };
    const userLevel = hierarchy[profile?.role || 'user'];
    const required = hierarchy[requiredRole];
    if (userLevel < required) return <Navigate to="/" replace />;
  }

  return children;
}
