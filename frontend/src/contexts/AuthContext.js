import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null); // Firestore profile with role
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          // Register/fetch user profile from backend
          const token = await firebaseUser.getIdToken();
          const res = await api.post('/users/register',
            { displayName: firebaseUser.displayName },
            { headers: { Authorization: `Bearer ${token}` } }
          );
          setProfile(res.data);
        } catch (err) {
          console.error('Failed to fetch profile', err);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const getToken = async () => {
    if (!user) throw new Error('Not authenticated');
    return user.getIdToken();
  };

  const loginWithEmail = (email, password) =>
    signInWithEmailAndPassword(auth, email, password);

  const registerWithEmail = (email, password) =>
    createUserWithEmailAndPassword(auth, email, password);

  const loginWithGoogle = () => signInWithPopup(auth, googleProvider);

  const logout = () => signOut(auth);

  const role = profile?.role || 'user';
  const isAdmin = role === 'admin';
  const isEditor = role === 'editor' || role === 'admin';

  return (
    <AuthContext.Provider value={{
      user, profile, loading, role, isAdmin, isEditor,
      getToken, loginWithEmail, registerWithEmail, loginWithGoogle, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
