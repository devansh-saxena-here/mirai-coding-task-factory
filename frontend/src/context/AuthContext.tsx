import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, githubProvider, googleProvider } from '../lib/firebase';
import {
  subscribeUserCloudSummary,
  syncUserProfile,
  type CloudSummary,
} from '../services/firestoreSync';
import { requestJson } from '../services/api';

export type SignInProvider = 'google' | 'github';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  signingInProvider: SignInProvider | null;
  authError: string;
  profileSynced: boolean;
  cloudSummary: CloudSummary;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithGithub: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function formatAuthError(err: unknown, provider: SignInProvider): string {
  const code = (err as { code?: string })?.code || '';
  const message = (err as Error)?.message || '';

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in popup was closed before completing. Click the button again to continue.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using another provider. Sign in with the original provider you used first.';
    case 'auth/operation-not-allowed':
      if (provider === 'github') {
        return 'GitHub sign-in is not enabled yet in Firebase Console. Enable GitHub under Authentication → Sign-in method (or use Google Sign-In right now).';
      }
      return 'This sign-in provider is currently disabled in Firebase Authentication.';
    case 'auth/unauthorized-domain':
      return 'This preview domain is not authorized in Firebase Authentication yet. Add it under Firebase Console → Authentication → Settings → Authorized domains.';
    default:
      return message || `Failed to sign in with ${provider === 'google' ? 'Google' : 'GitHub'}.`;
  }
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingInProvider, setSigningInProvider] = useState<SignInProvider | null>(null);
  const [authError, setAuthError] = useState('');
  const [profileSynced, setProfileSynced] = useState(false);
  const [cloudSummary, setCloudSummary] = useState<CloudSummary>({ projects: 0, tasks: 0 });

  useEffect(() => {
    let unsubSummary: (() => void) | null = null;
    let active = true;

    const unsubAuth = onAuthStateChanged(auth, async (nextUser) => {
      if (unsubSummary) {
        unsubSummary();
        unsubSummary = null;
      }

      setUser(nextUser);
      setProfileSynced(false);
      setCloudSummary({ projects: 0, tasks: 0 });

      if (!nextUser) {
        try {
          localStorage.removeItem('ctf.selection.v1');
        } catch {
          // Ignore storage errors
        }
        setAuthReady(true);
        return;
      }

      // 1. Register/verify session with Express backend (claims legacy workspace if applicable)
      try {
        const token = await nextUser.getIdToken();
        await requestJson('/auth/session', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.warn('Backend session verification warning:', err);
      }

      // 2. Sync user profile document in Firestore (/users/{uid})
      try {
        const synced = await syncUserProfile(nextUser);
        if (active) setProfileSynced(synced);
      } catch (err) {
        console.warn('Firestore profile sync warning:', err);
      }

      // 3. Subscribe to live cloud counts under /users/{uid}
      if (active) {
        unsubSummary = subscribeUserCloudSummary(nextUser, (summary) => {
          if (active) setCloudSummary(summary);
        });
        setAuthReady(true);
      }
    });

    return () => {
      active = false;
      unsubAuth();
      if (unsubSummary) unsubSummary();
    };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    setAuthError('');
    setSigningInProvider('google');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(formatAuthError(err, 'google'));
    } finally {
      setSigningInProvider(null);
    }
  }, []);

  const signInWithGithub = useCallback(async () => {
    setAuthError('');
    setSigningInProvider('github');
    try {
      await signInWithPopup(auth, githubProvider);
    } catch (err) {
      setAuthError(formatAuthError(err, 'github'));
    } finally {
      setSigningInProvider(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    setAuthError('');
    try {
      try {
        await requestJson('/auth/session', { method: 'DELETE' });
      } catch {
        // Continue signing out from Firebase
      }
      await firebaseSignOut(auth);
      try {
        localStorage.removeItem('ctf.selection.v1');
      } catch {
        // Ignore storage errors
      }
    } catch (err) {
      setAuthError((err as Error)?.message || 'Failed to sign out.');
    }
  }, []);

  const clearAuthError = useCallback(() => setAuthError(''), []);

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        signingInProvider,
        authError,
        profileSynced,
        cloudSummary,
        clearAuthError,
        signInWithGoogle,
        signInWithGithub,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
