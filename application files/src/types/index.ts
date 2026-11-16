export type UserRole = 'super_admin' | 'event_manager' | 'photographer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  assignedEvents: string[];
  inviteStatus?: 'active' | 'pending';
  createdAt?: string;
}

export interface CustomField {
  id: string;
  label: string;
  type: 'text' | 'boolean';
  required?: boolean;
}

export interface AssignedPhotographer {
  email: string;
  inviteStatus: 'pending' | 'active';
  uid?: string;
  assignedAt?: string;
}

export interface EventItem {
  id: string;
  ownerUid: string;
  ownerEmail?: string;
  name: string;
  date: string;
  location: string;
  ticketTypes: string[];
  sessions: string[];
  customFields: CustomField[];
  marketingChannels?: string[];
  assignedPhotographers: AssignedPhotographer[];
  photographerEmails?: string[];
  photographerUids?: string[];
  createdAt: string;
  counts?: {
    attendees: number;
    photos: number;
    processed: number;
  };
}

export interface AttendeeRecord {
  id: string;
  eventId: string;
  event_id?: string; // Relational column alias
  fullName: string;
  email: string;
  phone?: string | null;
  ticketType?: string | null;
  sessionPreferences?: string[];
  dietaryAccessibility?: string | null;
  customResponses?: Record<string, string | boolean>;
  consentGiven: boolean;
  photoConsentGiven: boolean;
  allowedMarketingChannels?: string[];
  checkedInAt: any;
  checkInPhotoPath: string | null;
  checkInPhotoUrl?: string | null;
  photoEmbedding?: number[]; // 512-dimensional facial feature vector for KNN search
  deleteOn?: string; // ISO date timestamp when check-in photo and vector should be deleted by cleanup job
}

export type PhotoStatus = 'pending' | 'processed' | 'flagged';

export interface PhotoRecord {
  id: string;
  eventId: string;
  event_id?: string; // Relational column alias
  eventName?: string; // Resolved event title for company owner cross-event views
  uploadedBy: string;
  uploadedByEmail?: string;
  uploadedAt: any;
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  fileSize?: number;
  status: PhotoStatus;
  matchedAttendees: string[];
  detectedFaceEmbeddings?: number[][]; // Extracted 512-dim face embeddings for KNN matching
  clearedStoragePath?: string; // Path to privacy-cleared marketing image
  clearedDownloadUrl?: string; // Direct URL to privacy-cleared marketing image
  allowedMarketingChannels?: string[]; // Marketing channels cleared for this photo
  rawStoragePath?: string; // Restricted original image preserved for Task 3 AI faces upgrade
  hasBlurredFaces?: boolean;
  blurredFaceCount?: number;
  deleteOn?: string;
  processedAt?: string;
}

export interface PlatformMetrics {
  totalEvents: number;
  totalAttendees: number;
  totalPhotos: number;
  photoConsentCount: number;
  photoConsentPercentage: number;
  totalManagers: number;
  totalPhotographers: number;
}

export interface ManagerSummary {
  ownerUid: string;
  email: string;
  displayName?: string;
  eventsCount: number;
  totalAttendees: number;
  totalPhotos: number;
  lastEventDate?: string;
}

export interface PhotographerSummary {
  email: string;
  uid?: string;
  assignedEventsCount: number;
  assignedEventNames: string[];
  totalPhotosUploaded: number;
}
