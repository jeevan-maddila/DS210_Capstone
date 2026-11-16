import { auth } from '../lib/firebase';

export interface GalleryPhoto {
  downloadUrl: string;
  fileName: string;
  id: string;
  viewUrl: string;
}

export interface AttendeeGallery {
  attendeeName: string;
  downloadAllUrl: string;
  eventName: string;
  expiresAt: string;
  photos: GalleryPhoto[];
}

export interface GalleryReleaseResult {
  eligible: number;
  failed: number;
  sent: number;
  skipped: number;
  success: boolean;
}

async function responseJson<T>(response: Response): Promise<T> {
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.error || 'The gallery request failed. Please try again.');
  }
  return result as T;
}

export const galleryService = {
  async release(eventId: string): Promise<GalleryReleaseResult> {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in to release attendee galleries.');
    const idToken = await user.getIdToken();
    const response = await fetch('/api/attendee-galleries/release', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ eventId })
    });
    return responseJson<GalleryReleaseResult>(response);
  },

  async get(token: string): Promise<AttendeeGallery> {
    const response = await fetch(`/api/attendee-galleries/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' }
    });
    return responseJson<AttendeeGallery>(response);
  }
};
