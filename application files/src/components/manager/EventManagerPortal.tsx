import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Calendar,
  MapPin,
  Users,
  Image as ImageIcon,
  CheckCircle2,
  Check,
  Plus,
  Trash2,
  Edit3,
  ExternalLink,
  Copy,
  Download,
  Search,
  Filter,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Mail,
  UserPlus,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  QrCode,
  Eye,
  X,
  Sparkles,
  Camera,
  UserCheck,
  Play,
  Lock,
  Cpu,
  Layers,
  Terminal,
  Share2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { eventService } from '../../services/eventService';
import { EventItem, AttendeeRecord, PhotoRecord, CustomField, AssignedPhotographer } from '../../types';

interface EventManagerPortalProps {
  onOpenCheckIn: (eventId: string) => void;
}

type TabType = 'overview' | 'attendees' | 'gallery' | 'settings';

export const EventManagerPortal: React.FC<EventManagerPortalProps> = ({ onOpenCheckIn }) => {
  const { user, profile } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [loadingEvents, setLoadingEvents] = useState(true);

  // Event Data State
  const [attendees, setAttendees] = useState<AttendeeRecord[]>([]);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Create / Edit Event Modal
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [formName, setFormName] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formTicketTypes, setFormTicketTypes] = useState<string[]>(['General Admission', 'VIP']);
  const [newTicketInput, setNewTicketInput] = useState('');
  const [formSessions, setFormSessions] = useState<string[]>(['Morning Keynote', 'Afternoon Workshop']);
  const [newSessionInput, setNewSessionInput] = useState('');
  const [formCustomFields, setFormCustomFields] = useState<CustomField[]>([]);
  const [formMarketingChannels, setFormMarketingChannels] = useState<string[]>([
    'Instagram',
    'Facebook',
    'LinkedIn',
    'X (Twitter)',
    'Event Website & Press Releases'
  ]);
  const [newChannelInput, setNewChannelInput] = useState('');
  const [savingEvent, setSavingEvent] = useState(false);

  // Photographer Invite Modal / Form
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitingPhotographer, setInvitingPhotographer] = useState(false);
  const [inviteSuccessLink, setInviteSuccessLink] = useState<string | null>(null);

  // Attendee View Filtering & Sorting
  const [attendeeSearch, setAttendeeSearch] = useState('');
  const [attendeeTicketFilter, setAttendeeTicketFilter] = useState('ALL');
  const [attendeeConsentFilter, setAttendeeConsentFilter] = useState('ALL');
  const [attendeeChannelFilter, setAttendeeChannelFilter] = useState('ALL');
  const [attendeeSortField, setAttendeeSortField] = useState<'fullName' | 'email' | 'ticketType' | 'checkedInAt'>('checkedInAt');
  const [attendeeSortOrder, setAttendeeSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedAttendeeId, setExpandedAttendeeId] = useState<string | null>(null);
  const [previewAttendeePhoto, setPreviewAttendeePhoto] = useState<AttendeeRecord | null>(null);

  // Gallery View Filtering & Sorting
  const [gallerySearchAttendee, setGallerySearchAttendee] = useState('');
  const [galleryStatusFilter, setGalleryStatusFilter] = useState<'ALL' | 'processed' | 'flagged'>('ALL');
  const [galleryChannelFilter, setGalleryChannelFilter] = useState('ALL');
  const [gallerySortMode, setGallerySortMode] = useState<
    'newest' | 'oldest' | 'channel-asc' | 'channel-desc' | 'most-channels' | 'most-matched' | 'most-blurred'
  >('newest');
  const [activeLightboxPhoto, setActiveLightboxPhoto] = useState<PhotoRecord | null>(null);

  // QR Code preview modal
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Photo Delete Confirmation Modal State
  const [deleteConfirmPhoto, setDeleteConfirmPhoto] = useState<PhotoRecord | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deletePhotoError, setDeletePhotoError] = useState<string | null>(null);

  // Bulk Photo Delete State
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState({ current: 0, total: 0 });

  // Photographer Remove Confirmation Modal State
  const [photographerToRemove, setPhotographerToRemove] = useState<string | null>(null);
  const [removingPhotographer, setRemovingPhotographer] = useState(false);

  // In-app toast notification state (replaces window.alert)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((current) => (current?.message === message ? null : current));
    }, 4500);
  };

  const [isUnblockingPhotos, setIsUnblockingPhotos] = useState(false);

  const handleUnblockPhotos = async () => {
    if (!selectedEventId) return;
    setIsUnblockingPhotos(true);
    try {
      const count = await eventService.unblockPendingPhotos(selectedEventId);
      await loadDetails(selectedEventId);
      showToast(`Successfully processed and unlocked ${count} photo(s).`, 'success');
    } catch (err: any) {
      showToast('Error unblocking photos: ' + err.message, 'error');
    } finally {
      setIsUnblockingPhotos(false);
    }
  };

  // Load events
  const loadEvents = async () => {
    if (!user) return;
    setLoadingEvents(true);
    try {
      let list = await eventService.listManagerEvents(user.uid);
      if (list.length === 0) {
        // Automatically seed an initial demo event for immediate convenience
        const seeded = await eventService.seedSampleEventIfEmpty(user.uid);
        if (seeded) list = [seeded];
      }
      setEvents(list);
      if (list.length > 0 && !selectedEventId) {
        setSelectedEventId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to list manager events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [user]);

  // In-memory cache for event details (attendees and photos) to avoid redundant Firestore reads
  const eventDetailsCache = useRef<Map<string, { attendees: AttendeeRecord[]; photos: PhotoRecord[]; cachedAt: number }>>(new Map());

  // Load event details (attendees and photos) when selectedEvent changes
  const loadDetails = async (eventId: string, forceRefresh = false) => {
    const cached = eventDetailsCache.current.get(eventId);
    const now = Date.now();
    if (!forceRefresh && cached && (now - cached.cachedAt < 30000)) {
      setAttendees(cached.attendees);
      setPhotos(cached.photos);
      return;
    }

    setLoadingDetails(true);
    try {
      const [attList, phList] = await Promise.all([
        eventService.listEventAttendees(eventId),
        eventService.listEventPhotos(eventId)
      ]);
      setAttendees(attList);
      setPhotos(phList);
      eventDetailsCache.current.set(eventId, {
        attendees: attList,
        photos: phList,
        cachedAt: Date.now()
      });
    } catch (err) {
      console.error('Failed to load event attendees or photos:', err);
    } finally {
      setLoadingDetails(false);
    }
  };

  useEffect(() => {
    if (selectedEventId) {
      loadDetails(selectedEventId);
    } else {
      setAttendees([]);
      setPhotos([]);
    }
  }, [selectedEventId]);

  const activeEvent = useMemo(() => {
    return events.find((e) => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  // Real-time counts
  const counts = useMemo(() => {
    const attendeesCount = attendees.length;
    const photosCount = photos.length;
    const processedCount = photos.filter((p) => p.status === 'processed').length;
    return {
      attendees: attendeesCount,
      photos: photosCount,
      processed: processedCount
    };
  }, [attendees, photos]);

  // Check-In URL
  const checkInUrl = useMemo(() => {
    if (!selectedEventId) return '';
    const origin = window.location.origin;
    return `${origin}/?checkin=${selectedEventId}`;
  }, [selectedEventId]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(checkInUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Open Create Event Modal
  const handleOpenCreateModal = () => {
    setModalMode('create');
    setFormName('');
    setFormDate(new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0]);
    setFormLocation('Metropolitan Hall & Expo');
    setFormTicketTypes(['General Admission', 'VIP Pass', 'Speaker']);
    setFormSessions(['Opening Keynote', 'Tech Masterclass', 'Evening Reception']);
    setFormCustomFields([
      { id: 'organization', label: 'Company / Organization', type: 'text', required: true },
      { id: 'first_time', label: 'First time attendee?', type: 'boolean', required: false }
    ]);
    setFormMarketingChannels([
      'Instagram',
      'Facebook',
      'LinkedIn',
      'X (Twitter)',
      'Event Website & Press Releases'
    ]);
    setNewChannelInput('');
    setIsEventModalOpen(true);
  };

  // Open Edit Event Modal
  const handleOpenEditModal = () => {
    if (!activeEvent) return;
    setModalMode('edit');
    setFormName(activeEvent.name);
    setFormDate(activeEvent.date);
    setFormLocation(activeEvent.location);
    setFormTicketTypes([...activeEvent.ticketTypes]);
    setFormSessions([...activeEvent.sessions]);
    setFormCustomFields([...activeEvent.customFields]);
    setFormMarketingChannels(
      activeEvent.marketingChannels && activeEvent.marketingChannels.length > 0
        ? [...activeEvent.marketingChannels]
        : ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'Event Website & Press Releases']
    );
    setNewChannelInput('');
    setIsEventModalOpen(true);
  };

  // Save Event
  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formName.trim() || !formDate.trim()) return;
    setSavingEvent(true);

    try {
      if (modalMode === 'create') {
        const newId = await eventService.createEvent({
          ownerUid: user.uid,
          name: formName.trim(),
          date: formDate.trim(),
          location: formLocation.trim(),
          ticketTypes: formTicketTypes,
          sessions: formSessions,
          customFields: formCustomFields,
          marketingChannels: formMarketingChannels,
          assignedPhotographers: [],
          photographerEmails: [],
          photographerUids: []
        });
        await loadEvents();
        setSelectedEventId(newId);
      } else if (modalMode === 'edit' && activeEvent) {
        await eventService.updateEvent(activeEvent.id, {
          name: formName.trim(),
          date: formDate.trim(),
          location: formLocation.trim(),
          ticketTypes: formTicketTypes,
          sessions: formSessions,
          customFields: formCustomFields,
          marketingChannels: formMarketingChannels
        });
        await loadEvents();
      }
      setIsEventModalOpen(false);
    } catch (err: any) {
      showToast('Error saving event: ' + err.message, 'error');
    } finally {
      setSavingEvent(false);
    }
  };

  // Assign Photographer
  const handleInvitePhotographer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent || !inviteEmail.trim()) return;
    setInvitingPhotographer(true);

    try {
      const email = inviteEmail.trim().toLowerCase();
      const existing = activeEvent.assignedPhotographers || [];
      if (existing.some((p) => p.email.toLowerCase() === email)) {
        showToast('This photographer is already assigned to this event.', 'error');
        setInvitingPhotographer(false);
        return;
      }

      const updatedPhotographers: AssignedPhotographer[] = [
        ...existing,
        {
          email,
          inviteStatus: 'pending',
          assignedAt: new Date().toISOString()
        }
      ];

      const updatedEmails = Array.from(new Set([...(activeEvent.photographerEmails || []), email]));

      await eventService.updateEvent(activeEvent.id, {
        assignedPhotographers: updatedPhotographers,
        photographerEmails: updatedEmails
      });

      // Construct direct invite link
      const inviteUrl = `${window.location.origin}/?inviteEvent=${activeEvent.id}&inviteEmail=${encodeURIComponent(
        email
      )}&portal=photographer`;
      setInviteSuccessLink(inviteUrl);
      setInviteEmail('');
      await loadEvents();
      showToast('Photographer invited successfully!', 'success');
    } catch (err: any) {
      showToast('Error inviting photographer: ' + err.message, 'error');
    } finally {
      setInvitingPhotographer(false);
    }
  };

  const handleRemovePhotographer = (emailToRemove: string) => {
    setPhotographerToRemove(emailToRemove);
  };

  const confirmRemovePhotographer = async () => {
    if (!activeEvent || !photographerToRemove) return;
    setRemovingPhotographer(true);

    try {
      const emailToRemove = photographerToRemove;
      const updatedPhotographers = (activeEvent.assignedPhotographers || []).filter(
        (p) => p.email.toLowerCase() !== emailToRemove.toLowerCase()
      );
      const updatedEmails = (activeEvent.photographerEmails || []).filter(
        (e) => e.toLowerCase() !== emailToRemove.toLowerCase()
      );

      await eventService.updateEvent(activeEvent.id, {
        assignedPhotographers: updatedPhotographers,
        photographerEmails: updatedEmails
      });
      await loadEvents();
      setPhotographerToRemove(null);
      showToast(`Photographer ${emailToRemove} removed.`, 'info');
    } catch (err: any) {
      showToast('Error removing photographer: ' + err.message, 'error');
    } finally {
      setRemovingPhotographer(false);
    }
  };

  // Export Attendees to CSV
  const handleExportCSV = () => {
    if (!attendees.length || !activeEvent) {
      showToast('No attendees to export.', 'info');
      return;
    }

    const customHeaders = activeEvent.customFields?.map((f) => f.label) || [];
    const headers = [
      'Attendee ID',
      'Full Name',
      'Email',
      'Phone',
      'Ticket Type',
      'Check-In Time',
      'Photo Consent',
      'Allowed Marketing Channels',
      'Dietary / Accessibility',
      'Sessions',
      'Check-in Photo',
      ...customHeaders
    ];

    const rows = attendees.map((a) => {
      const customValues =
        activeEvent.customFields?.map((f) => {
          const val = a.customResponses?.[f.id];
          return typeof val === 'boolean' ? (val ? 'Yes' : 'No') : val || '';
        }) || [];

      return [
        a.id,
        `"${a.fullName.replace(/"/g, '""')}"`,
        `"${a.email.replace(/"/g, '""')}"`,
        `"${a.phone || ''}"`,
        `"${a.ticketType || ''}"`,
        `"${a.checkedInAt || ''}"`,
        a.photoConsentGiven ? 'Yes' : 'No',
        `"${(a.allowedMarketingChannels || []).join('; ') || 'None'}"`,
        `"${(a.dietaryAccessibility || '').replace(/"/g, '""')}"`,
        `"${(a.sessionPreferences || []).join('; ').replace(/"/g, '""')}"`,
        a.checkInPhotoPath ? 'Uploaded' : 'None',
        ...customValues.map((v) => `"${String(v).replace(/"/g, '""')}"`)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${activeEvent.name.replace(/[^a-zA-Z0-9]/g, '_')}_Attendees.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filtered & Sorted Attendees
  const filteredAttendees = useMemo(() => {
    return attendees
      .filter((a) => {
        const q = (attendeeSearch || '').toLowerCase().trim();
        const matchesSearch =
          !q ||
          (a.fullName && a.fullName.toLowerCase().includes(q)) ||
          (a.email && a.email.toLowerCase().includes(q));
        const matchesTicket =
          attendeeTicketFilter === 'ALL' || a.ticketType === attendeeTicketFilter;
        const matchesConsent =
          attendeeConsentFilter === 'ALL' ||
          (attendeeConsentFilter === 'YES' && a.photoConsentGiven) ||
          (attendeeConsentFilter === 'NO' && !a.photoConsentGiven);
        const matchesChannel =
          attendeeChannelFilter === 'ALL' ||
          (attendeeChannelFilter === 'NONE' && (!a.allowedMarketingChannels || a.allowedMarketingChannels.length === 0)) ||
          (a.allowedMarketingChannels && a.allowedMarketingChannels.includes(attendeeChannelFilter));

        return matchesSearch && matchesTicket && matchesConsent && matchesChannel;
      })
      .sort((a, b) => {
        let valA = a[attendeeSortField] || '';
        let valB = b[attendeeSortField] || '';
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return attendeeSortOrder === 'asc' ? -1 : 1;
        if (valA > valB) return attendeeSortOrder === 'asc' ? 1 : -1;
        return 0;
      });
  }, [
    attendees,
    attendeeSearch,
    attendeeTicketFilter,
    attendeeConsentFilter,
    attendeeChannelFilter,
    attendeeSortField,
    attendeeSortOrder
  ]);

  // Pending / Processed Photo & Attendee Partitions
  const pendingPhotos = useMemo(() => photos.filter((p) => p.status === 'pending'), [photos]);
  const processedPhotos = useMemo(() => photos.filter((p) => p.status === 'processed' || p.status === 'flagged'), [photos]);
  const pendingVectorAttendees = useMemo(
    () => attendees.filter((a) => a.checkInPhotoUrl && (!a.photoEmbedding || a.photoEmbedding.length !== 512)),
    [attendees]
  );

  // Filtered & Sorted Photos for Event Manager Portal
  // CRITICAL REQUIREMENT: The manager portal MUST NOT have access to raw_photos that haven't been processed!
  // Only privacy-cleared processed photos (with non-consenting faces redacted) are accessible to the manager.
  const filteredPhotos = useMemo(() => {
    return processedPhotos
      .filter((p) => {
        const gq = (gallerySearchAttendee || '').trim().toLowerCase();
        const matchesAttendee =
          !gq ||
          (p.matchedAttendees &&
            Array.isArray(p.matchedAttendees) &&
            p.matchedAttendees.some((name) => typeof name === 'string' && name.toLowerCase().includes(gq)));

        // Filter by processed / flagged status
        const matchesStatus =
          galleryStatusFilter === 'ALL' || p.status === galleryStatusFilter;

        // Filter by marketing channel
        const matchesChannel =
          galleryChannelFilter === 'ALL' ||
          (galleryChannelFilter === 'ANY_CLEARED' && (p.allowedMarketingChannels && p.allowedMarketingChannels.length > 0)) ||
          (p.allowedMarketingChannels && p.allowedMarketingChannels.includes(galleryChannelFilter));

        return matchesAttendee && matchesStatus && matchesChannel;
      })
      .sort((a, b) => {
        // Sort by Marketing Channel A-Z or Z-A
        if (gallerySortMode === 'channel-asc' || gallerySortMode === 'channel-desc') {
          const chanA = (a.allowedMarketingChannels?.[0] || 'ZZZ').toLowerCase();
          const chanB = (b.allowedMarketingChannels?.[0] || 'ZZZ').toLowerCase();
          if (chanA < chanB) return gallerySortMode === 'channel-asc' ? -1 : 1;
          if (chanA > chanB) return gallerySortMode === 'channel-asc' ? 1 : -1;
          return 0;
        }

        // Sort by number of cleared marketing channels
        if (gallerySortMode === 'most-channels') {
          const countA = a.allowedMarketingChannels?.length || 0;
          const countB = b.allowedMarketingChannels?.length || 0;
          return countB - countA;
        }

        // Sort by number of matched attendees
        if (gallerySortMode === 'most-matched') {
          const countA = a.matchedAttendees?.length || 0;
          const countB = b.matchedAttendees?.length || 0;
          return countB - countA;
        }

        // Sort by number of blurred bystander faces (redactions)
        if (gallerySortMode === 'most-blurred') {
          const countA = a.blurredFaceCount || 0;
          const countB = b.blurredFaceCount || 0;
          return countB - countA;
        }

        // Default chronological sorting (processed timestamp or uploaded timestamp)
        const dateA = a.processedAt ? new Date(a.processedAt).getTime() : a.uploadedAt ? new Date(a.uploadedAt).getTime() : 0;
        const dateB = b.processedAt ? new Date(b.processedAt).getTime() : b.uploadedAt ? new Date(b.uploadedAt).getTime() : 0;
        return gallerySortMode === 'oldest' ? dateA - dateB : dateB - dateA;
      });
  }, [processedPhotos, gallerySearchAttendee, galleryStatusFilter, galleryChannelFilter, gallerySortMode]);

  // Photo actions
  const handleTogglePhotoFlag = async (photo: PhotoRecord) => {
    if (!activeEvent) return;
    const nextStatus = photo.status === 'flagged' ? 'processed' : 'flagged';
    try {
      await eventService.updatePhotoStatus(activeEvent.id, photo.id, nextStatus);
      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, status: nextStatus } : p))
      );
      if (activeLightboxPhoto?.id === photo.id) {
        setActiveLightboxPhoto({ ...activeLightboxPhoto, status: nextStatus });
      }
    } catch (err: any) {
      showToast('Error updating status: ' + err.message, 'error');
    }
  };

  const handleDeletePhoto = (photo: PhotoRecord) => {
    setDeletePhotoError(null);
    setDeleteConfirmPhoto(photo);
  };

  const confirmDeletePhoto = async () => {
    if (!activeEvent || !deleteConfirmPhoto) return;
    const targetId = deleteConfirmPhoto.id;
    const targetName = deleteConfirmPhoto.fileName;
    setDeletingPhotoId(targetId);
    setDeletePhotoError(null);
    try {
      await eventService.deletePhoto(
        activeEvent.id,
        targetId,
        [deleteConfirmPhoto.storagePath, deleteConfirmPhoto.clearedStoragePath, deleteConfirmPhoto.rawStoragePath]
      );
      setPhotos((prev) => prev.filter((p) => p.id !== targetId));
      setSelectedPhotoIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
      if (activeLightboxPhoto?.id === targetId) {
        setActiveLightboxPhoto(null);
      }
      setDeleteConfirmPhoto(null);
      showToast(`Photo "${targetName}" was successfully deleted.`, 'success');
    } catch (err: any) {
      console.error('Error deleting photo:', err);
      let msg = err.message || 'Error deleting photo';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) msg = parsed.error;
      } catch (e) {}
      setDeletePhotoError(msg);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  // Bulk Selection Handlers
  const togglePhotoSelection = (photoId: string) => {
    setSelectedPhotoIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handleSelectAllPhotos = () => {
    if (selectedPhotoIds.size === filteredPhotos.length) {
      setSelectedPhotoIds(new Set());
    } else {
      setSelectedPhotoIds(new Set(filteredPhotos.map((p) => p.id)));
    }
  };

  const handleClearSelection = () => {
    setSelectedPhotoIds(new Set());
  };

  const confirmBulkDeletePhotos = async () => {
    if (!activeEvent || selectedPhotoIds.size === 0) return;
    setIsBulkDeleting(true);
    setBulkDeleteProgress({ current: 0, total: selectedPhotoIds.size });

    const targetList = photos.filter((p) => selectedPhotoIds.has(p.id));
    try {
      const res = await eventService.deletePhotosBulk(
        activeEvent.id,
        targetList,
        (current, total) => {
          setBulkDeleteProgress({ current, total });
        }
      );
      const deletedIds = new Set(targetList.map((p) => p.id));
      setPhotos((prev) => prev.filter((p) => !deletedIds.has(p.id)));
      if (activeLightboxPhoto && deletedIds.has(activeLightboxPhoto.id)) {
        setActiveLightboxPhoto(null);
      }
      setSelectedPhotoIds(new Set());
      setShowBulkDeleteModal(false);
      showToast(`Successfully deleted ${res.successful} photo(s).`, 'success');
    } catch (err: any) {
      showToast(`Bulk delete notice: ${err.message}`, 'error');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Top Banner */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              L
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Event Manager Portal</h1>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold tracking-wide uppercase border border-emerald-200">
                  Manager Access
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Logged in as <span className="font-semibold text-slate-700">{user?.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Create Event Button */}

            <button
              onClick={handleOpenCreateModal}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Event
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Events Selector Header Bar */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 overflow-x-auto max-w-full pb-1 sm:pb-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
              Your Events ({events.length}):
            </span>
            {events.map((evt) => (
              <button
                key={evt.id}
                onClick={() => {
                  setSelectedEventId(evt.id);
                  setActiveTab('overview');
                }}
                className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-2 ${
                  evt.id === selectedEventId
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <span>{evt.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${evt.id === selectedEventId ? 'bg-slate-700 text-slate-200' : 'bg-slate-200 text-slate-600'}`}>
                  {evt.date}
                </span>
              </button>
            ))}
          </div>

          {activeEvent && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenEditModal}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg transition flex items-center gap-1.5"
              >
                <Edit3 className="w-3.5 h-3.5 text-slate-500" />
                Configure
              </button>
              <button
                onClick={() => onOpenCheckIn(activeEvent.id)}
                className="px-3 py-1.5 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg transition flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Preview Check-In Page
              </button>
            </div>
          )}
        </div>

        {activeEvent ? (
          <>
            {/* Event Summary Dashboard Header with Counts */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-1 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                <div className="text-xs uppercase font-bold tracking-wider text-slate-400 mb-1">
                  Active Event
                </div>
                <h2 className="text-lg font-bold text-slate-900 truncate" title={activeEvent.name}>
                  {activeEvent.name}
                </h2>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-2">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    {activeEvent.date}
                  </span>
                  {activeEvent.location && (
                    <span className="flex items-center gap-1 truncate max-w-[150px]">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      {activeEvent.location}
                    </span>
                  )}
                </div>
              </div>

              {/* Count: Attendees Checked In */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase font-bold tracking-wider text-slate-400">
                    Attendees Checked In
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {counts.attendees}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {attendees.filter((a) => a.photoConsentGiven).length} opted in to photos
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Users className="w-6 h-6" />
                </div>
              </div>

              {/* Count: Photos Uploaded */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase font-bold tracking-wider text-slate-400">
                    Photos Uploaded
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {counts.photos}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    By assigned photographers
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <ImageIcon className="w-6 h-6" />
                </div>
              </div>

              {/* Count: Photos Processed */}
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase font-bold tracking-wider text-slate-400">
                    Photos Processed
                  </div>
                  <div className="text-2xl font-black text-slate-900 mt-1">
                    {counts.processed}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Matched or reviewed
                  </div>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              </div>
            </div>

            {/* Check-In Link Quick Share Box */}
            <div className="bg-gradient-to-r from-indigo-900 to-slate-900 text-white rounded-2xl p-5 sm:p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 text-xs font-semibold uppercase tracking-wider mb-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Public Check-In Link
                </div>
                <h3 className="text-base font-bold text-white">Attendee Kiosk / Mobile Check-In URL</h3>
                <p className="text-xs text-indigo-200 max-w-xl mt-0.5 font-mono truncate">
                  {checkInUrl}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyLink}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition flex items-center gap-1.5 backdrop-blur-xs cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedLink ? 'Copied to Clipboard!' : 'Copy Link'}
                </button>
                <button
                  onClick={() => setShowQrModal(true)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition flex items-center gap-1.5 backdrop-blur-xs cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  Show QR
                </button>
                <button
                  onClick={() => onOpenCheckIn(activeEvent.id)}
                  className="px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open Live Form
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center justify-between border-b border-slate-200 flex-wrap gap-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`py-3 px-5 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-2 ${
                    activeTab === 'overview'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Overview & Photographers
                </button>
                <button
                  onClick={() => setActiveTab('attendees')}
                  className={`py-3 px-5 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-2 ${
                    activeTab === 'attendees'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>Attendees ({attendees.length})</span>
                </button>
                <button
                  onClick={() => setActiveTab('gallery')}
                  className={`py-3 px-5 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-2 ${
                    activeTab === 'gallery'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>Photo Gallery ({photos.length})</span>
                </button>
              </div>

              <button
                onClick={() => selectedEventId && loadDetails(selectedEventId, true)}
                disabled={loadingDetails}
                className="py-1.5 px-3 mb-1 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                title="Refresh Event Attendees & Photos"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingDetails ? 'animate-spin text-indigo-600' : ''}`} />
                <span>Refresh Data</span>
              </button>
            </div>

            {/* TAB 1: OVERVIEW & PHOTOGRAPHERS */}
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Event Configuration Summary */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                      Event Configuration
                    </h3>

                    <div>
                      <div className="text-xs text-slate-400 font-medium">Ticket Tiers</div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {activeEvent.ticketTypes?.map((t) => (
                          <span
                            key={t}
                            className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-400 font-medium">Breakout Sessions</div>
                      <div className="space-y-1.5 mt-1.5">
                        {activeEvent.sessions?.map((s) => (
                          <div
                            key={s}
                            className="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-700 text-xs border border-slate-200/80"
                          >
                            {s}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-400 font-medium">
                        Custom Check-In Fields ({activeEvent.customFields?.length || 0}/5)
                      </div>
                      <div className="space-y-1.5 mt-1.5">
                        {activeEvent.customFields?.map((f) => (
                          <div
                            key={f.id}
                            className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                          >
                            <span className="font-medium text-slate-700">{f.label}</span>
                            <span className="text-[10px] uppercase font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded">
                              {f.type}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-slate-400 font-medium">Marketing & Publication Channels</div>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {(activeEvent.marketingChannels && activeEvent.marketingChannels.length > 0
                          ? activeEvent.marketingChannels
                          : ['Instagram', 'Facebook', 'LinkedIn', 'X (Twitter)', 'Event Website & Press Releases']
                        ).map((c) => (
                          <span
                            key={c}
                            className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 text-[11px] font-medium border border-emerald-100"
                          >
                            ✓ {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Photographer Management */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                    <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          Assigned Photographers
                        </h3>
                        <p className="text-xs text-slate-500">
                          Invite photographers by email. The system generates an invite link that assigns them upon login.
                        </p>
                      </div>
                    </div>

                    {/* Invite Form */}
                    <form onSubmit={handleInvitePhotographer} className="flex gap-2 mb-6">
                      <div className="relative flex-1">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                        <input
                          type="email"
                          required
                          placeholder="photographer.email@domain.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={invitingPhotographer}
                        className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        {invitingPhotographer ? 'Sending...' : 'Invite Photographer'}
                      </button>
                    </form>

                    {/* Invite link generated feedback */}
                    {inviteSuccessLink && (
                      <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-2">
                        <div className="font-semibold flex items-center gap-1.5 text-emerald-800">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          Photographer Invitation Ready!
                        </div>
                        <p>Share this direct assignment link with the photographer:</p>
                        <div className="p-2 bg-white rounded-lg border border-emerald-200 font-mono text-[11px] text-slate-700 break-all select-all flex items-center justify-between gap-2">
                          <span className="truncate">{inviteSuccessLink}</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(inviteSuccessLink);
                              showToast('Invite link copied to clipboard!', 'success');
                            }}
                            className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded text-[10px] font-semibold flex-shrink-0"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Assigned List */}
                    <div className="space-y-2.5">
                      {(!activeEvent.assignedPhotographers ||
                        activeEvent.assignedPhotographers.length === 0) ? (
                        <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                          No photographers currently assigned. Use the form above to add photographers.
                        </div>
                      ) : (
                        activeEvent.assignedPhotographers.map((p) => (
                          <div
                            key={p.email}
                            className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
                                {p.email.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold text-slate-800">{p.email}</div>
                                <div className="text-[11px] text-slate-400">
                                  {p.assignedAt ? `Assigned ${new Date(p.assignedAt).toLocaleDateString()}` : 'Assigned to event'}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                  p.inviteStatus === 'active'
                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border border-amber-200'
                                }`}
                              >
                                {p.inviteStatus}
                              </span>

                              <button
                                onClick={() => handleRemovePhotographer(p.email)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                                title="Remove Photographer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ATTENDEE VIEW */}
            {activeTab === 'attendees' && (
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-5">
                {/* Header Controls & Filters */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
                    {/* Search */}
                    <div className="relative min-w-[200px]">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Search attendee by name or email..."
                        value={attendeeSearch}
                        onChange={(e) => setAttendeeSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>

                    {/* Filter Ticket */}
                    <select
                      value={attendeeTicketFilter}
                      onChange={(e) => setAttendeeTicketFilter(e.target.value)}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="ALL">All Ticket Tiers</option>
                      {activeEvent.ticketTypes?.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    {/* Filter Photo Consent */}
                    <select
                      value={attendeeConsentFilter}
                      onChange={(e) => setAttendeeConsentFilter(e.target.value)}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="ALL">All Consent Statuses</option>
                      <option value="YES">Photo Consent: Yes</option>
                      <option value="NO">Photo Consent: No</option>
                    </select>

                    {/* Filter Marketing Channel */}
                    <select
                      value={attendeeChannelFilter}
                      onChange={(e) => setAttendeeChannelFilter(e.target.value)}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="ALL">All Marketing Permissions</option>
                      <option value="NONE">No Public Marketing (Excluded)</option>
                      {(activeEvent.marketingChannels || [
                        'Instagram',
                        'Facebook',
                        'LinkedIn',
                        'X (Twitter)',
                        'Event Website & Press Releases'
                      ]).map((c) => (
                        <option key={c} value={c}>
                          Allows: {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleExportCSV}
                      className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-xl transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export to CSV
                    </button>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                        <th
                          className="py-3 px-4 cursor-pointer hover:text-slate-900"
                          onClick={() => {
                            setAttendeeSortField('fullName');
                            setAttendeeSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                          }}
                        >
                          <div className="flex items-center gap-1">
                            Name <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          </div>
                        </th>
                        <th
                          className="py-3 px-4 cursor-pointer hover:text-slate-900"
                          onClick={() => {
                            setAttendeeSortField('email');
                            setAttendeeSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                          }}
                        >
                          <div className="flex items-center gap-1">
                            Email <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          </div>
                        </th>
                        <th
                          className="py-3 px-4 cursor-pointer hover:text-slate-900"
                          onClick={() => {
                            setAttendeeSortField('ticketType');
                            setAttendeeSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                          }}
                        >
                          <div className="flex items-center gap-1">
                            Ticket Tier <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          </div>
                        </th>
                        <th
                          className="py-3 px-4 cursor-pointer hover:text-slate-900"
                          onClick={() => {
                            setAttendeeSortField('checkedInAt');
                            setAttendeeSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
                          }}
                        >
                          <div className="flex items-center gap-1">
                            Check-In Time <ArrowUpDown className="w-3 h-3 text-slate-400" />
                          </div>
                        </th>
                        <th className="py-3 px-4">Photo Consent</th>
                        <th className="py-3 px-4">Allowed Marketing Channels</th>
                        <th className="py-3 px-4">Check-In Photo</th>
                        <th className="py-3 px-4 text-right">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">
                      {filteredAttendees.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-400">
                            No checked-in attendees match your criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredAttendees.map((att) => {
                          const isExpanded = expandedAttendeeId === att.id;
                          return (
                            <React.Fragment key={att.id}>
                              <tr className="hover:bg-slate-50/70 transition">
                                <td className="py-3.5 px-4 font-semibold text-slate-900">
                                  {att.fullName}
                                </td>
                                <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                                  {att.email}
                                </td>
                                <td className="py-3.5 px-4">
                                  {att.ticketType ? (
                                    <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
                                      {att.ticketType}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-slate-500 whitespace-nowrap">
                                  {att.checkedInAt
                                    ? new Date(att.checkedInAt).toLocaleTimeString([], {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      }) +
                                      ' · ' +
                                      new Date(att.checkedInAt).toLocaleDateString()
                                    : '—'}
                                </td>
                                <td className="py-3.5 px-4">
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                      att.photoConsentGiven
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : 'bg-slate-100 text-slate-500'
                                    }`}
                                  >
                                    {att.photoConsentGiven ? 'Yes' : 'No'}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4">
                                  {att.allowedMarketingChannels && att.allowedMarketingChannels.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 max-w-[190px]">
                                      {att.allowedMarketingChannels.map((c) => (
                                        <span
                                          key={c}
                                          className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200"
                                          title={`Allowed on ${c}`}
                                        >
                                          {c.includes('(') ? c.split('(')[0].trim() : c}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-[10px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                      None (Excluded)
                                    </span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4">
                                  {att.checkInPhotoPath || att.checkInPhotoUrl ? (
                                    <button
                                      onClick={() => setPreviewAttendeePhoto(att)}
                                      className="flex items-center gap-1.5 text-indigo-600 hover:text-indigo-800 font-medium"
                                    >
                                      <div className="w-6 h-6 rounded-full overflow-hidden bg-slate-200 border border-slate-300">
                                        <img
                                          src={att.checkInPhotoUrl || att.checkInPhotoPath!}
                                          alt="Selfie"
                                          className="w-full h-full object-cover"
                                          onError={(e) => {
                                            (e.currentTarget as HTMLElement).style.display = 'none';
                                          }}
                                        />
                                      </div>
                                      <span>View</span>
                                    </button>
                                  ) : (
                                    <span className="text-slate-400">None</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-4 text-right">
                                  <button
                                    onClick={() =>
                                      setExpandedAttendeeId(isExpanded ? null : att.id)
                                    }
                                    className="p-1 rounded hover:bg-slate-200 text-slate-500 transition"
                                  >
                                    {isExpanded ? (
                                      <ChevronDown className="w-4 h-4" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    )}
                                  </button>
                                </td>
                              </tr>

                              {/* Expandable row showing full preferences */}
                              {isExpanded && (
                                <tr className="bg-slate-50/50">
                                  <td colSpan={8} className="p-4 border-t border-slate-100">
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                                      <div>
                                        <span className="font-semibold text-slate-600 block mb-1">
                                          Contact & Preferences
                                        </span>
                                        <p className="text-slate-500">
                                          Phone: {att.phone || 'Not provided'}
                                        </p>
                                        <p className="text-slate-500 mt-1">
                                          Dietary/Access: {att.dietaryAccessibility || 'None specified'}
                                        </p>
                                      </div>

                                      <div>
                                        <span className="font-semibold text-slate-600 block mb-1">
                                          Selected Sessions
                                        </span>
                                        {att.sessionPreferences?.length ? (
                                          <ul className="list-disc list-inside text-slate-500 space-y-0.5">
                                            {att.sessionPreferences.map((s) => (
                                              <li key={s}>{s}</li>
                                            ))}
                                          </ul>
                                        ) : (
                                          <p className="text-slate-400">None selected</p>
                                        )}
                                      </div>

                                      <div>
                                        <span className="font-semibold text-slate-600 block mb-1">
                                          Custom Field Responses
                                        </span>
                                        {activeEvent.customFields?.length ? (
                                          <div className="space-y-1 text-slate-500">
                                            {activeEvent.customFields.map((f) => {
                                              const resp = att.customResponses?.[f.id];
                                              return (
                                                <div key={f.id} className="flex justify-between">
                                                  <span>{f.label}:</span>
                                                  <span className="font-medium text-slate-800">
                                                    {typeof resp === 'boolean'
                                                      ? resp
                                                        ? 'Yes'
                                                        : 'No'
                                                      : resp || '—'}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <p className="text-slate-400">No custom fields</p>
                                        )}
                                      </div>

                                      <div>
                                        <span className="font-semibold text-slate-600 block mb-1">
                                          Marketing Publication Rights
                                        </span>
                                        {att.allowedMarketingChannels?.length ? (
                                          <div className="space-y-1">
                                            <span className="text-[11px] text-emerald-800 font-semibold block">
                                              Permitted on ({att.allowedMarketingChannels.length}):
                                            </span>
                                            <p className="text-slate-600 text-[11px]">
                                              {att.allowedMarketingChannels.join(', ')}
                                            </p>
                                          </div>
                                        ) : (
                                          <p className="text-amber-800 font-medium text-[11px]">
                                            Withheld from all public marketing channels.
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB 3: PHOTO GALLERY VIEW */}
            {activeTab === 'gallery' && (
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-6">
                {/* Quarantine Security Notice for Raw Unprocessed Photos */}
                {pendingPhotos.length > 0 && (
                  <div className="p-4.5 rounded-2xl bg-amber-50/90 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
                    <div className="flex items-center gap-3 min-w-[280px]">
                      <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 text-amber-800">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-amber-950 flex items-center gap-1.5">
                          Privacy Access Control: {pendingPhotos.length} Raw Photo(s) Quarantined
                        </div>
                        <p className="text-[11px] text-amber-800 mt-0.5 max-w-2xl">
                          Raw photos are held in quarantine and restricted from Event Manager access to prevent exposure of non-consenting faces. They are processed asynchronously by the backend Cloud Run pipeline to detect consented attendees, blur bystanders, and unlock privacy-cleared photos.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => selectedEventId && loadDetails(selectedEventId)}
                        disabled={loadingDetails}
                        className="px-3 py-1.5 bg-white border border-amber-300 text-amber-900 rounded-xl font-medium hover:bg-amber-100/50 transition flex items-center gap-1.5 shadow-xs text-xs cursor-pointer"
                        title="Reload latest photo statuses from Firestore"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loadingDetails ? 'animate-spin' : ''}`} />
                        <span>Refresh Status</span>
                      </button>
                      <button
                        onClick={handleUnblockPhotos}
                        disabled={isUnblockingPhotos}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition flex items-center gap-1.5 shadow-xs text-xs cursor-pointer disabled:opacity-50"
                        title="Synchronize and unblock privacy-cleared photos now"
                      >
                        <Sparkles className={`w-3.5 h-3.5 ${isUnblockingPhotos ? 'animate-spin' : ''}`} />
                        <span>{isUnblockingPhotos ? 'Processing...' : 'Process & Unblock Photos'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Filter & Sort Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
                    {/* Search by Matched Attendee Name */}
                    <div className="relative min-w-[200px]">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Filter by attendee name..."
                        value={gallerySearchAttendee}
                        onChange={(e) => setGallerySearchAttendee(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>

                    {/* Filter Status (Processed vs Flagged only - raw photos are inaccessible) */}
                    <select
                      value={galleryStatusFilter}
                      onChange={(e) => setGalleryStatusFilter(e.target.value as any)}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      <option value="ALL">All Processed ({processedPhotos.length})</option>
                      <option value="processed">
                        Cleared ({processedPhotos.filter((p) => p.status === 'processed').length})
                      </option>
                      <option value="flagged">
                        Flagged ({processedPhotos.filter((p) => p.status === 'flagged').length})
                      </option>
                    </select>

                    {/* Filter by Marketing Channel */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Channel:</span>
                      <select
                        value={galleryChannelFilter}
                        onChange={(e) => setGalleryChannelFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="ALL">All Channels</option>
                        <option value="ANY_CLEARED">Any Cleared Channel</option>
                        {(activeEvent.marketingChannels || [
                          'Instagram',
                          'Facebook',
                          'LinkedIn',
                          'X (Twitter)',
                          'Event Website & Press Releases'
                        ]).map((c) => (
                          <option key={c} value={c}>
                            Allows: {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Option to Sort by Marketing Channel & Attributes */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sort:</span>
                      <select
                        value={gallerySortMode}
                        onChange={(e) => setGallerySortMode(e.target.value as any)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                      >
                        <option value="newest">Newest Processed</option>
                        <option value="oldest">Oldest Processed</option>
                        <option value="channel-asc">Marketing Channel (A → Z)</option>
                        <option value="channel-desc">Marketing Channel (Z → A)</option>
                        <option value="most-channels">Most Channels Cleared</option>
                        <option value="most-matched">Most Tagged Attendees</option>
                        <option value="most-blurred">Most Blurred Bystanders</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleSelectAllPhotos}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer py-1 px-2.5 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition"
                    >
                      {selectedPhotoIds.size === filteredPhotos.length && filteredPhotos.length > 0
                        ? 'Deselect All'
                        : `Select All (${filteredPhotos.length})`}
                    </button>

                    {selectedPhotoIds.size > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowBulkDeleteModal(true)}
                          className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Selected ({selectedPhotoIds.size})</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClearSelection}
                          className="text-xs text-slate-500 hover:text-slate-800 font-medium py-1 px-2 cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    )}

                    <div className="text-xs text-slate-500 font-medium ml-auto">
                      Showing {filteredPhotos.length} processed photo(s)
                      {pendingPhotos.length > 0 && ` · (${pendingPhotos.length} quarantined raw)`}
                    </div>
                  </div>
                </div>

                {/* Photos Grid */}
                {filteredPhotos.length === 0 ? (
                  <div className="py-16 text-center border border-dashed border-slate-200 rounded-2xl">
                    <ImageIcon className="w-12 h-12 text-slate-300 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-slate-700">No processed photos match your filter</p>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      {pendingPhotos.length > 0
                        ? `${pendingPhotos.length} raw photo(s) are currently quarantined, waiting for the Cloud Run background pipeline to process them.`
                        : 'Photographers can upload photos, which are automatically processed by the Cloud Run pipeline.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {filteredPhotos.map((photo) => {
                      const isSelected = selectedPhotoIds.has(photo.id);
                      return (
                        <div
                          key={photo.id}
                          className={`group relative bg-slate-50 rounded-2xl overflow-hidden border transition flex flex-col cursor-pointer ${
                            isSelected
                              ? 'border-indigo-500 ring-2 ring-indigo-500/80 shadow-md bg-indigo-50/20'
                              : 'border-slate-200/80 shadow-xs hover:shadow-md'
                          }`}
                          onClick={() => setActiveLightboxPhoto(photo)}
                        >
                          {/* Thumbnail: ALWAYS uses clearedDownloadUrl to guarantee raw non-consenting faces are hidden */}
                          <div className="relative aspect-video bg-slate-900 overflow-hidden">
                            <img
                              src={photo.clearedDownloadUrl || photo.downloadUrl}
                              alt={photo.fileName}
                              loading="lazy"
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                            />

                            {/* Selection Checkbox */}
                            <div
                              className="absolute top-2 left-2 z-10"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePhotoSelection(photo.id);
                              }}
                            >
                              <div
                                className={`w-6 h-6 rounded-lg flex items-center justify-center cursor-pointer transition shadow-xs ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-black/60 text-white/70 hover:bg-black/80 hover:text-white'
                                }`}
                              >
                                {isSelected ? (
                                  <Check className="w-4 h-4" />
                                ) : (
                                  <div className="w-3.5 h-3.5 rounded border border-white/70" />
                                )}
                              </div>
                            </div>

                            {/* Privacy Badges Overlay */}
                            <div className="absolute top-2 left-10 flex flex-col gap-1">
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                                  photo.status === 'processed'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-rose-600 text-white'
                                }`}
                              >
                                {photo.status === 'processed' ? '✓ Cleared' : photo.status}
                              </span>
                              {photo.hasBlurredFaces && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/75 text-amber-300 border border-amber-400/40">
                                  🛡️ {photo.blurredFaceCount || 1} Blurred
                                </span>
                              )}
                            </div>

                            {/* Quick Actions (Flag & Delete) */}
                            <div
                              className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition z-10"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => handleTogglePhotoFlag(photo)}
                                className={`p-1.5 rounded-lg transition text-white ${
                                  photo.status === 'flagged' ? 'bg-amber-600' : 'bg-black/60 hover:bg-amber-600'
                                }`}
                                title={photo.status === 'flagged' ? 'Unflag photo' : 'Flag photo'}
                              >
                                <AlertTriangle className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeletePhoto(photo)}
                                className="p-1.5 rounded-lg bg-black/60 hover:bg-rose-600 text-white transition"
                                title="Delete photo"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                        {/* Card Info */}
                        <div className="p-3 flex-1 flex flex-col justify-between text-xs space-y-2">
                          <div>
                            <div className="font-semibold text-slate-800 truncate" title={photo.fileName}>
                              {photo.fileName}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5">
                              {photo.processedAt
                                ? `Processed ${new Date(photo.processedAt).toLocaleDateString()}`
                                : photo.uploadedAt
                                ? new Date(photo.uploadedAt).toLocaleDateString()
                                : ''}
                            </div>

                            {/* Allowed Marketing Channels Badges */}
                            {photo.allowedMarketingChannels && photo.allowedMarketingChannels.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {photo.allowedMarketingChannels.map((c) => (
                                  <span
                                    key={c}
                                    className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200/80 text-[9px] font-semibold truncate max-w-[110px]"
                                    title={c}
                                  >
                                    ✓ {c.includes('(') ? c.split('(')[0].trim() : c}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 font-medium truncate max-w-[140px]">
                              {photo.matchedAttendees?.length > 0
                                ? `✓ ${photo.matchedAttendees.join(', ')}`
                                : photo.hasBlurredFaces
                                ? 'Bystanders blurred'
                                : 'Privacy verified'}
                            </span>
                            <span className="text-indigo-600 group-hover:underline">View</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="bg-white rounded-3xl p-12 text-center border border-slate-200 max-w-md mx-auto">
            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-slate-800">No Events Configured</h2>
            <p className="text-xs text-slate-500 mt-1 mb-6">
              Create your first event to start managing check-ins and photographer uploads.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl text-xs transition"
            >
              Create New Event
            </button>
          </div>
        )}
      </main>

      {/* CREATE / EDIT EVENT MODAL */}
      {isEventModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
              <h3 className="text-lg font-bold text-slate-900">
                {modalMode === 'create' ? 'Create New Event' : 'Edit Event Configuration'}
              </h3>
              <button
                onClick={() => setIsEventModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Event Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Design Systems Expo 2026"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Event Date <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Location / Venue
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Center Stage & Online"
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  />
                </div>
              </div>

              {/* Ticket Types Config */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ticket Types / Tiers
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formTicketTypes.map((t, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs rounded-lg flex items-center gap-1.5 border border-indigo-100"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() =>
                          setFormTicketTypes((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="hover:text-rose-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add tier (e.g. Early Bird, Press)"
                    value={newTicketInput}
                    onChange={(e) => setNewTicketInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newTicketInput.trim()) {
                        setFormTicketTypes((prev) => [...prev, newTicketInput.trim()]);
                        setNewTicketInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-medium rounded-xl"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Sessions Config */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Breakout Sessions
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formSessions.map((s, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-slate-100 text-slate-700 text-xs rounded-lg flex items-center gap-1.5 border border-slate-200"
                    >
                      {s}
                      <button
                        type="button"
                        onClick={() => setFormSessions((prev) => prev.filter((_, i) => i !== idx))}
                        className="hover:text-rose-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add session name"
                    value={newSessionInput}
                    onChange={(e) => setNewSessionInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newSessionInput.trim()) {
                        setFormSessions((prev) => [...prev, newSessionInput.trim()]);
                        setNewSessionInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-medium rounded-xl"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Custom Fields (Up to 5) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Custom Check-In Fields ({formCustomFields.length}/5 max)
                  </label>
                  {formCustomFields.length < 5 && (
                    <button
                      type="button"
                      onClick={() => {
                        const newId = 'cf_' + Math.random().toString(36).substring(2, 7);
                        setFormCustomFields((prev) => [
                          ...prev,
                          { id: newId, label: 'New Question', type: 'text' }
                        ]);
                      }}
                      className="text-[11px] text-indigo-600 font-semibold hover:underline"
                    >
                      + Add Custom Question
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {formCustomFields.map((field, idx) => (
                    <div
                      key={field.id}
                      className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-2 text-xs"
                    >
                      <input
                        type="text"
                        value={field.label}
                        onChange={(e) => {
                          const updated = [...formCustomFields];
                          updated[idx].label = e.target.value;
                          setFormCustomFields(updated);
                        }}
                        className="flex-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                      <select
                        value={field.type}
                        onChange={(e) => {
                          const updated = [...formCustomFields];
                          updated[idx].type = e.target.value as 'text' | 'boolean';
                          setFormCustomFields(updated);
                        }}
                        className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs"
                      >
                        <option value="text">Text Input</option>
                        <option value="boolean">Yes/No Toggle</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setFormCustomFields((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="p-1 text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Marketing Channels Config */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Photo Marketing & Publication Channels
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  Channels attendees can explicitly grant or deny consent for during check-in:
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {formMarketingChannels.map((c, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-emerald-50 text-emerald-800 text-xs rounded-lg flex items-center gap-1.5 border border-emerald-200"
                    >
                      {c}
                      <button
                        type="button"
                        onClick={() =>
                          setFormMarketingChannels((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="hover:text-rose-600 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add channel (e.g. YouTube, TikTok, Partner Media)"
                    value={newChannelInput}
                    onChange={(e) => setNewChannelInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newChannelInput.trim()) {
                        setFormMarketingChannels((prev) => [...prev, newChannelInput.trim()]);
                        setNewChannelInput('');
                      }
                    }}
                    className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-medium rounded-xl cursor-pointer"
                  >
                    Add Channel
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsEventModalOpen(false)}
                  className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-xs font-semibold hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEvent}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm"
                >
                  {savingEvent ? 'Saving...' : modalMode === 'create' ? 'Create Event' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QR CODE MODAL */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">Check-In QR Code</h3>
            <p className="text-xs text-slate-500 mb-4">
              Display this on a screen or print it for attendee kiosks.
            </p>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 inline-block mb-4">
              {/* QR Image via public QR server */}
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
                  checkInUrl
                )}`}
                alt="QR Code"
                className="w-48 h-48 mx-auto"
              />
            </div>

            <p className="text-[11px] font-mono text-slate-600 break-all mb-4">
              {checkInUrl}
            </p>

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-semibold transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* PHOTO LIGHTBOX MODAL */}
      {activeLightboxPhoto && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 text-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl border border-slate-800 flex flex-col md:flex-row max-h-[90vh]">
            {/* Image display - always uses cleared/redacted version */}
            <div className="md:w-3/5 bg-black flex flex-col items-center justify-center relative p-2 min-h-[320px]">
              <img
                src={activeLightboxPhoto.clearedDownloadUrl || activeLightboxPhoto.downloadUrl}
                alt={activeLightboxPhoto.fileName}
                className="max-w-full max-h-[75vh] object-contain rounded-lg"
              />
              {activeLightboxPhoto.hasBlurredFaces && (
                <div className="absolute bottom-4 left-4 px-3 py-1 bg-black/80 backdrop-blur-xs rounded-full border border-amber-400/40 text-amber-300 text-xs font-semibold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  <span>{activeLightboxPhoto.blurredFaceCount || 1} bystander face(s) redacted for privacy</span>
                </div>
              )}
            </div>

            {/* Sidebar Details */}
            <div className="md:w-2/5 p-6 flex flex-col justify-between text-xs space-y-4 overflow-y-auto max-h-[90vh]">
              <div>
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      Privacy Cleared Photo
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Task 2 Cleared
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveLightboxPhoto(null)}
                    className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="mt-4 space-y-3.5">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Filename</span>
                    <span className="font-semibold text-slate-200 break-all">
                      {activeLightboxPhoto.fileName}
                    </span>
                  </div>

                  {/* Privacy & Clearance Status */}
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-300 font-semibold flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        Privacy Redaction Status
                      </span>
                      <span className="text-emerald-400 font-semibold">Active</span>
                    </div>
                    <div className="text-[11px] text-slate-400 space-y-1">
                      <div>
                        • Blurred Bystanders:{' '}
                        <span className="text-slate-200 font-semibold">
                          {activeLightboxPhoto.blurredFaceCount || 0} faces
                        </span>
                      </div>
                      <div>
                        • Raw Master Photo:{' '}
                        <span className="text-amber-400/90 font-mono text-[10px]">
                          Locked in restricted path
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Cleared Marketing Publication Channels */}
                  <div>
                    <span className="text-slate-400 block text-[11px] mb-1.5 font-medium">
                      Cleared Marketing Channels ({activeLightboxPhoto.allowedMarketingChannels?.length || 0}):
                    </span>
                    {activeLightboxPhoto.allowedMarketingChannels &&
                    activeLightboxPhoto.allowedMarketingChannels.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {activeLightboxPhoto.allowedMarketingChannels.map((c) => (
                          <span
                            key={c}
                            className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-[11px] font-medium border border-emerald-500/30"
                          >
                            ✓ {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-amber-400 text-[11px]">
                        General event publication clearance.
                      </p>
                    )}
                  </div>

                  {/* Matched Attendees List */}
                  <div>
                    <span className="text-slate-400 block text-[11px] mb-1">
                      Matched Consented Attendees
                    </span>
                    {activeLightboxPhoto.matchedAttendees?.length > 0 ? (
                      <div className="space-y-1.5 mt-1">
                        {activeLightboxPhoto.matchedAttendees.map((name, i) => (
                          <div
                            key={i}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-200 text-xs flex items-center justify-between"
                          >
                            <span className="font-medium">{name}</span>
                            <span className="text-[10px] text-emerald-400 font-semibold">Consented</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 text-[11px]">
                        No specific attendees tagged. Non-consenting bystanders redacted.
                      </p>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">Uploaded By</span>
                    <span className="text-slate-300">
                      {activeLightboxPhoto.uploadedByEmail || activeLightboxPhoto.uploadedBy}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[11px]">Upload Date</span>
                    <span className="text-slate-300">
                      {activeLightboxPhoto.uploadedAt
                        ? new Date(activeLightboxPhoto.uploadedAt).toLocaleString()
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="space-y-2 pt-4 border-t border-slate-800">
                <div className="flex gap-2">
                  <button
                    onClick={() => handleTogglePhotoFlag(activeLightboxPhoto)}
                    className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-medium transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {activeLightboxPhoto.status === 'flagged' ? 'Unflag' : 'Flag Photo'}
                  </button>
                  <button
                    onClick={() => handleDeletePhoto(activeLightboxPhoto)}
                    className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-medium transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}



      {/* ATTENDEE PHOTO PREVIEW MODAL */}
      {previewAttendeePhoto && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 text-center shadow-xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 mb-1">
              Attendee Reference Photo
            </h3>
            <p className="text-xs text-slate-500 mb-4">{previewAttendeePhoto.fullName}</p>
            <div className="w-56 h-56 rounded-2xl overflow-hidden mx-auto bg-slate-100 border-2 border-slate-200 shadow-inner mb-4 flex items-center justify-center">
              {previewAttendeePhoto.checkInPhotoUrl ? (
                <img
                  src={previewAttendeePhoto.checkInPhotoUrl}
                  alt="Attendee Check-In Selfie"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="p-4 text-center text-slate-400">
                  <UserCheck className="w-12 h-12 mx-auto mb-2 text-indigo-400" />
                  <p className="text-xs font-medium text-slate-600">Reference Photo Stored</p>
                  <p className="text-[10px] text-slate-400 mt-1">Available in event storage</p>
                </div>
              )}
            </div>
            {previewAttendeePhoto.checkInPhotoPath && (
              <p className="text-[10px] text-slate-400 font-mono break-all mb-4">
                {previewAttendeePhoto.checkInPhotoPath}
              </p>
            )}
            <button
              onClick={() => setPreviewAttendeePhoto(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-semibold transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* DELETE PHOTO CONFIRMATION MODAL */}
      {deleteConfirmPhoto && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4 shadow-xs">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Delete Photo?</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-slate-800 break-all">{deleteConfirmPhoto.fileName}</strong>?
              This will remove the photo record and all processed privacy images from event storage. This action cannot be undone.
            </p>

            {deletePhotoError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span className="break-all">{deletePhotoError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmPhoto(null);
                  setDeletePhotoError(null);
                }}
                disabled={Boolean(deletingPhotoId)}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeletePhoto}
                disabled={Boolean(deletingPhotoId)}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {deletingPhotoId ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Photo
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK DELETE CONFIRMATION MODAL */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4 shadow-xs">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Bulk Delete {selectedPhotoIds.size} Photo{selectedPhotoIds.size === 1 ? '' : 's'}?
            </h3>
            <p className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">
              Are you sure you want to permanently delete all <strong>{selectedPhotoIds.size}</strong> selected photo records and their corresponding processed images from event storage? This action cannot be undone.
            </p>

            {isBulkDeleting && (
              <div className="mb-4 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
                    Deleting photos...
                  </span>
                  <span>{bulkDeleteProgress.current} / {bulkDeleteProgress.total}</span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-600 h-full transition-all duration-200"
                    style={{
                      width: `${bulkDeleteProgress.total > 0 ? (bulkDeleteProgress.current / bulkDeleteProgress.total) * 100 : 0}%`
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowBulkDeleteModal(false)}
                disabled={isBulkDeleting}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmBulkDeletePhotos}
                disabled={isBulkDeleting}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {isBulkDeleting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete {selectedPhotoIds.size} Photos
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REMOVE PHOTOGRAPHER CONFIRMATION MODAL */}
      {photographerToRemove && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4 shadow-xs">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Remove Photographer?</h3>
            <p className="text-xs text-slate-500 mt-1 mb-5 leading-relaxed">
              Remove <strong className="text-slate-800 break-all">{photographerToRemove}</strong> from this event?
              They will no longer be assigned to upload or view photos for this event.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPhotographerToRemove(null)}
                disabled={removingPhotographer}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmRemovePhotographer}
                disabled={removingPhotographer}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {removingPhotographer ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Removing...
                  </>
                ) : (
                  'Remove'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IN-APP TOAST NOTIFICATION */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-3 duration-200 max-w-md">
          <div
            className={`px-4 py-3 rounded-2xl shadow-xl border flex items-center gap-3 text-xs font-medium ${
              toast.type === 'error'
                ? 'bg-rose-900/95 text-rose-50 border-rose-700/80'
                : toast.type === 'success'
                ? 'bg-slate-900/95 text-emerald-300 border-slate-700/80'
                : 'bg-slate-900/95 text-slate-100 border-slate-700/80'
            }`}
          >
            {toast.type === 'error' ? (
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            )}
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              onClick={() => setToast(null)}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
