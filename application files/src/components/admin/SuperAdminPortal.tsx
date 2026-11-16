import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldAlert,
  Building2,
  Users,
  Camera,
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  Trash2,
  Calendar,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Share2,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Mail,
  UserCheck,
  Database,
  Layers,
  Eye,
  Download,
  SlidersHorizontal,
  Check,
  Info
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { adminService } from '../../services/adminService';
import { eventService } from '../../services/eventService';
import { EventItem, PlatformMetrics, ManagerSummary, PhotographerSummary, PhotoRecord, UserProfile } from '../../types';

interface SuperAdminPortalProps {
  onOpenEventManager: (eventId: string) => void;
  onOpenCheckInKiosk: (eventId: string) => void;
  onOpenPhotographerPortal: (eventId?: string) => void;
}

type AdminTab = 'photos' | 'users' | 'events' | 'managers' | 'photographers' | 'compliance' | 'database';

export const SuperAdminPortal: React.FC<SuperAdminPortalProps> = ({
  onOpenEventManager,
  onOpenCheckInKiosk,
  onOpenPhotographerPortal
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('photos');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [managers, setManagers] = useState<ManagerSummary[]>([]);
  const [photographers, setPhotographers] = useState<PhotographerSummary[]>([]);
  const [allPhotos, setAllPhotos] = useState<PhotoRecord[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [photoEventFilter, setPhotoEventFilter] = useState<string>('all');
  const [photoStatusFilter, setPhotoStatusFilter] = useState<string>('all');
  const [userRoleFilter, setUserRoleFilter] = useState<string>('all');
  const [userEventFilter, setUserEventFilter] = useState<string>('all');

  // Preview Modal
  const [previewPhoto, setPreviewPhoto] = useState<PhotoRecord | null>(null);

  // Delete modal
  const [deleteModalEvent, setDeleteModalEvent] = useState<EventItem | null>(null);
  const [deleteModalPhoto, setDeleteModalPhoto] = useState<PhotoRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Database initialization state
  const [initializingDb, setInitializingDb] = useState(false);
  const [initResult, setInitResult] = useState<{
    success: boolean;
    collectionsInitialized: string[];
    recordsCount: number;
  } | null>(null);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const data = await adminService.getPlatformOverview(isRefresh);
      setMetrics(data.metrics);
      setEvents(data.events);
      setManagers(data.managers);
      setPhotographers(data.photographers);
      setAllPhotos(data.allPhotos || []);
      setAllUsers(data.allUsers || []);
    } catch (err: any) {
      console.error('Failed to load super admin data:', err);
      setError(err.message || 'Failed to retrieve cross-platform metrics. Please verify permissions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered Photos (Master photos table)
  const filteredPhotos = useMemo(() => {
    let result = allPhotos;

    if (photoEventFilter !== 'all') {
      result = result.filter(
        (p) => p.eventId === photoEventFilter || p.event_id === photoEventFilter
      );
    }

    if (photoStatusFilter !== 'all') {
      result = result.filter((p) => p.status === photoStatusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (p) =>
          (p.fileName && p.fileName.toLowerCase().includes(q)) ||
          (p.id && p.id.toLowerCase().includes(q)) ||
          (p.eventName && p.eventName.toLowerCase().includes(q)) ||
          (p.eventId && p.eventId.toLowerCase().includes(q)) ||
          (p.event_id && p.event_id.toLowerCase().includes(q)) ||
          (p.uploadedByEmail && p.uploadedByEmail.toLowerCase().includes(q))
      );
    }

    return result;
  }, [allPhotos, photoEventFilter, photoStatusFilter, searchQuery]);

  // Filtered Users (Master users table)
  const filteredUsers = useMemo(() => {
    let result = allUsers || [];

    if (userRoleFilter !== 'all') {
      result = result.filter((u) => u && u.role === userRoleFilter);
    }

    if (userEventFilter !== 'all') {
      result = result.filter(
        (u) => u && u.assignedEvents && u.assignedEvents.includes(userEventFilter)
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (u) =>
          u &&
          ((u.email && u.email.toLowerCase().includes(q)) ||
            (u.displayName && u.displayName.toLowerCase().includes(q)) ||
            (u.uid && u.uid.toLowerCase().includes(q)))
      );
    }

    return result;
  }, [allUsers, userRoleFilter, userEventFilter, searchQuery]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    if (!searchQuery.trim()) return events || [];
    const q = searchQuery.toLowerCase().trim();
    return (events || []).filter(
      (e) =>
        e &&
        ((e.name && e.name.toLowerCase().includes(q)) ||
          (e.location && e.location.toLowerCase().includes(q)) ||
          (e.ownerEmail && e.ownerEmail.toLowerCase().includes(q)) ||
          (e.ownerUid && e.ownerUid.toLowerCase().includes(q)))
    );
  }, [events, searchQuery]);

  // Filtered Managers
  const filteredManagers = useMemo(() => {
    if (!searchQuery.trim()) return managers || [];
    const q = searchQuery.toLowerCase().trim();
    return (managers || []).filter(
      (m) =>
        m &&
        ((m.email && m.email.toLowerCase().includes(q)) ||
          (m.displayName && m.displayName.toLowerCase().includes(q)) ||
          (m.ownerUid && m.ownerUid.toLowerCase().includes(q)))
    );
  }, [managers, searchQuery]);

  // Filtered Photographers
  const filteredPhotographers = useMemo(() => {
    if (!searchQuery.trim()) return photographers || [];
    const q = searchQuery.toLowerCase().trim();
    return (photographers || []).filter(
      (p) =>
        p &&
        ((p.email && p.email.toLowerCase().includes(q)) ||
          (p.assignedEventNames &&
            Array.isArray(p.assignedEventNames) &&
            p.assignedEventNames.some((name) => name && name.toLowerCase().includes(q))))
    );
  }, [photographers, searchQuery]);

  const handleDeleteEvent = async () => {
    if (!deleteModalEvent) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await adminService.deleteEventAsAdmin(deleteModalEvent.id);
      setDeleteModalEvent(null);
      await loadData(true);
    } catch (err: any) {
      console.error('Failed to delete event as admin:', err);
      let msg = err.message || 'Error deleting event';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) msg = parsed.error;
      } catch (e) {}
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (!deleteModalPhoto) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await eventService.deletePhoto(
        deleteModalPhoto.eventId,
        deleteModalPhoto.id,
        [deleteModalPhoto.storagePath, deleteModalPhoto.clearedStoragePath, deleteModalPhoto.rawStoragePath]
      );
      setDeleteModalPhoto(null);
      await loadData(true);
    } catch (err: any) {
      console.error('Failed to delete photo as admin:', err);
      setDeleteError(err.message || 'Error deleting photo');
    } finally {
      setDeleting(false);
    }
  };

  const handleInitializeDatabase = async () => {
    setInitializingDb(true);
    setInitResult(null);
    try {
      const currentUid = user?.uid || 'thomas_admin_owner';
      const currentEmail = user?.email || 'thomas.leffler2@gmail.com';
      const res = await adminService.initializeDatabase(currentUid, currentEmail);
      setInitResult(res);
      await loadData(true);
    } catch (e: any) {
      console.error('Database initialization error:', e);
      setError(e.message || 'Failed to initialize database');
    } finally {
      setInitializingDb(false);
    }
  };

  const [isResettingDemo, setIsResettingDemo] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);
  const [resetWipeOnly, setResetWipeOnly] = useState(false);

  const handleResetDemo = async () => {
    setIsResettingDemo(true);
    setInitResult(null);
    try {
      const currentUid = user?.uid || 'thomas_admin_owner';
      const currentEmail = user?.email || 'thomas.leffler2@gmail.com';
      if (resetWipeOnly) {
        await adminService.wipeAllData();
        setInitResult({
          success: true,
          collectionsInitialized: [],
          recordsCount: 0
        });
      } else {
        const res = await adminService.resetDemoToScratch(currentUid, currentEmail);
        setInitResult(res);
      }
      setShowResetConfirmModal(false);
      await loadData(true);
    } catch (e: any) {
      console.error('Reset demo error:', e);
      setError(e.message || 'Failed to reset demo');
    } finally {
      setIsResettingDemo(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/70 pb-20">
      {/* Top Banner / Breadcrumb Header */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center font-bold shadow-xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                  Super Admin Console
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-violet-100 text-violet-800 border border-violet-200">
                  Company Owner
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Centralized Photo Roster, User Directory, Event Governance, and Firestore Materialization
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setActiveTab('database')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'database'
                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-amber-600" />
              <span>GCloud DB Spec</span>
            </button>

            <button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        {/* Error Banner */}
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => loadData(true)}
              className="text-xs font-semibold text-rose-700 hover:underline"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Global Platform KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* Total Photos Uploaded (Master Table) */}
          <div
            onClick={() => setActiveTab('photos')}
            className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:border-violet-300 transition cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Master Photos
              </span>
              <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
                <Camera className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {loading ? '—' : allPhotos.length}
            </div>
            <p className="text-xs text-purple-600 font-medium mt-1 flex items-center gap-1">
              <span>View global photos list with event_id</span>
              <ArrowRight className="w-3 h-3" />
            </p>
          </div>

          {/* Users Table */}
          <div
            onClick={() => setActiveTab('users')}
            className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:border-violet-300 transition cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Users Table
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {loading ? '—' : allUsers.length || managers.length + photographers.length}
            </div>
            <p className="text-xs text-emerald-600 font-medium mt-1 flex items-center gap-1">
              <span>View independent users table</span>
              <ArrowRight className="w-3 h-3" />
            </p>
          </div>

          {/* Total Events */}
          <div
            onClick={() => setActiveTab('events')}
            className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:border-violet-300 transition cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Events
              </span>
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Calendar className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {loading ? '—' : metrics?.totalEvents ?? events.length}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Active across all platform managers
            </p>
          </div>

          {/* Photo Marketing Consent Rate */}
          <div
            onClick={() => setActiveTab('compliance')}
            className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:border-violet-300 transition cursor-pointer"
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Marketing Consent
              </span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
            <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
              {loading ? '—' : `${metrics?.photoConsentPercentage ?? 0}%`}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {metrics?.photoConsentCount ?? 0} of {metrics?.totalAttendees ?? 0} consented
            </p>
          </div>
        </div>

        {/* Tab Controls & Search Bar */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden mb-6">
          <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full md:w-auto overflow-x-auto">
              {/* Master Photos Tab */}
              <button
                onClick={() => setActiveTab('photos')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === 'photos'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Camera className="w-3.5 h-3.5 text-purple-600" />
                <span>All Photos ({allPhotos.length})</span>
                <span className="px-1.5 py-0.2 bg-purple-100 text-purple-700 rounded text-[10px] font-mono">
                  Master
                </span>
              </button>

              {/* Master Users Tab */}
              <button
                onClick={() => setActiveTab('users')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === 'users'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-600" />
                <span>Users Table ({allUsers.length})</span>
                <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-700 rounded text-[10px] font-mono">
                  Table
                </span>
              </button>

              {/* Events Tab */}
              <button
                onClick={() => setActiveTab('events')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  activeTab === 'events'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Events ({events.length})
              </button>

              {/* Event Managers Tab */}
              <button
                onClick={() => setActiveTab('managers')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  activeTab === 'managers'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Managers ({managers.length})
              </button>

              {/* Photographers Tab */}
              <button
                onClick={() => setActiveTab('photographers')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  activeTab === 'photographers'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Photographers ({photographers.length})
              </button>

              {/* Governance */}
              <button
                onClick={() => setActiveTab('compliance')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap ${
                  activeTab === 'compliance'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Governance
              </button>

              {/* Database Schema & GCloud Sync */}
              <button
                onClick={() => setActiveTab('database')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeTab === 'database'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-amber-700 hover:text-amber-900'
                }`}
              >
                <Database className="w-3.5 h-3.5" />
                <span>GCloud DB Setup</span>
              </button>
            </div>

            {/* Live Search Field */}
            {activeTab !== 'compliance' && activeTab !== 'database' && (
              <div className="relative w-full md:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={`Search in ${activeTab}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-600 focus:bg-white transition"
                />
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* TAB 1: MASTER PHOTOS ROSTER (Top-level Photos Table with event_id column) */}
          {/* ========================================================================= */}
          {activeTab === 'photos' && (
            <div>
              {/* Photo Filter Toolbar */}
              <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Event Selector Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-500">Filter by Event:</span>
                    <select
                      value={photoEventFilter}
                      onChange={(e) => setPhotoEventFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    >
                      <option value="all">All Events ({allPhotos.length} photos)</option>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name} ({allPhotos.filter((p) => p.eventId === ev.id || p.event_id === ev.id).length})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Status Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-500">Status:</span>
                    <select
                      value={photoStatusFilter}
                      onChange={(e) => setPhotoStatusFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                    >
                      <option value="all">All Statuses</option>
                      <option value="processed">Processed (Face Tagged & Blurred)</option>
                      <option value="pending">Pending AI Processing</option>
                      <option value="flagged">Flagged</option>
                    </select>
                  </div>

                  {(photoEventFilter !== 'all' || photoStatusFilter !== 'all' || searchQuery) && (
                    <button
                      onClick={() => {
                        setPhotoEventFilter('all');
                        setPhotoStatusFilter('all');
                        setSearchQuery('');
                      }}
                      className="text-purple-600 hover:text-purple-800 text-xs font-semibold cursor-pointer underline"
                    >
                      Reset filters
                    </button>
                  )}
                </div>

                <div className="text-slate-500 font-mono text-[11px]">
                  Showing <span className="font-bold text-slate-800">{filteredPhotos.length}</span> of{' '}
                  <span className="font-bold text-slate-800">{allPhotos.length}</span> company photos
                </div>
              </div>

              {/* Photo Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-purple-600" />
                    <p className="text-xs">Loading central photos table...</p>
                  </div>
                ) : filteredPhotos.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <Camera className="w-12 h-12 mx-auto mb-3 opacity-40 text-purple-400" />
                    <p className="text-sm font-semibold text-slate-700">No photos found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {searchQuery || photoEventFilter !== 'all'
                        ? 'Try adjusting your event or status filters'
                        : 'No photos have been uploaded yet. Click "GCloud DB Setup" to seed sample data.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-4">Photo Preview</th>
                        <th className="py-3.5 px-4">File Name & Info</th>
                        <th className="py-3.5 px-4">
                          <span className="flex items-center gap-1">
                            <span>event_id / Event Name</span>
                            <span className="text-[10px] font-mono text-purple-700 bg-purple-100 px-1 py-0.2 rounded">
                              Column
                            </span>
                          </span>
                        </th>
                        <th className="py-3.5 px-4">Uploader</th>
                        <th className="py-3.5 px-4">AI Processing & Privacy</th>
                        <th className="py-3.5 px-4">Uploaded</th>
                        <th className="py-3.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPhotos.map((photo) => (
                        <tr key={photo.id} className="hover:bg-slate-50/70 transition">
                          {/* Preview Thumbnail */}
                          <td className="py-3 px-4">
                            <div
                              onClick={() => setPreviewPhoto(photo)}
                              className="relative w-14 h-14 rounded-lg overflow-hidden bg-slate-100 border border-slate-200 group cursor-pointer flex-shrink-0"
                            >
                              <img
                                src={photo.clearedDownloadUrl || photo.downloadUrl}
                                alt={photo.fileName}
                                className="w-full h-full object-cover group-hover:scale-105 transition"
                              />
                              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                                <Eye className="w-4 h-4" />
                              </div>
                            </div>
                          </td>

                          {/* File Details */}
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 truncate max-w-[200px]" title={photo.fileName}>
                              {photo.fileName}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              ID: {photo.id}
                            </div>
                            {photo.fileSize && (
                              <div className="text-[10px] text-slate-500 mt-0.5">
                                {(photo.fileSize / 1024 / 1024).toFixed(2)} MB
                              </div>
                            )}
                          </td>

                          {/* Event ID Column */}
                          <td className="py-3 px-4">
                            <div className="font-medium text-indigo-700 flex items-center gap-1.5">
                              <span>{photo.eventName || 'Event ' + (photo.eventId || photo.event_id)}</span>
                            </div>
                            <button
                              onClick={() => setPhotoEventFilter(photo.eventId || photo.event_id || 'all')}
                              className="mt-1 px-1.5 py-0.5 rounded font-mono text-[10px] bg-slate-100 hover:bg-purple-100 hover:text-purple-700 text-slate-600 transition flex items-center gap-1 cursor-pointer"
                              title="Filter photos by this event ID"
                            >
                              <span>event_id: {photo.eventId || photo.event_id}</span>
                              <Filter className="w-2.5 h-2.5 opacity-60" />
                            </button>
                          </td>

                          {/* Uploader */}
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-900 truncate max-w-[150px]">
                              {photo.uploadedByEmail || 'Photographer'}
                            </div>
                            <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                              UID: {(photo.uploadedBy || 'unknown').slice(0, 8)}...
                            </div>
                          </td>

                          {/* AI Processing Status */}
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1 items-start">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                  photo.status === 'processed'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : photo.status === 'flagged'
                                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {photo.status}
                              </span>

                              {photo.hasBlurredFaces ? (
                                <span className="text-[10px] text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200 flex items-center gap-1 font-medium">
                                  <Sparkles className="w-3 h-3" />
                                  <span>{photo.blurredFaceCount || 1} face(s) redacted</span>
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">
                                  {photo.status === 'processed' ? 'No redactions needed' : 'Awaiting vision CV'}
                                </span>
                              )}

                              {photo.matchedAttendees && photo.matchedAttendees.length > 0 && (
                                <span className="text-[10px] text-slate-600">
                                  {photo.matchedAttendees.length} attendee(s) tagged
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Upload Date */}
                          <td className="py-3 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                            {photo.uploadedAt
                              ? new Date(photo.uploadedAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })
                              : '—'}
                          </td>

                          {/* Actions */}
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setPreviewPhoto(photo)}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-purple-600 hover:bg-purple-50 transition cursor-pointer"
                                title="Inspect Photo & Metadata"
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              <a
                                href={photo.clearedDownloadUrl || photo.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                download={photo.fileName}
                                className="p-1.5 rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 transition cursor-pointer"
                                title="Download Image"
                              >
                                <Download className="w-4 h-4" />
                              </a>

                              <button
                                onClick={() => setDeleteModalPhoto(photo)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                title="Delete Photo"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 2: MASTER USERS DIRECTORY (Independent Users Table) */}
          {/* ========================================================================= */}
          {activeTab === 'users' && (
            <div>
              {/* Users Filter Toolbar */}
              <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  {/* Role Filter */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-500">Filter Role:</span>
                    <select
                      value={userRoleFilter}
                      onChange={(e) => setUserRoleFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="all">All Roles ({allUsers.length} users)</option>
                      <option value="super_admin">Super Admins</option>
                      <option value="event_manager">Event Managers</option>
                      <option value="photographer">Photographers</option>
                    </select>
                  </div>

                  {/* Event Filter for Users */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-slate-500">Assigned Event:</span>
                    <select
                      value={userEventFilter}
                      onChange={(e) => setUserEventFilter(e.target.value)}
                      className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    >
                      <option value="all">All Event Assignments</option>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {(userRoleFilter !== 'all' || userEventFilter !== 'all' || searchQuery) && (
                    <button
                      onClick={() => {
                        setUserRoleFilter('all');
                        setUserEventFilter('all');
                        setSearchQuery('');
                      }}
                      className="text-emerald-600 hover:text-emerald-800 text-xs font-semibold cursor-pointer underline"
                    >
                      Reset filters
                    </button>
                  )}
                </div>

                <div className="text-slate-500 font-mono text-[11px]">
                  Showing <span className="font-bold text-slate-800">{filteredUsers.length}</span> of{' '}
                  <span className="font-bold text-slate-800">{allUsers.length}</span> master users
                </div>
              </div>

              {/* Users Table */}
              <div className="overflow-x-auto">
                {loading ? (
                  <div className="p-12 text-center text-slate-400">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-emerald-600" />
                    <p className="text-xs">Loading master users table...</p>
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <Users className="w-12 h-12 mx-auto mb-3 opacity-40 text-emerald-400" />
                    <p className="text-sm font-semibold text-slate-700">No users found</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {searchQuery || userRoleFilter !== 'all'
                        ? 'Try adjusting your filters'
                        : 'No users have registered yet. Click "GCloud DB Setup" to seed users.'}
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs text-slate-600">
                    <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-3.5 px-4">User Identity</th>
                        <th className="py-3.5 px-4">System Role</th>
                        <th className="py-3.5 px-4">Assigned Events</th>
                        <th className="py-3.5 px-4">Status</th>
                        <th className="py-3.5 px-4">Created</th>
                        <th className="py-3.5 px-4 text-right">Quick Filter</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((u) => (
                        <tr key={u.uid} className="hover:bg-slate-50/70 transition">
                          {/* Identity */}
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-xs ${
                                  u.role === 'super_admin'
                                    ? 'bg-violet-600'
                                    : u.role === 'event_manager'
                                    ? 'bg-indigo-600'
                                    : 'bg-emerald-600'
                                }`}
                              >
                                {u.displayName ? u.displayName.charAt(0).toUpperCase() : u.email.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-medium text-slate-900">{u.displayName || 'User'}</div>
                                <div className="text-slate-500 text-[11px]">{u.email}</div>
                                <div className="text-[10px] font-mono text-slate-400">UID: {u.uid}</div>
                              </div>
                            </div>
                          </td>

                          {/* Role */}
                          <td className="py-3 px-4">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                u.role === 'super_admin'
                                  ? 'bg-violet-100 text-violet-800 border border-violet-200'
                                  : u.role === 'event_manager'
                                  ? 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                                  : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {u.role.replace('_', ' ')}
                            </span>
                          </td>

                          {/* Assigned Events */}
                          <td className="py-3 px-4">
                            {u.assignedEvents && u.assignedEvents.length > 0 ? (
                              <div className="flex flex-wrap gap-1 max-w-xs">
                                {u.assignedEvents.map((evId) => {
                                  const evObj = events.find((e) => e.id === evId);
                                  return (
                                    <span
                                      key={evId}
                                      onClick={() => {
                                        setPhotoEventFilter(evId);
                                        setActiveTab('photos');
                                      }}
                                      className="px-2 py-0.5 rounded bg-slate-100 hover:bg-purple-100 hover:text-purple-700 text-slate-700 text-[10px] font-medium transition cursor-pointer flex items-center gap-1"
                                      title="Filter photos by this event"
                                    >
                                      <span>{evObj ? evObj.name : evId}</span>
                                      <Camera className="w-2.5 h-2.5 opacity-60" />
                                    </span>
                                  );
                                })}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[11px]">Unassigned (Global)</span>
                            )}
                          </td>

                          {/* Account Status */}
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {u.inviteStatus || 'Active'}
                            </span>
                          </td>

                          {/* Created */}
                          <td className="py-3 px-4 whitespace-nowrap text-slate-500 text-[11px]">
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })
                              : '—'}
                          </td>

                          {/* Quick Filter */}
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setSearchQuery(u.email);
                                setActiveTab('photos');
                              }}
                              className="px-2 py-1 bg-slate-100 hover:bg-purple-100 text-slate-700 hover:text-purple-700 rounded-lg text-[11px] font-medium transition cursor-pointer inline-flex items-center gap-1"
                            >
                              <span>View Photos</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 3: ALL EVENTS */}
          {/* ========================================================================= */}
          {activeTab === 'events' && (
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-12 text-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-violet-600" />
                  <p className="text-xs">Loading platform events...</p>
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="p-12 text-center text-slate-400">
                  <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40 text-slate-400" />
                  <p className="text-sm font-semibold text-slate-700">No events found</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {searchQuery ? 'Try adjusting your search criteria' : 'No events have been created on the platform yet'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3.5 px-4">Event Details</th>
                      <th className="py-3.5 px-4">Manager / Owner</th>
                      <th className="py-3.5 px-4">Attendees</th>
                      <th className="py-3.5 px-4">Photos</th>
                      <th className="py-3.5 px-4">Photographers</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredEvents.map((ev) => (
                      <tr key={ev.id} className="hover:bg-slate-50/70 transition">
                        <td className="py-3.5 px-4">
                          <div className="font-semibold text-slate-900">{ev.name}</div>
                          <div className="flex items-center gap-3 text-slate-500 text-[11px] mt-0.5">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              {ev.date}
                            </span>
                            <span className="flex items-center gap-1 truncate max-w-[200px]">
                              <MapPin className="w-3 h-3 text-slate-400" />
                              {ev.location}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                            ID: {ev.id}
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900">
                            {ev.ownerEmail || 'manager@internal'}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400">
                            UID: {(ev.ownerUid || 'unknown').slice(0, 10)}...
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 font-mono">
                            {ev.counts?.attendees ?? 0}
                          </div>
                          <button
                            onClick={() => onOpenCheckInKiosk(ev.id)}
                            className="text-[11px] text-indigo-600 hover:underline flex items-center gap-0.5 mt-0.5 cursor-pointer"
                          >
                            <span>Open Kiosk</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 font-mono">
                            {ev.counts?.photos ?? 0}
                          </div>
                          <button
                            onClick={() => {
                              setPhotoEventFilter(ev.id);
                              setActiveTab('photos');
                            }}
                            className="text-[11px] text-purple-600 hover:underline flex items-center gap-0.5 mt-0.5 cursor-pointer"
                          >
                            <span>View {ev.counts?.photos ?? 0} Photos</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900">
                            {ev.assignedPhotographers?.length ?? 0} Assigned
                          </div>
                          <button
                            onClick={() => onOpenPhotographerPortal(ev.id)}
                            className="text-[11px] text-emerald-600 hover:underline flex items-center gap-0.5 mt-0.5 cursor-pointer"
                          >
                            <span>Open Portal</span>
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => onOpenEventManager(ev.id)}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1"
                            >
                              <span>Manage</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setDeleteModalEvent(ev)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                              title="Delete Event As Super Admin"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 4: EVENT MANAGERS BREAKDOWN */}
          {/* ========================================================================= */}
          {activeTab === 'managers' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3.5 px-4">Manager Identity</th>
                    <th className="py-3.5 px-4">Events Created</th>
                    <th className="py-3.5 px-4">Total Attendees</th>
                    <th className="py-3.5 px-4">Total Photos</th>
                    <th className="py-3.5 px-4">Last Event Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredManagers.map((m) => (
                    <tr key={m.ownerUid} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{m.displayName || m.email}</div>
                        <div className="text-slate-500 text-[11px]">{m.email}</div>
                        <div className="text-[10px] font-mono text-slate-400">UID: {m.ownerUid}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {m.eventsCount}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {m.totalAttendees}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {m.totalPhotos}
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {m.lastEventDate
                          ? new Date(m.lastEventDate).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 5: PHOTOGRAPHERS BREAKDOWN */}
          {/* ========================================================================= */}
          {activeTab === 'photographers' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50/80 text-slate-500 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-3.5 px-4">Photographer Email</th>
                    <th className="py-3.5 px-4">Assigned Events</th>
                    <th className="py-3.5 px-4">Event Names</th>
                    <th className="py-3.5 px-4">Total Uploads</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPhotographers.map((p) => (
                    <tr key={p.email} className="hover:bg-slate-50/70 transition">
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900">{p.email}</div>
                        {p.uid && <div className="text-[10px] font-mono text-slate-400">UID: {p.uid}</div>}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        {p.assignedEventsCount}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs truncate">
                        {p.assignedEventNames.join(', ') || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-purple-700">
                        {p.totalPhotosUploaded}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 6: GOVERNANCE & RETENTION */}
          {/* ========================================================================= */}
          {activeTab === 'compliance' && (
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-3 text-slate-900 font-bold text-sm">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>30-Day Automated Vector Cleanup (TTL)</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    All check-in selfie photographs and their extracted 512-dimensional facial embedding vectors
                    are assigned an immutable <code className="font-mono text-slate-800 bg-slate-200 px-1 py-0.5 rounded">deleteOn</code> timestamp
                    exactly 30 days after check-in.
                  </p>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between">
                    <span className="text-slate-600">Automated TTL Status:</span>
                    <span className="font-semibold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Active & Enforced
                    </span>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-3 text-slate-900 font-bold text-sm">
                    <Sparkles className="w-4 h-4 text-purple-600" />
                    <span>Zero-Consent Facial Redaction</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed mb-4">
                    Any face detected in high-resolution event photography that does not strictly match a
                    registered attendee who explicitly opted into photo marketing is automatically blurred
                    before public display.
                  </p>
                  <div className="p-3 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between">
                    <span className="text-slate-600">Company Consent Rate:</span>
                    <span className="font-semibold text-purple-700">
                      {metrics?.photoConsentPercentage ?? 0}% ({metrics?.photoConsentCount ?? 0} attendees)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* TAB 7: DATABASE SCHEMA & GCLOUD SPECIFICATION (User's Exact Issue) */}
          {/* ========================================================================= */}
          {activeTab === 'database' && (
            <div className="p-6">
              {/* Informational Callout */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold flex-shrink-0 mt-0.5">
                    <Info className="w-5 h-5" />
                  </div>
                  <div className="text-xs text-amber-950 space-y-2">
                    <h3 className="font-bold text-sm text-amber-900">
                      Why does GCloud Firestore look different from the DB spec?
                    </h3>
                    <p className="leading-relaxed">
                      <strong>1. Named Database:</strong> In Google Cloud Console, the default database displayed is{' '}
                      <code className="bg-amber-100 font-mono text-amber-900 px-1 py-0.5 rounded font-bold">(default)</code>.
                      However, this application's database is provisioned with database ID:{' '}
                      <code className="bg-amber-100 font-mono text-amber-900 px-1 py-0.5 rounded font-bold">
                        ai-studio-a1858ef2-f062-409f-aaff-1218861a9484
                      </code>. In Google Cloud Console &rarr; Firestore, make sure to switch the top database dropdown to this ID.
                    </p>
                    <p className="leading-relaxed">
                      <strong>2. Schema-less Initialization:</strong> Firestore does not use static DDL schemas like PostgreSQL.
                      Collections and document variables <em>do not appear in the GCloud console</em> until documents are actually written with those variables.
                    </p>
                    <p className="leading-relaxed">
                      <strong>3. Relational Top-Level Architecture:</strong> As requested, we have updated the architecture so that{' '}
                      <code className="bg-amber-100 font-mono text-amber-900 px-1 py-0.5 rounded font-bold">photos</code> and{' '}
                      <code className="bg-amber-100 font-mono text-amber-900 px-1 py-0.5 rounded font-bold">users</code> are now first-class root tables.
                      Photos have <code className="bg-amber-100 font-mono text-amber-900 px-1 py-0.5 rounded font-bold">eventId</code> and{' '}
                      <code className="bg-amber-100 font-mono text-amber-900 px-1 py-0.5 rounded font-bold">event_id</code> as relational columns.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action: Initialize & Materialize Database */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">
                      Initialize All Collections & Variables in GCloud
                    </h4>
                    <p className="text-xs text-slate-500 mt-1">
                      Materializes master records in <code className="font-mono font-semibold">admins</code>,{' '}
                      <code className="font-mono font-semibold">users</code>,{' '}
                      <code className="font-mono font-semibold">events</code>,{' '}
                      <code className="font-mono font-semibold">photos</code>, and{' '}
                      <code className="font-mono font-semibold">attendees</code> with all variables populated so they are immediately visible in your GCP console.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    <button
                      onClick={handleInitializeDatabase}
                      disabled={initializingDb || isResettingDemo}
                      className="px-4 py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-semibold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      {initializingDb ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Initializing...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Initialize / Seed Missing</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        setResetWipeOnly(false);
                        setShowResetConfirmModal(true);
                      }}
                      disabled={initializingDb || isResettingDemo}
                      className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      title="Wipe test events, photos, and check-ins, and start the demo over from scratch"
                    >
                      <Trash2 className="w-4 h-4 text-rose-600" />
                      <span>Wipe &amp; Reset Demo</span>
                    </button>
                  </div>
                </div>

                {/* Initialization Result Message */}
                {initResult && (
                  <div className="mt-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs">
                    <div className="flex items-center gap-2 font-bold text-emerald-800 mb-1">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Database Successfully Materialized!</span>
                    </div>
                    <p>
                      Initialized collections:{' '}
                      <span className="font-mono font-semibold">
                        {initResult.collectionsInitialized.map((c) => `/${c}`).join(', ')}
                      </span>{' '}
                      ({initResult.recordsCount} total documents written).
                    </p>
                    <p className="mt-1 text-slate-600">
                      Open your Google Cloud Firestore Console under database{' '}
                      <code className="font-mono font-bold text-slate-800">
                        ai-studio-a1858ef2-f062-409f-aaff-1218861a9484
                      </code>{' '}
                      to see the tables and variables live.
                    </p>
                  </div>
                )}
              </div>

              {/* Collections Schema Blueprint Table */}
              <div className="rounded-2xl border border-slate-200 overflow-hidden">
                <div className="p-4 bg-slate-50 border-b border-slate-200 font-bold text-xs text-slate-700 flex items-center justify-between">
                  <span>Firestore Blueprint & Schema Architecture</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    Target DB: ai-studio-a1858ef2-f062-409f-aaff-1218861a9484
                  </span>
                </div>
                <div className="divide-y divide-slate-100 text-xs">
                  {/* /photos/{photoId} */}
                  <div className="p-4 bg-white hover:bg-slate-50/50 transition">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-purple-700 text-xs bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                          /photos/{'{photoId}'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-purple-100 text-purple-800">
                          Master Table
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {allPhotos.length} records in database
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs mb-2">
                      Top-level photo table containing all company event photographs. Company owners can query and filter across all events without nesting.
                    </p>
                    <div className="flex flex-wrap gap-1 font-mono text-[10px] text-slate-600">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-purple-700 font-bold">id (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-indigo-700 font-bold">eventId (string - FK)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-indigo-700 font-bold">event_id (alias)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">uploadedBy (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">status (pending|processed|flagged)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">fileName (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">storagePath (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">matchedAttendees (array)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">hasBlurredFaces (boolean)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">blurredFaceCount (number)</span>
                    </div>
                  </div>

                  {/* /users/{userId} */}
                  <div className="p-4 bg-white hover:bg-slate-50/50 transition">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-emerald-700 text-xs bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          /users/{'{userId}'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                          Master Table
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {allUsers.length} records in database
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs mb-2">
                      Master user profile table independent of individual events. Supports multi-event assignments and role governance.
                    </p>
                    <div className="flex flex-wrap gap-1 font-mono text-[10px] text-slate-600">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-emerald-700 font-bold">uid (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">email (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">displayName (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">role (super_admin|event_manager|photographer)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">assignedEvents (array of eventId)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">inviteStatus (active|pending)</span>
                    </div>
                  </div>

                  {/* /events/{eventId} */}
                  <div className="p-4 bg-white hover:bg-slate-50/50 transition">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-indigo-700 text-xs bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          /events/{'{eventId}'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-800">
                          Master Table
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {events.length} records in database
                      </span>
                    </div>
                    <p className="text-slate-600 text-xs mb-2">
                      Event entity with schedule, custom registration questions, and assigned photographer references.
                    </p>
                    <div className="flex flex-wrap gap-1 font-mono text-[10px] text-slate-600">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-indigo-700 font-bold">id (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">ownerUid (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">name (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">date (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">ticketTypes (array)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">sessions (array)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">customFields (array)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">assignedPhotographers (array)</span>
                    </div>
                  </div>

                  {/* /attendees/{attendeeId} */}
                  <div className="p-4 bg-white hover:bg-slate-50/50 transition">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-700 text-xs bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          /attendees/{'{attendeeId}'}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-blue-100 text-blue-800">
                          Master Table
                        </span>
                      </div>
                    </div>
                    <p className="text-slate-600 text-xs mb-2">
                      Master attendee registration table linking to events via eventId / event_id.
                    </p>
                    <div className="flex flex-wrap gap-1 font-mono text-[10px] text-slate-600">
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-blue-700 font-bold">id (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded text-indigo-700 font-bold">eventId (string - FK)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">fullName (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">email (string)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">consentGiven (boolean)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">photoConsentGiven (boolean)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">photoEmbedding (512-D vector)</span>
                      <span className="bg-slate-100 px-1.5 py-0.5 rounded">deleteOn (30-day TTL)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PHOTO PREVIEW MODAL */}
      {/* ========================================================================= */}
      {previewPhoto && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-3xl w-full overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="p-4 sm:p-5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 text-base flex items-center gap-2">
                  <span>{previewPhoto.fileName}</span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      previewPhoto.status === 'processed'
                        ? 'bg-emerald-100 text-emerald-800'
                        : previewPhoto.status === 'flagged'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {previewPhoto.status}
                  </span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  event_id: {previewPhoto.eventId || previewPhoto.event_id} &bull; Photo ID: {previewPhoto.id}
                </p>
              </div>

              <button
                onClick={() => setPreviewPhoto(null)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              {/* Image Display */}
              <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center mb-5">
                <img
                  src={previewPhoto.clearedDownloadUrl || previewPhoto.downloadUrl}
                  alt={previewPhoto.fileName}
                  className="max-h-full max-w-full object-contain"
                />
                {previewPhoto.hasBlurredFaces && (
                  <div className="absolute bottom-3 left-3 bg-purple-900/90 text-white text-xs px-3 py-1.5 rounded-xl backdrop-blur-md border border-purple-500/40 flex items-center gap-1.5 font-medium shadow-lg">
                    <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                    <span>{previewPhoto.blurredFaceCount || 1} face(s) redacted for privacy</span>
                  </div>
                )}
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Event Name</span>
                  <span className="font-semibold text-slate-800 mt-0.5 truncate block">
                    {previewPhoto.eventName || previewPhoto.eventId}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Uploader</span>
                  <span className="font-semibold text-slate-800 mt-0.5 truncate block">
                    {previewPhoto.uploadedByEmail || (previewPhoto.uploadedBy ? previewPhoto.uploadedBy.slice(0, 10) : 'Photographer')}
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Tagged Attendees</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">
                    {previewPhoto.matchedAttendees?.length ?? 0} confirmed
                  </span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-400 block text-[10px] uppercase font-semibold">Storage Path</span>
                  <span className="font-mono text-[10px] text-slate-700 mt-0.5 truncate block">
                    {previewPhoto.storagePath}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  onClick={() => setPreviewPhoto(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Close
                </button>
                <a
                  href={previewPhoto.clearedDownloadUrl || previewPhoto.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  download={previewPhoto.fileName}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Image</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE PHOTO MODAL */}
      {/* ========================================================================= */}
      {deleteModalPhoto && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete Photo?</h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Are you sure you want to delete <strong className="text-slate-900">{deleteModalPhoto.fileName}</strong> from event{' '}
              <strong className="text-slate-900">{deleteModalPhoto.eventName || deleteModalPhoto.eventId}</strong>? This removes it from the central photos roster and Cloud Storage.
            </p>

            {deleteError && (
              <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 mt-6">
              <button
                onClick={() => setDeleteModalPhoto(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePhoto}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                {deleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete Photo</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DELETE EVENT MODAL */}
      {/* ========================================================================= */}
      {deleteModalEvent && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Delete Entire Event?</h3>
            <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-slate-900">{deleteModalEvent.name}</strong>? This action cascades to all attendees and photos in this event.
            </p>

            {deleteError && (
              <div className="mt-3 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {deleteError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 mt-6">
              <button
                onClick={() => setDeleteModalEvent(null)}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteEvent}
                disabled={deleting}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-60"
              >
                {deleting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete Event</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* RESET DEMO & WIPE DATABASE MODAL */}
      {/* ========================================================================= */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">Reset Demo &amp; Wipe Database?</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              This will completely wipe all test records across Firestore database{' '}
              <strong className="text-slate-900 font-mono">ai-studio-a1858ef2-f062-409f-aaff-1218861a9484</strong>, including all uploaded photos, check-in attendees, and test events.
            </p>

            <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={!resetWipeOnly}
                  onChange={(e) => setResetWipeOnly(!e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                />
                <span>Reseed fresh sample event &amp; attendees after wiping (Recommended)</span>
              </label>
              <p className="text-[11px] text-slate-500 pl-6">
                Uncheck if you want a 100% blank slate with zero records.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 mt-6">
              <button
                onClick={() => setShowResetConfirmModal(false)}
                disabled={isResettingDemo}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleResetDemo}
                disabled={isResettingDemo}
                className="px-5 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition cursor-pointer flex items-center gap-1.5 disabled:opacity-60 shadow-xs"
              >
                {isResettingDemo && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isResettingDemo ? 'Resetting Everything...' : 'Yes, Wipe & Reset'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
