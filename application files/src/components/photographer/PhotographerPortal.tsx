import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Trash2,
  Calendar,
  MapPin,
  RefreshCw,
  FolderOpen,
  X,
  FileText,
  ShieldAlert,
  ChevronRight,
  Sparkles,
  Play,
  ShieldCheck
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { eventService } from '../../services/eventService';
import { EventItem, PhotoRecord, PhotoStatus } from '../../types';

interface FileUploadQueueItem {
  id: string;
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  errorMessage?: string;
  result?: PhotoRecord;
}

export const PhotographerPortal: React.FC = () => {
  const { user, profile } = useAuth();
  const [assignedEvents, setAssignedEvents] = useState<EventItem[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<FileUploadQueueItem[]>([]);
  const [deleteConfirmPhoto, setDeleteConfirmPhoto] = useState<PhotoRecord | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  // Upload & processing notification state
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Load photographer assigned events
  const loadEvents = async () => {
    if (!user) return;
    setLoadingEvents(true);
    try {
      const list = await eventService.listPhotographerEvents(user.uid, user.email || undefined);
      setAssignedEvents(list);
      if (list.length > 0 && !selectedEventId) {
        setSelectedEventId(list[0].id);
      }
    } catch (err) {
      console.error('Failed to load photographer events:', err);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    loadEvents();
  }, [user, profile]);

  const photosCacheRef = useRef<Map<string, { photos: PhotoRecord[]; cachedAt: number }>>(new Map());

  // Load photos when event selected
  const loadEventPhotos = async (eventId: string, forceRefresh = false) => {
    const cached = photosCacheRef.current.get(eventId);
    const now = Date.now();
    if (!forceRefresh && cached && (now - cached.cachedAt < 30000)) {
      setPhotos(cached.photos);
      return;
    }

    setLoadingPhotos(true);
    try {
      const list = await eventService.listEventPhotos(eventId);
      setPhotos(list);
      photosCacheRef.current.set(eventId, { photos: list, cachedAt: Date.now() });
    } catch (err) {
      console.error('Failed to load photos:', err);
    } finally {
      setLoadingPhotos(false);
    }
  };

  useEffect(() => {
    if (selectedEventId) {
      loadEventPhotos(selectedEventId);
    } else {
      setPhotos([]);
    }
  }, [selectedEventId]);

  const activeEvent = assignedEvents.find((e) => e.id === selectedEventId);

  // Handle files selected (drag-drop or file picker)
  const handleFiles = async (files: FileList | null) => {
    if (!files || !selectedEventId || !user) return;

    const newItems: FileUploadQueueItem[] = Array.from(files).map((file) => ({
      id: Math.random().toString(36).substring(2, 9),
      file,
      progress: 0,
      status: 'uploading'
    }));

    setUploadQueue((prev) => [...newItems, ...prev]);

    // Process uploads sequentially to prevent browser UI freeze and memory exhaustion
    const completedPhotos: PhotoRecord[] = [];
    for (const item of newItems) {
      const rec = await uploadFileItem(item, selectedEventId);
      if (rec) {
        completedPhotos.push(rec);
      }
    }

    if (completedPhotos.length > 0) {
      setStatusMessage(
        `✓ Upload complete: ${completedPhotos.length} photo(s) securely stored in Cloud Storage. Photos are quarantined pending background Cloud Run privacy redaction.`
      );
      await loadEventPhotos(selectedEventId);
    }
  };

  const uploadFileItem = async (item: FileUploadQueueItem, eventId: string): Promise<PhotoRecord | null> => {
    if (!user) return null;
    try {
      const photoRecord = await eventService.uploadPhotoFile(
        eventId,
        item.file,
        user.uid,
        user.email || undefined,
        (progress) => {
          setUploadQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress } : q))
          );
        }
      );

      setUploadQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, progress: 100, status: 'completed', result: photoRecord } : q))
      );

      // Prepend to photos list
      setPhotos((prev) => [photoRecord, ...prev.filter((p) => p.id !== photoRecord.id)]);
      return photoRecord;
    } catch (err: any) {
      console.error('Upload failed for file:', item.file.name, err);
      setUploadQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'error', errorMessage: err.message || 'Upload failed' } : q))
      );
      return null;
    }
  };

  const [deletePhotoError, setDeletePhotoError] = useState<string | null>(null);

  const handleDeletePhoto = async () => {
    if (!deleteConfirmPhoto || !selectedEventId) return;
    setDeletingPhotoId(deleteConfirmPhoto.id);
    setDeletePhotoError(null);
    try {
      await eventService.deletePhoto(
        selectedEventId,
        deleteConfirmPhoto.id,
        [deleteConfirmPhoto.storagePath, deleteConfirmPhoto.clearedStoragePath, deleteConfirmPhoto.rawStoragePath]
      );
      setPhotos((prev) => prev.filter((p) => p.id !== deleteConfirmPhoto.id));
      setDeleteConfirmPhoto(null);
    } catch (err: any) {
      console.error('Delete error:', err);
      let msg = err.message || 'Could not delete photo';
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) msg = parsed.error;
      } catch (e) {}
      setDeletePhotoError(msg);
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return '';
    try {
      const date = typeof ts === 'string' ? new Date(ts) : ts.toDate ? ts.toDate() : new Date();
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' · ' + date.toLocaleDateString();
    } catch {
      return '';
    }
  };

  const getStatusBadge = (status: PhotoStatus) => {
    switch (status) {
      case 'processed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Processed
          </span>
        );
      case 'flagged':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle className="w-3 h-3" /> Flagged
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3 h-3" /> Pending
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Top Banner */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-700 font-semibold text-xs rounded-full border border-indigo-100">
                Photographer Portal
              </span>
              <span className="text-xs text-slate-400">Authenticated via Firebase</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">Photo Upload & Assignment Hub</h1>
          </div>

          {/* User badge */}
          <div className="flex items-center gap-3">
            <div className="text-right text-xs">
              <div className="font-semibold text-slate-800">{profile?.displayName || user?.displayName || 'Photographer'}</div>
              <div className="text-slate-500">{user?.email}</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-slate-800 text-white font-semibold flex items-center justify-center text-sm shadow-sm">
              {(profile?.displayName || user?.email || 'P').charAt(0).toUpperCase()}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {loadingEvents ? (
          <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-600">Loading your assigned events...</p>
          </div>
        ) : assignedEvents.length === 0 ? (
          <div className="bg-white p-12 rounded-3xl border border-slate-200 text-center max-w-lg mx-auto">
            <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-slate-800">No Assigned Events Yet</h2>
            <p className="text-sm text-slate-500 mt-2 mb-6">
              You are currently logged in as a Photographer, but an Event Manager hasn't assigned you to an event yet.
            </p>
            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-left text-xs text-amber-900 space-y-1">
              <span className="font-semibold">How to get access:</span>
              <p>1. Ask your Event Manager to add your email ({user?.email}) to the event's assigned photographers.</p>
              <p>2. Or click an invite link provided by the manager.</p>
              <p>3. If you are testing, you can switch to the Event Manager portal using the top bar to create and assign an event.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Event Selector Tabs */}
            <div className="flex items-center gap-3 overflow-x-auto pb-2 border-b border-slate-200">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap mr-2">
                Assigned Events ({assignedEvents.length}):
              </span>
              {assignedEvents.map((evt) => {
                const isSelected = evt.id === selectedEventId;
                return (
                  <button
                    key={evt.id}
                    onClick={() => setSelectedEventId(evt.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition cursor-pointer flex items-center gap-2 ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    <span>{evt.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isSelected ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-500'}`}>
                      {evt.date}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeEvent && (
              <>
                {/* Event Overview Card */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{activeEvent.name}</h2>
                    <div className="flex items-center gap-4 text-xs text-slate-500 mt-1">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        {activeEvent.date}
                      </span>
                      {activeEvent.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-slate-400" />
                          {activeEvent.location}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">

                    <div className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-right">
                      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Total Uploads</div>
                      <div className="text-lg font-bold text-slate-800">{photos.length} photos</div>
                    </div>
                    <button
                      onClick={() => activeEvent && loadEventPhotos(activeEvent.id, true)}
                      className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                      title="Refresh Photos"
                    >
                      <RefreshCw className={`w-4 h-4 ${loadingPhotos ? 'animate-spin text-indigo-600' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Upload Status / Pipeline Notice Banner */}
                {statusMessage && (
                  <div className="p-4 rounded-2xl border text-xs flex items-center justify-between gap-3 bg-indigo-50/90 border-indigo-200 text-indigo-900 transition">
                    <div className="flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span className="font-medium">{statusMessage}</span>
                    </div>
                    <button
                      onClick={() => setStatusMessage(null)}
                      className="text-indigo-700 hover:text-indigo-950 p-1 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Bulk Photo Uploader */}
                <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/80 shadow-sm">
                  <div className="mb-4">
                    <h3 className="text-base font-semibold text-slate-900">Bulk Photo Uploader</h3>
                    <p className="text-xs text-slate-500">
                      Upload high-resolution event shots. Supports multiple files simultaneously (JPEG, PNG, HEIC, RAW).
                    </p>
                  </div>

                  {/* Drag and Drop Zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      handleFiles(e.dataTransfer.files);
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-8 sm:p-10 text-center transition cursor-pointer ${
                      dragOver
                        ? 'border-indigo-600 bg-indigo-50/50'
                        : 'border-slate-300 hover:border-slate-400 bg-slate-50/50 hover:bg-slate-50'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept="image/*,.raw,.cr2,.nef,.arw,.heic"
                      className="hidden"
                      onChange={(e) => handleFiles(e.target.files)}
                    />
                    <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-slate-800">
                      Drag & drop photos here, or <span className="text-indigo-600 underline">browse files</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Select multiple photos to upload in batch. Per-file progress tracks in real-time.
                    </p>
                  </div>

                  {/* Upload Progress Queue */}
                  {uploadQueue.length > 0 && (
                    <div className="mt-6 space-y-2.5">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">Upload Activity ({uploadQueue.length})</span>
                        <button
                          onClick={() => setUploadQueue((prev) => prev.filter((q) => q.status === 'uploading'))}
                          className="hover:text-slate-900"
                        >
                          Clear completed
                        </button>
                      </div>

                      <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                        {uploadQueue.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center gap-3 text-xs"
                          >
                            <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center flex-shrink-0 text-slate-500">
                              <ImageIcon className="w-4 h-4" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between font-medium text-slate-800">
                                <span className="truncate">{item.file.name}</span>
                                <span className="text-slate-500 ml-2">{formatFileSize(item.file.size)}</span>
                              </div>

                              {/* Progress bar */}
                              <div className="w-full h-1.5 bg-slate-200 rounded-full mt-1.5 overflow-hidden">
                                <div
                                  className={`h-full transition-all duration-200 ${
                                    item.status === 'error'
                                      ? 'bg-rose-500'
                                      : item.status === 'completed'
                                      ? 'bg-emerald-500'
                                      : 'bg-indigo-600'
                                  }`}
                                  style={{ width: `${item.progress}%` }}
                                />
                              </div>
                            </div>

                            <div className="flex-shrink-0">
                              {item.status === 'uploading' && (
                                <span className="text-[11px] text-indigo-600 font-semibold">{item.progress}%</span>
                              )}
                              {item.status === 'completed' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              )}
                              {item.status === 'error' && (
                                <span title={item.errorMessage} className="inline-flex">
                                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Uploaded Photos Grid */}
                <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/80 shadow-sm">
                  <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Event Gallery</h3>
                      <p className="text-xs text-slate-500">
                        Photos uploaded to this event, sorted most recent first. You can delete your own uploads.
                      </p>
                    </div>
                    <span className="text-xs text-slate-500 font-medium">
                      Showing {photos.length} photos
                    </span>
                  </div>

                  {loadingPhotos ? (
                    <div className="py-12 text-center">
                      <RefreshCw className="w-6 h-6 text-indigo-600 animate-spin mx-auto mb-2" />
                      <p className="text-xs text-slate-500">Loading uploaded photos...</p>
                    </div>
                  ) : photos.length === 0 ? (
                    <div className="py-16 text-center border border-dashed border-slate-200 rounded-2xl">
                      <ImageIcon className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="text-sm font-medium text-slate-700">No photos uploaded for this event yet</p>
                      <p className="text-xs text-slate-400 mt-1">Use the bulk uploader above to add event photos.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                      {photos.map((photo) => {
                        const isOwnUpload = photo.uploadedBy === user?.uid || photo.uploadedByEmail === user?.email;
                        return (
                          <div
                            key={photo.id}
                            className="group relative bg-slate-50 rounded-2xl overflow-hidden border border-slate-200/80 shadow-sm hover:shadow-md transition flex flex-col"
                          >
                            {/* Thumbnail */}
                            <div className="relative aspect-video bg-slate-900 overflow-hidden">
                              <img
                                src={photo.clearedDownloadUrl || photo.downloadUrl}
                                alt={photo.fileName}
                                loading="lazy"
                                className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                              />

                              {/* Status badge overlay */}
                              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                                {getStatusBadge(photo.status)}
                                {photo.hasBlurredFaces && (
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/70 text-amber-300 border border-amber-400/40">
                                    🛡️ {photo.blurredFaceCount || 1} Blurred
                                  </span>
                                )}
                              </div>

                              {/* Delete button (Photographer can delete own upload) */}
                              {isOwnUpload && (
                                <button
                                  onClick={() => setDeleteConfirmPhoto(photo)}
                                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-rose-600 text-white transition opacity-0 group-hover:opacity-100 cursor-pointer"
                                  title="Delete your upload"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            {/* Card Details */}
                            <div className="p-3 flex-1 flex flex-col justify-between text-xs">
                              <div>
                                <div className="font-semibold text-slate-800 truncate" title={photo.fileName}>
                                  {photo.fileName}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {formatTimestamp(photo.uploadedAt)}
                                </div>
                              </div>

                              {/* Tagged info if processed */}
                              <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                                <span className="text-slate-500">
                                  {photo.matchedAttendees?.length > 0
                                    ? `✓ ${photo.matchedAttendees.length} tagged`
                                    : photo.status === 'processed'
                                    ? '✓ Privacy Cleared'
                                    : 'Awaiting Task 2'}
                                </span>
                                {photo.allowedMarketingChannels?.length ? (
                                  <span className="text-emerald-700 font-semibold text-[10px]">
                                    {photo.allowedMarketingChannels.length} channel(s)
                                  </span>
                                ) : (
                                  photo.fileSize && (
                                    <span className="text-slate-400">{formatFileSize(photo.fileSize)}</span>
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal */}
      {deleteConfirmPhoto && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4">
              <Trash2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Delete Photo?</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Are you sure you want to delete <strong>{deleteConfirmPhoto.fileName}</strong>? This action cannot be undone.
            </p>

            {deletePhotoError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {deletePhotoError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setDeleteConfirmPhoto(null);
                  setDeletePhotoError(null);
                }}
                disabled={Boolean(deletingPhotoId)}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeletePhoto}
                disabled={Boolean(deletingPhotoId)}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-medium transition flex items-center justify-center gap-1.5"
              >
                {deletingPhotoId ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
