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

export const ConfigContext = React.createContext({});

function AppShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [appConfig, setAppConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const isAuthPage = ['/login', '/register'].includes(location.pathname);

  useEffect(() => {
    api.get('/config').then(r => {
      setAppConfig(r.data);
      const root = document.documentElement;
      if (r.data.primaryColor) root.style.setProperty('--bg', r.data.primaryColor);
      if (r.data.accentColor)  root.style.setProperty('--accent', r.data.accentColor);
    }).catch(() => {
      setAppConfig({});
    }).finally(() => {
      setConfigLoading(false);
    });
  }, []);

  if (loading || configLoading) {
    return <div className="full-loading"><span className="logo-icon spin">◈</span></div>;
  }

  return (
    <ConfigContext.Provider value={appConfig || {}}>
      <div className="app">
        {user && !isAuthPage && (
          <Navbar appName={appConfig?.appName || 'FotoVault'} logoUrl={appConfig?.logoUrl} />
        )}
        <main className="main-content">
          <Routes>
            <Route path="/login"    element={user ? <Navigate to="/" /> : <LoginPage />} />
            <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
            <Route path="/" element={
              <ProtectedRoute config={appConfig}><GalleryPage /></ProtectedRoute>
            } />
            <Route path="/albums" element={
              <ProtectedRoute config={appConfig}><AlbumsPage /></ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute requiredRole="admin" config={appConfig}><AdminPage /></ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </ConfigContext.Provider>
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
