import React, { createContext, useContext, useEffect, useState } from 'react';
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
  setDoc,
  updateDoc
} from '../lib/firebase';
import { User } from 'firebase/auth';
import { UserProfile, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  role: UserRole;
  isSuperAdmin: boolean;
  isManager: boolean;
  isPhotographer: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithDemo: (role: UserRole, customEmail?: string) => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, role: UserRole, displayName?: string) => Promise<void>;
  logOut: () => Promise<void>;
  updateRole: (newRole: UserRole) => Promise<void>;
  assignEventToUser: (eventId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for invite params in URL on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteEventId = params.get('inviteEvent');
    const inviteEmail = params.get('inviteEmail');
    if (inviteEventId) {
      sessionStorage.setItem('lumina_pending_invite_event', inviteEventId);
      if (inviteEmail) {
        sessionStorage.setItem('lumina_pending_invite_email', inviteEmail);
      }
    }

    // Check for saved demo session
    const savedDemo = sessionStorage.getItem('lumina_demo_session');
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

  const loadOrCreateProfile = async (firebaseUser: User, desiredRole?: UserRole) => {
    const userDocRef = doc(db, 'users', firebaseUser.uid);
    try {
      const snap = await getDoc(userDocRef);
      const pendingInviteEvent = sessionStorage.getItem('lumina_pending_invite_event');
      const isSpecialAdmin = firebaseUser.email?.toLowerCase() === 'thomas.leffler2@gmail.com';

      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        if (isSpecialAdmin && data.role !== 'super_admin') {
          data.role = 'super_admin';
          await updateDoc(userDocRef, { role: 'super_admin' }).catch(() => {});
        }
        if (pendingInviteEvent && !data.assignedEvents?.includes(pendingInviteEvent)) {
          const updatedEvents = [...(data.assignedEvents || []), pendingInviteEvent];
          await updateDoc(userDocRef, {
            assignedEvents: updatedEvents,
            role: 'photographer'
          });
          data.assignedEvents = updatedEvents;
          data.role = 'photographer';
          sessionStorage.removeItem('lumina_pending_invite_event');
        }
        setProfile(data);
      } else {
        const initialRole: UserRole = isSpecialAdmin
          ? 'super_admin'
          : desiredRole || (pendingInviteEvent ? 'photographer' : 'event_manager');
        const assignedEvents: string[] = pendingInviteEvent ? [pendingInviteEvent] : [];

        const newProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || `${firebaseUser.uid}@lumina.local`,
          displayName:
            firebaseUser.displayName ||
            (isSpecialAdmin
              ? 'Super Admin'
              : initialRole === 'event_manager'
              ? 'Event Director'
              : 'Event Photographer'),
          role: initialRole,
          assignedEvents,
          inviteStatus: 'active',
          createdAt: new Date().toISOString()
        };

        try {
          await setDoc(userDocRef, newProfile);
        } catch (e) {
          console.warn('Could not save user profile doc:', e);
        }

        if (pendingInviteEvent) {
          sessionStorage.removeItem('lumina_pending_invite_event');
        }
        setProfile(newProfile);
      }
    } catch (err) {
      console.warn('Could not sync user profile to Firestore:', err);
      setProfile({
        uid: firebaseUser.uid,
        email: firebaseUser.email || 'user@example.com',
        displayName: firebaseUser.displayName || 'Event User',
        role: desiredRole || 'event_manager',
        assignedEvents: [],
        inviteStatus: 'active'
      });
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        sessionStorage.removeItem('lumina_demo_session');
        await loadOrCreateProfile(currentUser);
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
    setLoading(true);
    try {
      const res = await signInWithPopup(auth, googleProvider);
      sessionStorage.removeItem('lumina_demo_session');
      await loadOrCreateProfile(res.user);
    } catch (err: any) {
      console.error('Google Sign In failed:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // Instant Demo Login (simulates full authenticated session without requiring email/password provider to be enabled)
  const handleDemoSignIn = async (desiredRole: UserRole, customEmail?: string) => {
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
    setLoading(true);
    try {
      const res = await signInWithEmailAndPassword(auth, email, pass);
      sessionStorage.removeItem('lumina_demo_session');
      await loadOrCreateProfile(res.user);
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-in is disabled in this Firebase project. Please use "Continue with Google" or "Quick Demo Login".'
        );
      }
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSignUp = async (email: string, pass: string, desiredRole: UserRole, displayName?: string) => {
    setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, email, pass);
      sessionStorage.removeItem('lumina_demo_session');
      await loadOrCreateProfile(res.user, desiredRole);
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed') {
        throw new Error(
          'Email/Password sign-up is disabled in this Firebase project. Please use "Continue with Google" or "Quick Demo Login".'
        );
      }
      throw err;
    } finally {
      setLoading(false);
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
    try {
      const userDocRef = doc(db, 'users', user.uid);
      await updateDoc(userDocRef, { role: newRole });
    } catch (err) {
      console.warn('Profile role update error:', err);
    }
    setProfile((prev) => (prev ? { ...prev, role: newRole } : null));
    if (sessionStorage.getItem('lumina_demo_session')) {
      const saved = JSON.parse(sessionStorage.getItem('lumina_demo_session')!);
      saved.profile.role = newRole;
      sessionStorage.setItem('lumina_demo_session', JSON.stringify(saved));
    }
  };

  const assignEventToUser = async (eventId: string) => {
    if (!user || !profile) return;
    const current = profile.assignedEvents || [];
    if (!current.includes(eventId)) {
      const updated = [...current, eventId];
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await updateDoc(userDocRef, { assignedEvents: updated });
      } catch (e) {
        console.warn('Assign event error:', e);
      }
      setProfile({ ...profile, assignedEvents: updated });
    }
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
        signInWithGoogle: handleGoogleSignIn,
        signInWithDemo: handleDemoSignIn,
        signInWithEmail: handleEmailSignIn,
        signUpWithEmail: handleEmailSignUp,
        logOut: handleLogOut,
        updateRole,
        assignEventToUser
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
