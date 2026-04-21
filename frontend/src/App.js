import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import GalleryPage from './pages/GalleryPage';
import AlbumsPage from './pages/AlbumsPage';
import AdminPage from './pages/AdminPage';
import api from './utils/api';
import './styles.css';

function AppShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [appConfig, setAppConfig] = useState({ appName: 'FotoVault', logoUrl: null });
  const isAuthPage = ['/login', '/register'].includes(location.pathname);

  useEffect(() => {
    if (user) {
      api.get('/config').then(r => setAppConfig(r.data)).catch(() => {});
    }
  }, [user]);

  if (loading) return <div className="full-loading"><span className="logo-icon spin">◈</span></div>;

  return (
    <div className="app">
      {user && !isAuthPage && (
        <Navbar appName={appConfig.appName} logoUrl={appConfig.logoUrl} />
      )}
      <main className="main-content">
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage />} />
          <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
          <Route path="/" element={
            <ProtectedRoute><GalleryPage /></ProtectedRoute>
          } />
          <Route path="/albums" element={
            <ProtectedRoute><AlbumsPage /></ProtectedRoute>
          } />
          <Route path="/admin" element={
            <ProtectedRoute requiredRole="admin"><AdminPage /></ProtectedRoute>
          } />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
