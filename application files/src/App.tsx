import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navigation } from './components/Navigation';
import { SuperAdminPortal } from './components/admin/SuperAdminPortal';
import { EventManagerPortal } from './components/manager/EventManagerPortal';
import { PhotographerPortal } from './components/photographer/PhotographerPortal';
import { AttendeeCheckInPage } from './components/attendee/AttendeeCheckInPage';
import { AttendeeGalleryPage } from './components/attendee/AttendeeGalleryPage';
import { RefreshCw, ArrowLeft } from 'lucide-react';
import { AuthModal } from './components/AuthModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ThemeToggle } from './components/ThemeToggle';
import { portalForRole, publicCheckInEvent } from './lib/access';

const MainApp: React.FC = () => {
  const { user, role, loading, isSuperAdmin, pendingInvitationToken,
    invitationStatus, invitationError, retryInvitation } = useAuth();
  const [location, setLocation] = useState(() => window.location.href);
  const [adminEventId, setAdminEventId] = useState<string | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [previewEventId, setPreviewEventId] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const url = new URL(location);
  const galleryToken = url.searchParams.get('gallery');
  const checkInEventId = publicCheckInEvent(url);
  const portal = portalForRole(role, isSuperAdmin);

  useEffect(() => {
    const handlePopState = () => setLocation(window.location.href);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setAdminEventId(null);
    setCreatingEvent(false);
    setPreviewEventId(null);
  }, [user?.uid, role]);

  useEffect(() => {
    if (!loading && pendingInvitationToken && !user) setShowAuthModal(true);
  }, [loading, pendingInvitationToken, user]);

  const openPreview = (eventId: string) => {
    if (user && (isSuperAdmin || role === 'event_manager')) setPreviewEventId(eventId);
  };

  // A public event URL never exposes portal navigation, even to signed-in staff.
  if (galleryToken) return <><div className="public-settings-bar"><ThemeToggle /></div><AttendeeGalleryPage token={galleryToken} /></>;
  if (checkInEventId) return <><div className="public-settings-bar"><ThemeToggle /></div><AttendeeCheckInPage eventId={checkInEventId} /></>;

  if (loading) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin" aria-label="Loading" /></div>;

  if (user && previewEventId && (isSuperAdmin || role === 'event_manager')) {
    return <><div className="public-settings-bar"><ThemeToggle /></div><AttendeeCheckInPage
      eventId={previewEventId} previewOnly onBackToApp={() => setPreviewEventId(null)} /></>;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      <Navigation currentSurface={user ? portal : undefined} />
      {user && invitationStatus === 'error' && <div className="p-4 bg-rose-50 text-rose-900 text-sm">
        {invitationError || 'Invitation could not be accepted.'}
        <button onClick={retryInvitation} className="ml-3 underline">Try again</button>
      </div>}
      {user && invitationStatus === 'accepted' && <div className="p-4 bg-emerald-50 text-emerald-900 text-sm">Invitation accepted. Your assigned event is available.</div>}
      {!user ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center border border-slate-200">
            <h1 className="text-xl font-bold text-slate-900">Sign in to Masquerade</h1>
            <p className="text-sm text-slate-600 mt-3 mb-6">Sign in with your staff account to access your assigned workspace.</p>
            <button onClick={() => setShowAuthModal(true)} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold">Sign In</button>
          </div>
        </div>
      ) : portal === 'admin' && !adminEventId && !creatingEvent ? (
        <ErrorBoundary fallbackTitle="Superuser workspace error"><SuperAdminPortal
          onCreateEvent={() => setCreatingEvent(true)}
          onOpenEventManager={setAdminEventId} onOpenCheckInKiosk={openPreview} /></ErrorBoundary>
      ) : portal === 'photographer' ? (
        <ErrorBoundary fallbackTitle="Photographer workspace error"><PhotographerPortal /></ErrorBoundary>
      ) : (
        <ErrorBoundary fallbackTitle="Event workspace error">
          {isSuperAdmin && adminEventId && <div className="px-6 pt-4"><button
            onClick={() => setAdminEventId(null)} className="flex items-center gap-2 text-sm font-semibold text-indigo-700">
            <ArrowLeft className="w-4 h-4" /> Back to all events
          </button></div>}
          <EventManagerPortal
            key={isSuperAdmin && creatingEvent ? 'create-event' : adminEventId || 'manager'}
            initialEventId={isSuperAdmin ? adminEventId : null}
            createOnOpen={isSuperAdmin && creatingEvent}
            onCancelCreate={() => setCreatingEvent(false)}
            onEventCreated={isSuperAdmin ? eventId => {
              setAdminEventId(eventId);
              setCreatingEvent(false);
            } : undefined}
            onOpenCheckIn={openPreview}
          />
        </ErrorBoundary>
      )}
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} defaultRole={pendingInvitationToken ? 'photographer' : 'event_manager'} />
    </div>
  );
};

export default function App() {
  return <AuthProvider><MainApp /></AuthProvider>;
}
