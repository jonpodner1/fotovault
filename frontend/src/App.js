import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import PolicyModal from './components/PolicyModal';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import GalleryPage from './pages/GalleryPage';
import AlbumsPage from './pages/AlbumsPage';
import AdminPage from './pages/AdminPage';
import YearsPage from './pages/YearsPage';
import SharePage from './pages/SharePage';
import api from './utils/api';
import './styles.css';
import { analytics } from './firebase';
import { logEvent } from 'firebase/analytics';

export const ConfigContext = React.createContext({});

function AppShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [appConfig, setAppConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [policyAccepted, setPolicyAccepted] = useState(false);

  const isAuthPage = ['/login', '/register'].includes(location.pathname);
  const isSharePage = location.pathname.startsWith('/share/');
  
  useEffect(() => {
    if (user) {
      logEvent(analytics, 'login', { method: 'email' });
    }
  }, [user]);

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

  // Show policy modal to logged-in users who haven't accepted yet
  // Don't show on auth pages or share pages
  const showPolicy = user && !isAuthPage && !isSharePage && !policyAccepted;

  return (
    <ConfigContext.Provider value={appConfig || {}}>
      <div className="app">
        {user && !isAuthPage && !isSharePage && (
          <Navbar appName={appConfig?.appName || 'MCHS Photos'} logoUrl={appConfig?.logoUrl} />
        )}
        <main className="main-content">
          <Routes>
            <Route path="/login"    element={user ? <Navigate to="/" /> : <LoginPage />} />
            <Route path="/register" element={user ? <Navigate to="/" /> : <RegisterPage />} />
            <Route path="/share/:token" element={<SharePage />} />
            <Route path="/" element={
              <ProtectedRoute config={appConfig}><GalleryPage /></ProtectedRoute>
            } />
            <Route path="/albums" element={
              <ProtectedRoute config={appConfig}><AlbumsPage /></ProtectedRoute>
            } />
            <Route path="/albums/:albumId" element={
              <ProtectedRoute config={appConfig}><AlbumsPage /></ProtectedRoute>
            } />
            <Route path="/years" element={
              <ProtectedRoute config={appConfig}><YearsPage /></ProtectedRoute>
            } />
            <Route path="/years/:year" element={
              <ProtectedRoute config={appConfig}><YearsPage /></ProtectedRoute>
            } />
            <Route path="/admin" element={
              <ProtectedRoute requiredRole="admin" config={appConfig}><AdminPage /></ProtectedRoute>
            } />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
      {showPolicy && <PolicyModal onAccept={() => setPolicyAccepted(true)} />}
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