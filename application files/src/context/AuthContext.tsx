import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  doc,
  getDoc,
  setDoc
} from '../lib/firebase';
import { User } from 'firebase/auth';
import { UserProfile, UserRole } from '../types';
import { invitationService } from '../services/invitationService';

const INVITATION_TOKEN_KEY = 'lumina_pending_invitation_token';

export type InvitationStatus = 'idle' | 'waiting_for_sign_in' | 'accepting' | 'accepted' | 'error';

function getStoredInvitationToken(): string | null {
  const tokenFromUrl = new URLSearchParams(window.location.search).get('invite');
  const tokenFromFragment = new URLSearchParams(window.location.hash.slice(1)).get('invite');
  return tokenFromUrl || tokenFromFragment || sessionStorage.getItem(INVITATION_TOKEN_KEY);
}

function removeInvitationTokenFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('invite');
  const fragment = new URLSearchParams(url.hash.slice(1));
  fragment.delete('invite');
  url.hash = fragment.toString();
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function removeLegacyInvitationParamsFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('inviteEvent') && !url.searchParams.has('inviteEmail')) return;

  url.searchParams.delete('inviteEvent');
  url.searchParams.delete('inviteEmail');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  role: UserRole;
  isSuperAdmin: boolean;
  isManager: boolean;
  isPhotographer: boolean;
  pendingInvitationToken: string | null;
  invitationStatus: InvitationStatus;
  invitationError: string | null;
  acceptedInvitationEventId: string | null;
  retryInvitation: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, role: UserRole, displayName?: string) => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingInvitationToken, setPendingInvitationToken] = useState<string | null>(getStoredInvitationToken);
  const [invitationStatus, setInvitationStatus] = useState<InvitationStatus>(
    pendingInvitationToken ? 'waiting_for_sign_in' : 'idle'
  );
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [acceptedInvitationEventId, setAcceptedInvitationEventId] = useState<string | null>(null);
  const acceptingInvitationRef = useRef<string | null>(null);
  const pendingSignUpRef = useRef<{ role: UserRole; displayName?: string } | null>(null);

  // Preserve the opaque token while the photographer completes sign-in.
  useEffect(() => {
    if (pendingInvitationToken) {
      sessionStorage.setItem(INVITATION_TOKEN_KEY, pendingInvitationToken);
      removeInvitationTokenFromUrl();
    }

    // Old invite URLs are intentionally no longer trusted.
    sessionStorage.removeItem('lumina_pending_invite_event');
    sessionStorage.removeItem('lumina_pending_invite_email');
    removeLegacyInvitationParamsFromUrl();

    // Discard legacy preview sessions; only Firebase can establish a user.
    sessionStorage.removeItem('lumina_demo_session');
  }, []);

  const loadOrCreateProfile = async (
    firebaseUser: User,
    desiredRole?: UserRole,
    desiredDisplayName?: string
  ) => {
    const userDocRef = doc(db, 'users', firebaseUser.uid);
    try {
      const snap = await getDoc(userDocRef);
      const hasPendingInvitation = Boolean(sessionStorage.getItem(INVITATION_TOKEN_KEY));
      const isSpecialAdmin = firebaseUser.email?.toLowerCase() === 'thomas.leffler2@gmail.com';

      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (isSpecialAdmin && data.role !== 'super_admin') {
          data.role = 'super_admin';
        }
        setProfile(data);
      } else {
        const initialRole: UserRole = isSpecialAdmin
          ? 'super_admin'
          : hasPendingInvitation
          ? 'photographer'
          : desiredRole || 'event_manager';

        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || `${firebaseUser.uid}@lumina.local`,
          displayName:
            desiredDisplayName?.trim() ||
            firebaseUser.displayName ||
            (isSpecialAdmin
              ? 'Super Admin'
              : initialRole === 'event_manager'
              ? 'Event Director'
              : 'Event Photographer'),
          role: initialRole,
          assignedEvents: [],
          inviteStatus: 'active',
          createdAt: new Date().toISOString()
        };

        try {
          await setDoc(userDocRef, newProfile);
        } catch (e) {
          console.warn('Could not save user profile doc:');
        }

        setProfile(newProfile);
      }
    } catch (err) {
      console.warn('Could not sync user profile to Firestore:');
      setProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email || 'user@example.com',
        displayName: firebaseUser.displayName || 'Event User',
        role: sessionStorage.getItem(INVITATION_TOKEN_KEY) ? 'photographer' : desiredRole || 'event_manager',
        assignedEvents: [],
        inviteStatus: 'active'
      });
    }
  };

  const acceptInvitation = async (firebaseUser: User, token: string) => {
    if (acceptingInvitationRef.current === token) return;

    acceptingInvitationRef.current = token;
    setInvitationStatus('accepting');
    setInvitationError(null);

    try {
      const result = await invitationService.accept(token);
      const profileSnapshot = await getDoc(doc(db, 'users', firebaseUser.uid));
      if (profileSnapshot.exists()) {
        setProfile(profileSnapshot.data() as UserProfile);
      }

      sessionStorage.removeItem(INVITATION_TOKEN_KEY);
      setPendingInvitationToken(null);
      setAcceptedInvitationEventId(result.eventId);
      setInvitationStatus('accepted');
      removeInvitationTokenFromUrl();
    } catch (error) {
      const message = 'Could not accept this invitation. Check the link and signed-in account, then try again.';
      setInvitationError(message);
      setInvitationStatus('error');
    } finally {
      acceptingInvitationRef.current = null;
    }
  };

  const retryInvitation = async () => {
    if (!auth.currentUser || !pendingInvitationToken) return;
    await acceptInvitation(auth.currentUser, pendingInvitationToken);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setLoading(true);
        setUser(currentUser);
        sessionStorage.removeItem('lumina_demo_session');
        const pendingSignUp = pendingSignUpRef.current;
        await loadOrCreateProfile(currentUser, pendingSignUp?.role, pendingSignUp?.displayName);
        pendingSignUpRef.current = null;
        const token = getStoredInvitationToken();
        if (token) {
          await acceptInvitation(currentUser, token);
        }
      } else {
        setUser(null);
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      sessionStorage.removeItem('lumina_demo_session');
    } catch (err: any) {
      console.error('Google Sign In failed:');
      throw err;
    }
  };

  const handleEmailSignIn = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      sessionStorage.removeItem('lumina_demo_session');
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-in is disabled in this Firebase project. Please use "Continue with Google".'
        );
      }
      throw err;
    }
  };

  const handleEmailSignUp = async (email: string, pass: string, desiredRole: UserRole, displayName?: string) => {
    pendingSignUpRef.current = { role: desiredRole, displayName };
    try {
      await createUserWithEmailAndPassword(auth, email, pass);
      sessionStorage.removeItem('lumina_demo_session');
    } catch (err: any) {
      pendingSignUpRef.current = null;
      if (err.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-up is disabled in this Firebase project. Please use "Continue with Google".'
        );
      }
      throw err;
    }
  };

  const handleLogOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      // ignore
    }
    sessionStorage.removeItem('lumina_demo_session');
    setUser(null);
    setProfile(null);
  };

  const isUserEmailSpecialAdmin = user?.email?.toLowerCase() === 'thomas.leffler2@gmail.com';
  const activeRole: UserRole = profile?.role || (isUserEmailSpecialAdmin ? 'super_admin' : 'event_manager');
  const isSuperAdmin = activeRole === 'super_admin' || isUserEmailSpecialAdmin;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        role: activeRole,
        isSuperAdmin,
        isManager: activeRole === 'event_manager' || isSuperAdmin,
        isPhotographer: activeRole === 'photographer',
        pendingInvitationToken,
        invitationStatus,
        invitationError,
        acceptedInvitationEventId,
        retryInvitation,
        signInWithGoogle: handleGoogleSignIn,
        signInWithEmail: handleEmailSignIn,
        signUpWithEmail: handleEmailSignUp,
        logOut: handleLogOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
