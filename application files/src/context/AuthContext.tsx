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
  isDemoMode: boolean;
  pendingInvitationToken: string | null;
  invitationStatus: InvitationStatus;
  invitationError: string | null;
  acceptedInvitationEventId: string | null;
  retryInvitation: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithDemo: (role: UserRole, customEmail?: string) => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, role: UserRole, displayName?: string) => Promise<void>;
  logOut: () => Promise<void>;
  updateRole: (newRole: UserRole) => Promise<void>;
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

    // Real Firebase authentication is required to accept invitations.
    if (pendingInvitationToken) {
      sessionStorage.removeItem('lumina_demo_session');
    }

    // Check for saved demo session
    const savedDemo = pendingInvitationToken ? null : sessionStorage.getItem('lumina_demo_session');
    if (savedDemo) {
      try {
        const parsed = JSON.parse(savedDemo);
        setUser(parsed.user);
        setProfile(parsed.profile);
      } catch (e) {
        // ignore
      }
    }
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
          console.warn('Could not save user profile doc:', e);
        }

        setProfile(newProfile);
      }
    } catch (err) {
      console.warn('Could not sync user profile to Firestore:', err);
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
      const message = error instanceof Error ? error.message : 'Could not accept this invitation.';
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
        // If not authenticated via Firebase, check if demo session exists
        const savedDemo = sessionStorage.getItem('lumina_demo_session');
        if (!savedDemo) {
          setUser(null);
          setProfile(null);
        }
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
      console.error('Google Sign In failed:', err);
      throw err;
    }
  };

  // Instant Demo Login (simulates full authenticated session without requiring email/password provider to be enabled)
  const handleDemoSignIn = async (desiredRole: UserRole, customEmail?: string) => {
    if (pendingInvitationToken) {
      throw new Error('Use Google or email sign-in to accept a photographer invitation.');
    }
    setLoading(true);
    try {
      const isAdmin = desiredRole === 'super_admin';
      const isMgr = desiredRole === 'event_manager';
      const email =
        customEmail ||
        (isAdmin
          ? 'thomas.leffler2@gmail.com'
          : isMgr
          ? 'manager@lumina.event'
          : 'photographer@lumina.event');
      const uid = isAdmin ? 'demo_admin_001' : isMgr ? 'demo_mgr_101' : 'demo_photo_202';
      const displayName = isAdmin
        ? 'Super Admin (Demo)'
        : isMgr
        ? 'Event Director (Demo)'
        : 'Lead Photographer (Demo)';

      const demoUserObj: any = {
        uid,
        email,
        displayName,
        emailVerified: true,
        isAnonymous: false,
        providerData: [{ providerId: 'demo', email }]
      };

      const demoProfileObj: UserProfile = {
        uid,
        email,
        displayName,
        role: desiredRole,
        assignedEvents: [],
        inviteStatus: 'active',
        createdAt: new Date().toISOString()
      };

      // Store in demo session
      sessionStorage.setItem(
        'lumina_demo_session',
        JSON.stringify({ user: demoUserObj, profile: demoProfileObj })
      );

      setUser(demoUserObj);
      setProfile(demoProfileObj);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignIn = async (email: string, pass: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      sessionStorage.removeItem('lumina_demo_session');
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-in is disabled in this Firebase project. Please use "Continue with Google" or "Quick Demo Login".'
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
          'Email/Password sign-up is disabled in this Firebase project. Please use "Continue with Google" or "Quick Demo Login".'
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

  const updateRole = async (newRole: UserRole) => {
    if (!user) return;
    const savedDemoSession = sessionStorage.getItem('lumina_demo_session');
    if (!savedDemoSession) return;

    const saved = JSON.parse(savedDemoSession);
    saved.profile.role = newRole;
    sessionStorage.setItem('lumina_demo_session', JSON.stringify(saved));
    setProfile((previous) => (previous ? { ...previous, role: newRole } : null));
  };

  const isUserEmailSpecialAdmin = user?.email?.toLowerCase() === 'thomas.leffler2@gmail.com';
  const activeRole: UserRole = profile?.role || (isUserEmailSpecialAdmin ? 'super_admin' : 'event_manager');
  const isSuperAdmin = activeRole === 'super_admin' || isUserEmailSpecialAdmin;
  const isDemoMode = Boolean(sessionStorage.getItem('lumina_demo_session'));

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
        isDemoMode,
        pendingInvitationToken,
        invitationStatus,
        invitationError,
        acceptedInvitationEventId,
        retryInvitation,
        signInWithGoogle: handleGoogleSignIn,
        signInWithDemo: handleDemoSignIn,
        signInWithEmail: handleEmailSignIn,
        signUpWithEmail: handleEmailSignUp,
        logOut: handleLogOut,
        updateRole
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
