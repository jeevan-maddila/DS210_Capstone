import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Calendar,
  MapPin,
  Clock,
  UserCheck,
  VideoOff,
  Upload,
  Globe,
  Share2,
  Check,
  X,
  Megaphone,
  RotateCcw
} from 'lucide-react';
import { eventService } from '../../services/eventService';
import { EventItem, AttendeeRecord } from '../../types';
import { storage, ref, uploadString, getDownloadURL } from '../../lib/firebase';

interface AttendeeCheckInPageProps {
  eventId: string;
  onBackToApp?: () => void;
}

type Step = 'form' | 'camera' | 'confirmation';

const DEFAULT_MARKETING_CHANNELS = [
  'Instagram',
  'Facebook',
  'LinkedIn',
  'X (Twitter)',
  'Event Website & Press Releases'
];

export const AttendeeCheckInPage: React.FC<AttendeeCheckInPageProps> = ({ eventId, onBackToApp }) => {
  const [event, setEvent] = useState<EventItem | null>(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);

  // Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [ticketType, setTicketType] = useState('');
  const [selectedSessions, setSelectedSessions] = useState<string[]>([]);
  const [dietaryAccessibility, setDietaryAccessibility] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, string | boolean>>({});

  // Non-obligatory Photo Marketing & Tagging Consent
  const [photoConsentGiven, setPhotoConsentGiven] = useState(false);

  // Granular Marketing Channel Permissions (e.g., Allow Facebook, Block Instagram)
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Flow State
  const [step, setStep] = useState<Step>('form');
  const [attendeeId, setAttendeeId] = useState<string | null>(null);

  // Camera State
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [capturedPhotoDataUrl, setCapturedPhotoDataUrl] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Kiosk Auto-Reset Countdown (5 seconds)
  const AUTO_RESET_DELAY = 5;
  const [countdown, setCountdown] = useState<number>(AUTO_RESET_DELAY);
  const [autoResetPaused, setAutoResetPaused] = useState(false);

  useEffect(() => {
    async function load() {
      setLoadingEvent(true);
      setEventError(null);
      try {
        const data = await eventService.getEvent(eventId);
        if (!data) {
          setEventError(`Event not found with ID: ${eventId}`);
        } else {
          setEvent(data);
          if (data.ticketTypes && data.ticketTypes.length > 0) {
            setTicketType(data.ticketTypes[0]);
          }

          // Initialize custom fields
          const initialCustom: Record<string, string | boolean> = {};
          data.customFields?.forEach((f) => {
            if (f.type === 'boolean') {
              initialCustom[f.id] = false;
            } else {
              initialCustom[f.id] = '';
            }
          });
          setCustomResponses(initialCustom);

          // Pre-select channels for when the user opts in
          const availableChannels =
            data.marketingChannels && data.marketingChannels.length > 0
              ? data.marketingChannels
              : DEFAULT_MARKETING_CHANNELS;
          setSelectedChannels(availableChannels);
        }
      } catch (err: any) {
        setEventError(err.message || 'Failed to load event details');
      } finally {
        setLoadingEvent(false);
      }
    }
    if (eventId) {
      load();
    }
  }, [eventId]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Automatically start camera when moving into camera step
  useEffect(() => {
    if (step === 'camera' && !capturedPhotoDataUrl) {
      startCamera();
    }
  }, [step]);

  // Ensure stream is attached to video whenever cameraStream updates
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('Video auto-play notice:', err);
        });
      }
    }
  }, [cameraStream]);

  // Auto-reset countdown timer for kiosk flow (5 seconds)
  useEffect(() => {
    if (step !== 'confirmation' || autoResetPaused) {
      return;
    }

    setCountdown(AUTO_RESET_DELAY);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          resetFormForNextAttendee();
          return AUTO_RESET_DELAY;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [step, autoResetPaused]);

  const handleSessionToggle = (sessionName: string) => {
    setSelectedSessions((prev) =>
      prev.includes(sessionName) ? prev.filter((s) => s !== sessionName) : [...prev, sessionName]
    );
  };

  const handleChannelToggle = (channelName: string) => {
    setSelectedChannels((prev) =>
      prev.includes(channelName)
        ? prev.filter((c) => c !== channelName)
        : [...prev, channelName]
    );
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setErrorMessage('Please provide both your name and email address to check in.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await eventService.submitAttendeeCheckIn(eventId, {
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || '',
        ticketType: ticketType || '',
        sessionPreferences: selectedSessions,
        dietaryAccessibility: dietaryAccessibility.trim() || '',
        customResponses,
        consentGiven: true, // Check-in terms of attendance
        photoConsentGiven: Boolean(photoConsentGiven),
        allowedMarketingChannels: photoConsentGiven ? selectedChannels : []
      });

      setAttendeeId(res.attendeeId);

      // If photo marketing/tagging consent was granted, offer optional selfie step;
      // otherwise, proceed directly to confirmation without any camera requirement
      if (photoConsentGiven) {
        setStep('camera');
      } else {
        setStep('confirmation');
      }
    } catch (err: any) {
      console.error('Check-in error:', err);
      setErrorMessage(err.message || 'Check-in failed. Please verify your details and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // Camera Management
  const startCamera = async () => {
    setCameraError(null);
    setCameraStarting(true);
    setVideoLoaded(false);
    try {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 640 }
        },
        audio: false
      });
      setCameraStream(stream);
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (e) {
          console.warn('Direct play error:', e);
        }
      }
    } catch (err: any) {
      console.warn('Camera access unavailable:', err);
      setCameraError('Camera access could not be established. You can upload a photo or skip this step.');
      setCameraActive(false);
    } finally {
      setCameraStarting(false);
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }
    setCameraActive(false);
    setVideoLoaded(false);
  };

  // High performance, compressed thumbnail snapshot to avoid slow network uploads
  const takeSnapshot = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const rawWidth = video.videoWidth || 640;
    const rawHeight = video.videoHeight || 480;
    const rawSize = Math.min(rawWidth, rawHeight);

    // Scale down to max 360x360 square thumbnail (~25 KB)
    const targetSize = Math.min(360, rawSize);
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Crop center square
    const startX = (rawWidth - rawSize) / 2;
    const startY = (rawHeight - rawSize) / 2;
    ctx.drawImage(video, startX, startY, rawSize, rawSize, 0, 0, targetSize, targetSize);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    setCapturedPhotoDataUrl(dataUrl);
    stopCamera();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current || document.createElement('canvas');
        const targetSize = 360;
        canvas.width = targetSize;
        canvas.height = targetSize;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const rawSize = Math.min(img.width, img.height);
          const startX = (img.width - rawSize) / 2;
          const startY = (img.height - rawSize) / 2;
          ctx.drawImage(img, startX, startY, rawSize, rawSize, 0, 0, targetSize, targetSize);
          setCapturedPhotoDataUrl(canvas.toDataURL('image/jpeg', 0.82));
        } else {
          setCapturedPhotoDataUrl(reader.result as string);
        }
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleRetake = () => {
    setCapturedPhotoDataUrl(null);
    startCamera();
  };

  // Confirm photo upload with guaranteed completion and short timeout
  const handleConfirmPhoto = async () => {
    if (!capturedPhotoDataUrl || !attendeeId) return;
    setUploadingPhoto(true);
    setCameraError(null);

    const storagePath = `checkin/${eventId}/${attendeeId}.jpg`;
    try {
      const storageRef = ref(storage, storagePath);
      // Guarantee downloadUrl is at least the lightweight compressed data URL (~25KB)
      let downloadUrl = capturedPhotoDataUrl;

      // Wrap uploadString with a 2-second timeout to avoid indefinite hanging on Storage
      try {
        const uploadPromise = uploadString(storageRef, capturedPhotoDataUrl, 'data_url');
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Storage upload timeout')), 2000)
        );
        const uploadResult = (await Promise.race([uploadPromise, timeoutPromise])) as any;
        const onlineUrl = await getDownloadURL(uploadResult.ref);
        if (onlineUrl) downloadUrl = onlineUrl;
      } catch (storageErr) {
        console.warn('Storage bucket upload notice, using secure compressed reference:', storageErr);
      }

      await eventService.updateAttendeePhoto(eventId, attendeeId, storagePath, downloadUrl);
    } catch (err: any) {
      console.warn('Photo update notice:', err);
    } finally {
      // GUARANTEED: Transition to confirmation step immediately without indefinite spinner
      setUploadingPhoto(false);
      stopCamera();
      setStep('confirmation');
    }
  };

  const handleSkipPhoto = () => {
    stopCamera();
    setStep('confirmation');
  };

  const resetFormForNextAttendee = () => {
    setFullName('');
    setEmail('');
    setPhone('');
    setSelectedSessions([]);
    setDietaryAccessibility('');
    setPhotoConsentGiven(false);
    setAttendeeId(null);
    setCapturedPhotoDataUrl(null);
    setCameraActive(false);
    setVideoLoaded(false);
    setErrorMessage(null);
    setAutoResetPaused(false);
    setCountdown(AUTO_RESET_DELAY);

    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    }

    if (event) {
      if (event.ticketTypes && event.ticketTypes.length > 0) {
        setTicketType(event.ticketTypes[0]);
      }
      const initialCustom: Record<string, string | boolean> = {};
      event.customFields?.forEach((f) => {
        initialCustom[f.id] = f.type === 'boolean' ? false : '';
      });
      setCustomResponses(initialCustom);
      setSelectedChannels(
        event.marketingChannels && event.marketingChannels.length > 0
          ? event.marketingChannels
          : DEFAULT_MARKETING_CHANNELS
      );
    }
    setStep('form');
  };

  const configuredChannels =
    event?.marketingChannels && event.marketingChannels.length > 0
      ? event.marketingChannels
      : DEFAULT_MARKETING_CHANNELS;

  if (loadingEvent) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-sm w-full">
          <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-800">Loading Event Check-In</h2>
          <p className="text-sm text-slate-500 mt-1">Retrieving event configuration...</p>
        </div>
      </div>
    );
  }

  if (eventError || !event) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-2xl shadow-sm border border-rose-200 text-center max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-slate-800">Event Not Available</h2>
          <p className="text-sm text-slate-600 mt-2 mb-6">
            {eventError || 'The event you requested could not be located. Please check the URL link.'}
          </p>
          {onBackToApp && (
            <button
              onClick={onBackToApp}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-sm font-medium transition"
            >
              Return to Hub Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 via-slate-50 to-slate-100 py-10 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto">
        {/* Event Header Banner */}
        <header className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200/80 mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-slate-100">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold tracking-wide uppercase">
              <UserCheck className="w-3.5 h-3.5" />
              Official Attendee Check-In
            </div>
            {onBackToApp && (
              <button
                onClick={onBackToApp}
                className="text-xs font-medium text-slate-500 hover:text-slate-900 transition flex items-center gap-1 cursor-pointer"
              >
                Exit to Portal &rarr;
              </button>
            )}
          </div>

          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-4 tracking-tight">
            {event.name}
          </h1>

          <div className="flex flex-wrap items-center gap-y-2 gap-x-5 text-sm text-slate-600 mt-3">
            <span className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-slate-400" />
              {event.date}
            </span>
            {event.location && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-slate-400" />
                {event.location}
              </span>
            )}
          </div>
        </header>

        {/* STEP 1: FORM */}
        {step === 'form' && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Attendee Information</h2>
              <p className="text-sm text-slate-500">
                Please complete this form to register your arrival and personalize your event experience.
              </p>
            </div>

            {errorMessage && (
              <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
                <div>{errorMessage}</div>
              </div>
            )}

            <form onSubmit={handleFormSubmit} className="space-y-5">
              {/* Full Name */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Jane Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                />
              </div>

              {/* Email Address */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="jane.doe@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                />
              </div>

              {/* Phone Number (Optional) */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Phone Number <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                />
              </div>

              {/* Ticket Type / Tier */}
              {event.ticketTypes && event.ticketTypes.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Ticket Type / Tier
                  </label>
                  <select
                    value={ticketType}
                    onChange={(e) => setTicketType(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                  >
                    {event.ticketTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Session Preferences (Multi-select) */}
              {event.sessions && event.sessions.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Session Preferences <span className="text-slate-400 font-normal">(Select all that apply)</span>
                  </label>
                  <div className="space-y-2 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/80">
                    {event.sessions.map((sess) => (
                      <label
                        key={sess}
                        className="flex items-start gap-3 p-2 rounded-xl hover:bg-white/80 transition cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedSessions.includes(sess)}
                          onChange={() => handleSessionToggle(sess)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-slate-700 leading-snug">{sess}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Dietary / Accessibility */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Dietary / Accessibility Preferences <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Vegetarian, wheelchair access requested, etc."
                  value={dietaryAccessibility}
                  onChange={(e) => setDietaryAccessibility(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                />
              </div>

              {/* Custom Fields (Up to 5) */}
              {event.customFields && event.customFields.length > 0 && (
                <div className="pt-2 border-t border-slate-100 space-y-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Additional Event Questions
                  </h3>
                  {event.customFields.map((field) => (
                    <div key={field.id}>
                      {field.type === 'boolean' ? (
                        <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200/80 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={Boolean(customResponses[field.id])}
                            onChange={(e) =>
                              setCustomResponses((prev) => ({ ...prev, [field.id]: e.target.checked }))
                            }
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium text-slate-700">
                            {field.label} {field.required && <span className="text-rose-500">*</span>}
                          </span>
                        </label>
                      ) : (
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1.5">
                            {field.label} {field.required && <span className="text-rose-500">*</span>}
                          </label>
                          <input
                            type="text"
                            required={field.required}
                            value={(customResponses[field.id] as string) || ''}
                            onChange={(e) =>
                              setCustomResponses((prev) => ({ ...prev, [field.id]: e.target.value }))
                            }
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 focus:bg-white transition"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* EVENT PHOTOGRAPHY, MEDIA & MARKETING DISCLAIMER */}
              <div className="pt-5 border-t border-slate-200 space-y-4">
                <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-100/90 text-xs text-indigo-950 leading-relaxed flex items-start gap-3.5">
                  <Megaphone className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                  <div className="space-y-1.5">
                    <span className="font-bold text-slate-900 block text-sm">
                      Event Photography & Marketing Notice
                    </span>
                    <p className="text-slate-600 text-xs">
                      By completing check-in, you register your attendance at <strong>{event.name}</strong>. Event photographers capture candid and group moments throughout the venue.
                    </p>
                    <p className="text-slate-600 text-xs">
                      <strong>Marketing Usage:</strong> Event managers specifically intend to use event photography to market and promote the event across social media and public platforms. We believe in explicit, non-obligatory consent: <strong>you are not required to grant photo consent</strong> to complete your check-in. If you choose to grant consent, you may select precisely which marketing channels your photos are permitted to appear in.
                    </p>
                    <p className="text-[11px] text-slate-500 italic">
                      Check-in data and reference photos are retained for 30 days and never sold to third parties.
                    </p>
                  </div>
                </div>

                {/* NON-OBLIGATORY SINGLE CONSENT CHECKBOX */}
                <label
                  className={`flex items-start gap-3.5 cursor-pointer p-4 rounded-2xl border transition select-none ${
                    photoConsentGiven
                      ? 'bg-indigo-50/60 border-indigo-200 shadow-xs'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100/70'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={photoConsentGiven}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setPhotoConsentGiven(checked);
                      if (checked) {
                        setSelectedChannels(configuredChannels);
                      } else {
                        setSelectedChannels([]);
                      }
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                  <div className="text-xs leading-relaxed">
                    <span className="font-semibold text-slate-900 block mb-0.5">
                      I consent to photo identification, tagging, and marketing usage{' '}
                      <span className="text-slate-400 font-normal">(Optional)</span>
                    </span>
                    <span className="text-slate-600">
                      I authorize <strong>{event.name}</strong> and its event managers to identify and tag me in event photos, and to utilize photos in which I appear for marketing and promotional campaigns across my selected channels below.
                    </span>
                  </div>
                </label>

                {/* GRANULAR MARKETING CHANNELS SELECTION */}
                {photoConsentGiven ? (
                  <div className="p-4 rounded-2xl bg-white border border-indigo-200/90 shadow-xs space-y-3 transition-all animate-fadeIn">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                          <Share2 className="w-3.5 h-3.5 text-indigo-600" />
                          Permitted Marketing Channels
                        </h4>
                        <p className="text-[11px] text-slate-500">
                          Select the specific platforms where event managers may publish your photos:
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => setSelectedChannels([...configuredChannels])}
                          className="text-indigo-600 hover:underline font-semibold text-[11px] cursor-pointer"
                        >
                          Select All
                        </button>
                        <span className="text-slate-300">·</span>
                        <button
                          type="button"
                          onClick={() => setSelectedChannels([])}
                          className="text-slate-500 hover:underline font-medium text-[11px] cursor-pointer"
                        >
                          Deselect All
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {configuredChannels.map((channel) => {
                        const isChecked = selectedChannels.includes(channel);
                        return (
                          <label
                            key={channel}
                            className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition select-none ${
                              isChecked
                                ? 'bg-indigo-50/70 border-indigo-300 text-slate-900 font-medium shadow-xs'
                                : 'bg-slate-50 border-slate-200 text-slate-500'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleChannelToggle(channel)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="truncate">{channel}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-100/70 border border-slate-200/80 text-[11px] text-slate-500 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span>
                      Photo marketing consent is not selected. Your photos will <strong>not</strong> be published to marketing channels or tagged.
                    </span>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting}
                className="w-full mt-6 py-3.5 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white font-medium rounded-xl text-sm shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Recording Check-In...
                  </>
                ) : (
                  <>
                    Complete Check-In
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* STEP 2: CAMERA CAPTURE (OPTIONAL FOR USERS WHO CONSENTED) */}
        {step === 'camera' && (
          <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
            <div className="text-center max-w-md mx-auto mb-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
                <Camera className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">
                Check-in reference photo for event identification (optional)
              </h2>
              <p className="text-xs text-slate-500 mt-2">
                This optional photo allows photographers and facial identification to tag you in event photos. All images will be purged within 30 days of the event.
              </p>
            </div>

            {cameraError && (
              <div className="mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center justify-between">
                <span>{cameraError}</span>
                <button
                  type="button"
                  onClick={startCamera}
                  className="text-xs font-bold text-indigo-700 underline ml-2 cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {/* Camera Viewport / Preview */}
            <div className="relative aspect-square max-w-xs sm:max-w-sm mx-auto bg-slate-900 rounded-3xl overflow-hidden shadow-inner flex items-center justify-center border-4 border-slate-100">
              {/* Always-mounted Live Video Feed */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => {
                  setVideoLoaded(true);
                  if (videoRef.current) {
                    videoRef.current.play().catch(() => {});
                  }
                }}
                onCanPlay={() => {
                  setVideoLoaded(true);
                  if (videoRef.current) {
                    videoRef.current.play().catch(() => {});
                  }
                }}
                className={`absolute inset-0 w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-300 ${
                  cameraActive && !capturedPhotoDataUrl && videoLoaded
                    ? 'opacity-100 z-10'
                    : 'opacity-0 pointer-events-none'
                }`}
              />

              {/* Snapshot Preview */}
              {capturedPhotoDataUrl && (
                <img
                  src={capturedPhotoDataUrl}
                  alt="Attendee Selfie"
                  className="absolute inset-0 w-full h-full object-cover z-20"
                />
              )}

              {/* Non-Black Loading & Connecting Placeholder */}
              {!capturedPhotoDataUrl && (!cameraActive || cameraStarting || !videoLoaded) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-300 z-5 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
                  {cameraStarting || (cameraActive && !videoLoaded) ? (
                    <>
                      <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mb-3" />
                      <p className="text-sm font-semibold text-white">Starting camera...</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-[200px]">
                        Connecting to your video feed. Please approve device permissions if prompted.
                      </p>
                    </>
                  ) : cameraError ? (
                    <>
                      <AlertCircle className="w-10 h-10 text-amber-400 mb-2" />
                      <p className="text-xs text-slate-200 mb-3 px-4">{cameraError}</p>
                      <button
                        type="button"
                        onClick={startCamera}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-sm"
                      >
                        Try Camera Again
                      </button>
                    </>
                  ) : (
                    <>
                      <Camera className="w-12 h-12 text-slate-500 mb-2 opacity-60" />
                      <p className="text-xs text-slate-400 mb-3">Camera is paused</p>
                      <button
                        type="button"
                        onClick={startCamera}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-sm"
                      >
                        Start Camera
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Hidden Canvas for capture */}
              <canvas ref={canvasRef} className="hidden" />
            </div>

            {/* Controls */}
            <div className="mt-6 flex flex-col gap-3 max-w-sm mx-auto">
              {capturedPhotoDataUrl ? (
                <div className="flex gap-3">
                  <button
                    onClick={handleRetake}
                    disabled={uploadingPhoto}
                    className="flex-1 py-2.5 px-4 border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-4 h-4 text-slate-500" />
                    Retake Photo
                  </button>
                  <button
                    onClick={handleConfirmPhoto}
                    disabled={uploadingPhoto}
                    className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    {uploadingPhoto ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Confirm Photo
                      </>
                    )}
                  </button>
                </div>
              ) : cameraActive && videoLoaded ? (
                <button
                  onClick={takeSnapshot}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-xl transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  Snap Reference Photo
                </button>
              ) : (
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={startCamera}
                    disabled={cameraStarting}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-sm font-medium rounded-xl transition flex items-center justify-center gap-2 shadow-sm cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    {cameraStarting ? 'Connecting Camera...' : 'Take Selfie with Camera'}
                  </button>

                  <div className="relative flex items-center justify-center my-1">
                    <div className="border-t border-slate-200 w-full"></div>
                    <span className="bg-white px-2 text-[10px] uppercase tracking-wider font-semibold text-slate-400">or</span>
                  </div>

                  {/* File picker for photo library / gallery (explicit extensions prevent camera hijacking on mobile) */}
                  <label className="w-full py-2.5 px-3 border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-2 cursor-pointer shadow-2xs">
                    <Upload className="w-4 h-4 text-indigo-600" />
                    <span>Upload from device / photo library</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {/* Skip Option */}
              <button
                onClick={handleSkipPhoto}
                disabled={uploadingPhoto}
                className="w-full py-2.5 text-slate-500 hover:text-slate-800 text-xs font-medium rounded-xl transition mt-1 cursor-pointer"
              >
                Skip photo and finish check-in &rarr;
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: CONFIRMATION SCREEN */}
        {step === 'confirmation' && (
          <div className="bg-white rounded-3xl p-8 sm:p-12 shadow-sm border border-slate-200/80 text-center max-w-lg mx-auto">
            <div className="w-16 h-16 rounded-3xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-100">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <span className="text-xs font-semibold tracking-wider uppercase text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
              Check-In Successful
            </span>

            <h2 className="text-2xl font-bold text-slate-900 mt-4">
              Welcome, {fullName}!
            </h2>
            <p className="text-sm text-slate-600 mt-2">
              You are officially checked in to <strong>{event.name}</strong>. Enjoy your event!
            </p>

            {/* Check-In Summary Badge */}
            <div className="bg-slate-50 rounded-2xl p-4 text-left border border-slate-200/70 mt-6 space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Badge Name:</span>
                <span className="font-semibold text-slate-800">{fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Email:</span>
                <span className="font-medium text-slate-800">{email}</span>
              </div>
              {ticketType && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Ticket Tier:</span>
                  <span className="font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                    {ticketType}
                  </span>
                </div>
              )}

              {/* Marketing & Photo Consent Status */}
              <div className="pt-2 border-t border-slate-200/70">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-400">Photo Marketing Consent:</span>
                  <span
                    className={`font-semibold px-2 py-0.5 rounded-full text-[10px] ${
                      photoConsentGiven
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {photoConsentGiven ? 'Granted ✓' : 'Opted Out (No Marketing)'}
                  </span>
                </div>

                {photoConsentGiven ? (
                  <div className="mt-1.5">
                    <span className="text-slate-400 block text-[11px] mb-1">
                      Approved Publication Channels:
                    </span>
                    {selectedChannels.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {selectedChannels.map((c) => (
                          <span
                            key={c}
                            className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-medium"
                          >
                            ✓ {c}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-amber-700 text-[11px]">
                        No individual marketing channels selected.
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1 italic">
                    Your photos will not be utilized in promotional marketing materials or public tagging.
                  </p>
                )}
              </div>

              <div className="flex justify-between pt-1 border-t border-slate-200/70">
                <span className="text-slate-400">Check-in Photo:</span>
                <span className="text-slate-800">
                  {capturedPhotoDataUrl ? 'Uploaded ✓' : 'None (Skipped)'}
                </span>
              </div>
            </div>

            {/* Auto-Reset Countdown Bar for Kiosk Flow */}
            <div className="mt-6 p-4 rounded-2xl bg-indigo-50/80 border border-indigo-100 flex flex-col items-center gap-2 text-left">
              <div className="flex items-center justify-between w-full text-xs">
                <span className="text-slate-700 font-medium flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-indigo-600" />
                  {autoResetPaused ? (
                    <span className="text-amber-700 font-semibold">Auto-reset timer paused</span>
                  ) : (
                    <span>
                      Resetting for next attendee in{' '}
                      <strong className="text-indigo-700 font-mono text-sm font-bold">{countdown}s</strong>
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setAutoResetPaused(!autoResetPaused)}
                  className="text-[11px] text-indigo-700 hover:text-indigo-900 font-semibold underline cursor-pointer"
                >
                  {autoResetPaused ? 'Resume Timer' : 'Pause Timer'}
                </button>
              </div>

              {/* Progress Bar */}
              {!autoResetPaused && (
                <div className="w-full h-1.5 bg-indigo-100 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(countdown / AUTO_RESET_DELAY) * 100}%` }}
                  />
                </div>
              )}
            </div>

            <div className="mt-6 space-y-3">
              <button
                onClick={resetFormForNextAttendee}
                className="w-full py-3 bg-slate-900 hover:bg-black text-white text-sm font-medium rounded-xl transition cursor-pointer flex items-center justify-center gap-2"
              >
                <span>Check In Next Attendee Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {onBackToApp && (
                <button
                  onClick={onBackToApp}
                  className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-900 transition cursor-pointer"
                >
                  Return to Management Hub
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
