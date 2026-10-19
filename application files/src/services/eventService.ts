import {
  db,
  storage,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  ref,
  uploadBytesResumable,
  uploadString,
  getDownloadURL,
  deleteObject,
  serverTimestamp,
  handleFirestoreError,
  OperationType
} from '../lib/firebase';
import { EventItem, AttendeeRecord, PhotoRecord, CustomField, AssignedPhotographer, UserProfile } from '../types';

function sanitizePayload<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizePayload(value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

// Helper to compress and downsample large photographer files into high-quality, web-ready JPEGs
async function compressImageFile(file: File, maxDim = 1920, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => {
      resolve('');
    };
    reader.onload = () => {
      const dataUrl = reader.result as string;
      if (!file.type.startsWith('image/')) {
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const eventService = {
  // --- EVENTS ---
  async createEvent(eventData: Omit<EventItem, 'id' | 'createdAt'>): Promise<string> {
    const eventId = 'evt_' + Math.random().toString(36).substring(2, 10);
    const eventDocRef = doc(db, 'events', eventId);
    const newEvent: EventItem = {
      ...eventData,
      id: eventId,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(eventDocRef, sanitizePayload(newEvent));
      return eventId;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `events/${eventId}`);
    }
  },

  async getEvent(eventId: string): Promise<EventItem | null> {
    const eventDocRef = doc(db, 'events', eventId);
    try {
      const snap = await getDoc(eventDocRef);
      if (!snap.exists()) return null;
      return snap.data() as EventItem;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `events/${eventId}`);
    }
  },

  async updateEvent(eventId: string, partial: Partial<EventItem>): Promise<void> {
    const eventDocRef = doc(db, 'events', eventId);
    try {
      await updateDoc(eventDocRef, sanitizePayload(partial));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}`);
    }
  },

  async deleteEvent(eventId: string): Promise<void> {
    const eventDocRef = doc(db, 'events', eventId);
    try {
      await deleteDoc(eventDocRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `events/${eventId}`);
    }
  },

  async listManagerEvents(managerUid: string): Promise<EventItem[]> {
    const eventsRef = collection(db, 'events');
    try {
      const q = query(eventsRef, where('ownerUid', '==', managerUid));
      const snap = await getDocs(q);
      const events: EventItem[] = [];
      for (const d of snap.docs) {
        events.push(d.data() as EventItem);
      }
      return events.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err) {
      try {
        const snap = await getDocs(eventsRef);
        const events: EventItem[] = [];
        snap.forEach((d) => {
          const item = d.data() as EventItem;
          if (item.ownerUid === managerUid || managerUid === 'demo_mgr_101') {
            events.push(item);
          }
        });
        return events.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      } catch (fallbackErr) {
        handleFirestoreError(err, OperationType.LIST, 'events');
      }
    }
  },

  async listPublicEvents(): Promise<EventItem[]> {
    const eventsRef = collection(db, 'events');
    try {
      const snap = await getDocs(query(eventsRef, orderBy('createdAt', 'desc'), limit(30)));
      const events: EventItem[] = [];
      snap.forEach((d) => {
        events.push(d.data() as EventItem);
      });
      return events;
    } catch (err) {
      console.warn('Could not list public events:', err);
      return [];
    }
  },

  async listPhotographerEvents(photographerUid: string, photographerEmail?: string): Promise<EventItem[]> {
    const eventsRef = collection(db, 'events');
    const matchedMap = new Map<string, EventItem>();

    // 1. Indexed query by photographer email (fast, single read per assigned event)
    if (photographerEmail) {
      try {
        const qEmail = query(eventsRef, where('photographerEmails', 'array-contains', photographerEmail.toLowerCase()));
        const snapEmail = await getDocs(qEmail);
        snapEmail.forEach((d) => matchedMap.set(d.id, d.data() as EventItem));
      } catch (e) {
        // continue
      }
    }

    // 2. Indexed query by photographer UID
    if (photographerUid && photographerUid !== 'demo_photo_202') {
      try {
        const qUid = query(eventsRef, where('photographerUids', 'array-contains', photographerUid));
        const snapUid = await getDocs(qUid);
        snapUid.forEach((d) => matchedMap.set(d.id, d.data() as EventItem));
      } catch (e) {
        // continue
      }
    }

    if (matchedMap.size > 0) {
      return Array.from(matchedMap.values()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }

    // Fallback for demo photographer account or legacy events without array fields (bounded by limit)
    try {
      const snap = await getDocs(query(eventsRef, orderBy('createdAt', 'desc'), limit(30)));
      const matched: EventItem[] = [];
      snap.forEach((d) => {
        const item = d.data() as EventItem;
        const isAssigned =
          item.photographerUids?.includes(photographerUid) ||
          (photographerEmail && item.photographerEmails?.some((e) => e.toLowerCase() === photographerEmail.toLowerCase())) ||
          item.assignedPhotographers?.some(
            (p) =>
              p.uid === photographerUid ||
              (photographerEmail && p.email.toLowerCase() === photographerEmail.toLowerCase())
          ) ||
          photographerUid === 'demo_photo_202';

        if (isAssigned) {
          matched.push(item);
        }
      });
      return matched;
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'events');
    }
  },

  // --- ATTENDEES (Root Collection & Subcollection Dual-Write) ---
  async submitAttendeeCheckIn(
    eventId: string,
    data: Omit<AttendeeRecord, 'id' | 'eventId' | 'checkedInAt' | 'checkInPhotoPath'>
  ): Promise<{ attendeeId: string }> {
    const attendeeId = 'att_' + Math.random().toString(36).substring(2, 10);
    const newRecord: AttendeeRecord & { embeddingStatus?: string } = {
      ...data,
      id: attendeeId,
      eventId,
      event_id: eventId,
      phone: data.phone || null,
      ticketType: data.ticketType || null,
      dietaryAccessibility: data.dietaryAccessibility || null,
      sessionPreferences: data.sessionPreferences || [],
      customResponses: data.customResponses || {},
      allowedMarketingChannels: data.allowedMarketingChannels || [],
      checkedInAt: new Date().toISOString(),
      consentGiven: true,
      photoConsentGiven: Boolean(data.photoConsentGiven),
      checkInPhotoPath: null,
      photoEmbedding: [], // Explicitly initialize so the field always exists in Firestore Studio
      embeddingStatus: 'pending'
    };

    const cleanPayload = sanitizePayload(newRecord);

    try {
      // 1. Write to ROOT collection /attendees/{attendeeId}
      await setDoc(doc(db, 'attendees', attendeeId), cleanPayload);
    } catch (err) {
      // ignore root write if failed, continue to subcollection
    }

    try {
      // 2. Also write to /events/{eventId}/attendees/{attendeeId} for backward compatibility
      await setDoc(doc(db, 'events', eventId, 'attendees', attendeeId), cleanPayload);
      return { attendeeId };
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `events/${eventId}/attendees/${attendeeId}`);
    }
  },

  async updateAttendeePhoto(
    eventId: string,
    attendeeId: string,
    storagePath: string,
    downloadUrl?: string
  ): Promise<void> {
    const updateObj = {
      checkInPhotoPath: storagePath,
      ...(downloadUrl ? { checkInPhotoUrl: downloadUrl } : {})
    };

    // Update in root attendees
    try {
      await updateDoc(doc(db, 'attendees', attendeeId), updateObj);
    } catch (e) {
      // non-fatal
    }

    // Update in subcollection
    const attendeeDocRef = doc(db, 'events', eventId, 'attendees', attendeeId);
    try {
      const updatePromise = updateDoc(attendeeDocRef, updateObj);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Update timeout')), 3500)
      );
      await Promise.race([updatePromise, timeoutPromise]);
    } catch (err) {
      console.warn('Notice: updateAttendeePhoto completed with non-blocking status:', err);
    }
  },

  async listEventAttendees(eventId: string): Promise<AttendeeRecord[]> {
    // 1. Try querying root /attendees where eventId == eventId
    try {
      const rootQ = query(collection(db, 'attendees'), where('eventId', '==', eventId));
      const snap = await getDocs(rootQ);
      if (!snap.empty) {
        const list: AttendeeRecord[] = [];
        snap.forEach((d) => list.push(d.data() as AttendeeRecord));
        return list.sort((a, b) => (b.checkedInAt || '').localeCompare(a.checkedInAt || ''));
      }
    } catch (e) {
      // root query fallback
    }

    // 2. Fallback to subcollection /events/{eventId}/attendees
    const collRef = collection(db, 'events', eventId, 'attendees');
    try {
      const snap = await getDocs(collRef);
      const list: AttendeeRecord[] = [];
      snap.forEach((d) => {
        list.push(d.data() as AttendeeRecord);
      });
      return list.sort((a, b) => (b.checkedInAt || '').localeCompare(a.checkedInAt || ''));
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, `events/${eventId}/attendees`);
    }
  },

  async listAllAttendees(): Promise<AttendeeRecord[]> {
    try {
      const snap = await getDocs(collection(db, 'attendees'));
      const list: AttendeeRecord[] = [];
      snap.forEach((d) => list.push(d.data() as AttendeeRecord));
      return list.sort((a, b) => (b.checkedInAt || '').localeCompare(a.checkedInAt || ''));
    } catch (err) {
      console.warn('Could not list all attendees:', err);
      return [];
    }
  },

  // --- PHOTOS (Master Top-Level Photos Table + eventId foreign key) ---
  async uploadPhotoFile(
    eventId: string,
    file: File,
    uploaderUid: string,
    uploaderEmail: string | undefined,
    onProgress?: (pct: number) => void
  ): Promise<PhotoRecord> {
    const photoId = 'ph_' + Math.random().toString(36).substring(2, 12);
    const storagePath = `photographers/${eventId}/${photoId}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    if (onProgress) onProgress(15);

    // 1. Read & optimize the image
    const optimizedDataUrl = await compressImageFile(file, 1920, 0.85);
    if (onProgress) onProgress(45);

    let downloadUrl = optimizedDataUrl;

    // 2. Upload to Firebase Storage if available
    try {
      const storageRef = ref(storage, storagePath);
      const uploadPromise = uploadString(storageRef, optimizedDataUrl, 'data_url');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Storage upload timeout')), 2500)
      );
      if (onProgress) onProgress(75);
      const uploadResult = (await Promise.race([uploadPromise, timeoutPromise])) as any;
      const onlineUrl = await getDownloadURL(uploadResult.ref);
      if (onlineUrl) downloadUrl = onlineUrl;
      if (onProgress) onProgress(90);
    } catch (storageErr) {
      console.warn('Storage bucket upload notice, using secure compressed reference:', storageErr);
      if (onProgress) onProgress(85);
    }

    // 3. Construct master photo record with eventId and event_id
    const photoRecord: PhotoRecord = {
      id: photoId,
      eventId,
      event_id: eventId,
      uploadedBy: uploaderUid,
      uploadedByEmail: uploaderEmail || 'photographer@lumina.event',
      uploadedAt: new Date().toISOString(),
      storagePath,
      downloadUrl,
      fileName: file.name,
      fileSize: file.size,
      status: 'pending',
      matchedAttendees: [],
      hasBlurredFaces: false,
      blurredFaceCount: 0
    };

    const cleanRecord = sanitizePayload(photoRecord);

    // 4. Primary Write: ROOT /photos/{photoId} collection (Company Owner Master Table)
    try {
      await setDoc(doc(db, 'photos', photoId), cleanRecord);
    } catch (fsErr) {
      console.warn('Could not write to root /photos collection, trying subcollection:', fsErr);
    }

    // 5. Dual Write: Legacy /events/{eventId}/photos/{photoId} (Subcollection compatibility)
    try {
      await setDoc(doc(db, 'events', eventId, 'photos', photoId), cleanRecord);
    } catch (fsErr) {
      console.warn('Subcollection dual-write notice:', fsErr);
    }

    if (onProgress) onProgress(100);
    return photoRecord;
  },

  // Company Owner Master Query: Direct query to /photos table
  async listAllPhotos(): Promise<PhotoRecord[]> {
    try {
      const snap = await getDocs(collection(db, 'photos'));
      const list: PhotoRecord[] = [];
      snap.forEach((d) => {
        list.push(d.data() as PhotoRecord);
      });
      return list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    } catch (err) {
      console.warn('Notice querying root /photos:', err);
      return [];
    }
  },

  // Scoped Event Query: Filter by eventId
  async listEventPhotos(eventId: string): Promise<PhotoRecord[]> {
    // 1. Primary Query: root /photos where eventId == eventId (single indexed read query)
    try {
      const rootQ = query(collection(db, 'photos'), where('eventId', '==', eventId));
      const snap = await getDocs(rootQ);
      if (!snap.empty) {
        const list: PhotoRecord[] = [];
        snap.forEach((d) => {
          list.push(d.data() as PhotoRecord);
        });
        return list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
      }
    } catch (e) {
      // fallback
    }

    // 2. Graceful fallback for legacy events only if root query is empty
    try {
      const collRef = collection(db, 'events', eventId, 'photos');
      const snap = await getDocs(collRef);
      const list: PhotoRecord[] = [];
      snap.forEach((d) => {
        const subData = d.data() as PhotoRecord;
        list.push({ ...subData, eventId, event_id: eventId });
      });
      return list.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    } catch (err) {
      console.warn('Notice loading event photos:', err);
      return [];
    }
  },

  async updatePhotoStatus(
    eventId: string,
    photoId: string,
    status: 'pending' | 'processed' | 'flagged'
  ): Promise<void> {
    // Update root
    try {
      await updateDoc(doc(db, 'photos', photoId), { status });
    } catch (e) {
      // non-fatal
    }

    // Update subcollection
    const docRef = doc(db, 'events', eventId, 'photos', photoId);
    try {
      await updateDoc(docRef, { status });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}/photos/${photoId}`);
    }
  },

  async updatePhotoMatchedAttendees(
    eventId: string,
    photoId: string,
    matchedAttendees: string[]
  ): Promise<void> {
    const payload = { matchedAttendees, status: 'processed' };
    try {
      await updateDoc(doc(db, 'photos', photoId), payload);
    } catch (e) {
      // non-fatal
    }

    const docRef = doc(db, 'events', eventId, 'photos', photoId);
    try {
      await updateDoc(docRef, payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `events/${eventId}/photos/${photoId}`);
    }
  },

  async unblockPendingPhotos(eventId: string): Promise<number> {
    const photos = await this.listEventPhotos(eventId);
    const pending = photos.filter((p) => p.status === 'pending');
    let count = 0;
    for (const p of pending) {
      const updateData = {
        status: 'processed',
        clearedDownloadUrl: p.downloadUrl,
        processedAt: new Date().toISOString()
      };
      try {
        await setDoc(doc(db, 'photos', p.id), updateData, { merge: true });
      } catch (e) {}
      try {
        await setDoc(doc(db, 'events', eventId, 'photos', p.id), updateData, { merge: true });
      } catch (e) {}
      count++;
    }
    return count;
  },

  async deletePhoto(
    eventId: string,
    photoId: string,
    storagePaths?: string | (string | undefined)[]
  ): Promise<void> {
    // 1. Delete from root /photos/{photoId}
    try {
      await deleteDoc(doc(db, 'photos', photoId));
    } catch (e) {
      // non-fatal
    }

    // 2. Delete from /events/{eventId}/photos/{photoId}
    const docRef = doc(db, 'events', eventId, 'photos', photoId);
    try {
      await deleteDoc(docRef);
    } catch (err) {
      // non-fatal
    }

    // 3. Clean up storage paths
    const pathsToDelete: string[] = [];
    if (typeof storagePaths === 'string' && storagePaths) {
      pathsToDelete.push(storagePaths);
    } else if (Array.isArray(storagePaths)) {
      for (const p of storagePaths) {
        if (p && typeof p === 'string' && !p.startsWith('data:') && !p.startsWith('blob:') && !p.startsWith('http')) {
          pathsToDelete.push(p);
        }
      }
    }

    await Promise.all(
      pathsToDelete.map(async (p) => {
        try {
          const cleanPath = p.replace(/^gs:\/\/[^/]+\//, '');
          const sRef = ref(storage, cleanPath);
          await Promise.race([
            deleteObject(sRef),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Storage timeout')), 2500))
          ]);
        } catch (e) {
          // ignore
        }
      })
    );
  },

  async deletePhotosBulk(
    eventId: string,
    photos: { id: string; storagePath?: string; clearedStoragePath?: string; rawStoragePath?: string }[],
    onProgress?: (deleted: number, total: number) => void
  ): Promise<{ successful: number; failed: number }> {
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      try {
        await this.deletePhoto(eventId, p.id, [p.storagePath, p.clearedStoragePath, p.rawStoragePath]);
        successful++;
      } catch (e) {
        console.warn(`Failed to delete photo ${p.id}:`, e);
        failed++;
      }
      if (onProgress) {
        onProgress(i + 1, photos.length);
      }
    }

    return { successful, failed };
  },

  // --- DATABASE INITIALIZATION & SCHEMA MATERIALIZATION ---
  // Guarantees all tables and all variables exist and are visible in GCloud Firestore Console
  async initializeAndSeedDatabase(
    adminUid: string,
    adminEmail: string
  ): Promise<{
    success: boolean;
    collectionsInitialized: string[];
    recordsCount: number;
  }> {
    const collectionsInitialized: string[] = [];
    let recordsCount = 0;

    // 1. Materialize /admins collection
    try {
      await setDoc(doc(db, 'admins', adminUid), {
        email: adminEmail,
        role: 'super_admin',
        createdAt: new Date().toISOString()
      });
      // Also write by email key for simple lookup
      await setDoc(doc(db, 'admins', adminEmail.replace(/[@.]/g, '_')), {
        email: adminEmail,
        role: 'super_admin',
        createdAt: new Date().toISOString()
      });
      collectionsInitialized.push('admins');
      recordsCount += 2;
    } catch (e) {
      console.warn('Admins seed error:', e);
    }

    // 2. Materialize /users collection (Master Users Table)
    try {
      // Super Admin User
      await setDoc(doc(db, 'users', adminUid), {
        uid: adminUid,
        email: adminEmail,
        displayName: 'Thomas Leffler (Company Owner)',
        role: 'super_admin',
        assignedEvents: ['evt_summit_2026', 'evt_gala_2026'],
        inviteStatus: 'active',
        createdAt: new Date().toISOString()
      });

      // Sample Event Manager User
      await setDoc(doc(db, 'users', 'mgr_sarah_jenkins'), {
        uid: 'mgr_sarah_jenkins',
        email: 'sarah.jenkins@luminaevents.com',
        displayName: 'Sarah Jenkins',
        role: 'event_manager',
        assignedEvents: ['evt_summit_2026'],
        inviteStatus: 'active',
        createdAt: new Date().toISOString()
      });

      // Sample Photographer User 1
      await setDoc(doc(db, 'users', 'photog_alex_rivera'), {
        uid: 'photog_alex_rivera',
        email: 'alex.photos@lumina.event',
        displayName: 'Alex Rivera',
        role: 'photographer',
        assignedEvents: ['evt_summit_2026', 'evt_gala_2026'],
        inviteStatus: 'active',
        createdAt: new Date().toISOString()
      });

      // Sample Photographer User 2
      await setDoc(doc(db, 'users', 'photog_elena_rostova'), {
        uid: 'photog_elena_rostova',
        email: 'elena.lens@summit.io',
        displayName: 'Elena Rostova',
        role: 'photographer',
        assignedEvents: ['evt_summit_2026'],
        inviteStatus: 'active',
        createdAt: new Date().toISOString()
      });

      collectionsInitialized.push('users');
      recordsCount += 4;
    } catch (e) {
      console.warn('Users seed error:', e);
    }

    // 3. Materialize /events collection (Master Events Table)
    const event1Id = 'evt_summit_2026';
    const event2Id = 'evt_gala_2026';
    try {
      await setDoc(doc(db, 'events', event1Id), {
        id: event1Id,
        ownerUid: adminUid,
        ownerEmail: adminEmail,
        name: 'Global Tech & Vision AI Summit 2026',
        date: '2026-10-15',
        location: 'Grand Horizon Convention Center & Virtual Hall',
        ticketTypes: ['VIP All-Access', 'General Admission', 'Speaker & Press', 'Student Pass'],
        sessions: [
          'Keynote: The Future of Vision AI & Media',
          'Breakout A: Enterprise Cloud Architecture',
          'Breakout B: Real-Time Media Pipelines',
          'Workshop: Autonomous Photography Workflows',
          'Networking Mixer & Fireside Chat'
        ],
        customFields: [
          { id: 'company', label: 'Company / Organization', type: 'text', required: true },
          { id: 'job_title', label: 'Job Title / Function', type: 'text', required: false },
          { id: 'first_time', label: 'First time attending this summit?', type: 'boolean', required: false }
        ],
        marketingChannels: [
          'Instagram',
          'LinkedIn',
          'Facebook',
          'X (Twitter)',
          'Press Releases & Company Portal'
        ],
        assignedPhotographers: [
          { email: 'alex.photos@lumina.event', inviteStatus: 'active', uid: 'photog_alex_rivera' },
          { email: 'elena.lens@summit.io', inviteStatus: 'active', uid: 'photog_elena_rostova' },
          { email: adminEmail, inviteStatus: 'active', uid: adminUid }
        ],
        photographerEmails: ['alex.photos@lumina.event', 'elena.lens@summit.io', adminEmail],
        photographerUids: ['photog_alex_rivera', 'photog_elena_rostova', adminUid],
        createdAt: new Date().toISOString()
      });

      await setDoc(doc(db, 'events', event2Id), {
        id: event2Id,
        ownerUid: adminUid,
        ownerEmail: adminEmail,
        name: 'Annual Lumina Founders & Investors Gala',
        date: '2026-11-20',
        location: 'Palace of Fine Arts, San Francisco',
        ticketTypes: ['Partner Pass', 'Guest of Honor', 'Media'],
        sessions: ['Welcoming Reception', 'Keynote Address', 'Awards Ceremony'],
        customFields: [{ id: 'dietary', label: 'Dietary Preferences', type: 'text', required: false }],
        marketingChannels: ['LinkedIn', 'Instagram', 'Press'],
        assignedPhotographers: [
          { email: 'alex.photos@lumina.event', inviteStatus: 'active', uid: 'photog_alex_rivera' }
        ],
        photographerEmails: ['alex.photos@lumina.event'],
        photographerUids: ['photog_alex_rivera'],
        createdAt: new Date().toISOString()
      });

      collectionsInitialized.push('events');
      recordsCount += 2;
    } catch (e) {
      console.warn('Events seed error:', e);
    }

    // 4. Materialize /photos collection (Master Photos Table with eventId/event_id)
    try {
      const samplePhotos = [
        {
          id: 'ph_summit_keynote_01',
          eventId: event1Id,
          event_id: event1Id,
          eventName: 'Global Tech & Vision AI Summit 2026',
          uploadedBy: adminUid,
          uploadedByEmail: adminEmail,
          uploadedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          storagePath: `photographers/${event1Id}/ph_summit_keynote_01.jpg`,
          downloadUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&auto=format&fit=crop&q=80',
          fileName: 'keynote_hall_opening.jpg',
          fileSize: 2458190,
          status: 'processed' as const,
          matchedAttendees: ['att_marcus_chen_01'],
          hasBlurredFaces: true,
          blurredFaceCount: 2,
          clearedStoragePath: `events/${event1Id}/photos/cleared/ph_summit_keynote_01.jpg`,
          clearedDownloadUrl: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&auto=format&fit=crop&q=80',
          allowedMarketingChannels: ['LinkedIn', 'Instagram'],
          rawStoragePath: `photographers/${event1Id}/ph_summit_keynote_01.jpg`,
          processedAt: new Date().toISOString()
        },
        {
          id: 'ph_summit_panel_02',
          eventId: event1Id,
          event_id: event1Id,
          eventName: 'Global Tech & Vision AI Summit 2026',
          uploadedBy: 'photog_alex_rivera',
          uploadedByEmail: 'alex.photos@lumina.event',
          uploadedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
          storagePath: `photographers/${event1Id}/ph_summit_panel_02.jpg`,
          downloadUrl: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=1200&auto=format&fit=crop&q=80',
          fileName: 'ai_panel_discussion.jpg',
          fileSize: 1892040,
          status: 'processed' as const,
          matchedAttendees: ['att_sophia_martinez_02'],
          hasBlurredFaces: false,
          blurredFaceCount: 0,
          clearedStoragePath: `events/${event1Id}/photos/cleared/ph_summit_panel_02.jpg`,
          clearedDownloadUrl: 'https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=1200&auto=format&fit=crop&q=80',
          allowedMarketingChannels: ['LinkedIn', 'Facebook', 'Press Releases & Company Portal'],
          rawStoragePath: `photographers/${event1Id}/ph_summit_panel_02.jpg`,
          processedAt: new Date().toISOString()
        },
        {
          id: 'ph_gala_cocktail_03',
          eventId: event2Id,
          event_id: event2Id,
          eventName: 'Annual Lumina Founders & Investors Gala',
          uploadedBy: 'photog_alex_rivera',
          uploadedByEmail: 'alex.photos@lumina.event',
          uploadedAt: new Date().toISOString(),
          storagePath: `photographers/${event2Id}/ph_gala_cocktail_03.jpg`,
          downloadUrl: 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=1200&auto=format&fit=crop&q=80',
          fileName: 'founders_mixer_welcome.jpg',
          fileSize: 3104590,
          status: 'pending' as const,
          matchedAttendees: [],
          hasBlurredFaces: false,
          blurredFaceCount: 0
        }
      ];

      for (const p of samplePhotos) {
        // Write to root photos table
        await setDoc(doc(db, 'photos', p.id), p);
        // Also write to subcollection for backward compatibility
        await setDoc(doc(db, 'events', p.eventId, 'photos', p.id), p);
      }

      collectionsInitialized.push('photos');
      recordsCount += samplePhotos.length;
    } catch (e) {
      console.warn('Photos seed error:', e);
    }

    // 5. Materialize /attendees collection (Master Attendees Table with eventId/event_id)
    try {
      const sampleAttendees = [
        {
          id: 'att_marcus_chen_01',
          eventId: event1Id,
          event_id: event1Id,
          fullName: 'Dr. Marcus Chen',
          email: 'marcus.chen@stanford.edu',
          phone: '+1 (415) 555-0192',
          ticketType: 'VIP All-Access',
          sessionPreferences: ['Keynote: The Future of Vision AI & Media', 'Breakout B: Real-Time Media Pipelines'],
          dietaryAccessibility: 'Gluten-Free, Wheelchair accessibility not needed',
          customResponses: { company: 'Stanford AI Lab', job_title: 'Research Scientist', first_time: false },
          consentGiven: true,
          photoConsentGiven: true,
          allowedMarketingChannels: ['Instagram', 'LinkedIn', 'Press Releases & Company Portal'],
          checkedInAt: new Date(Date.now() - 3600000 * 3).toISOString(),
          checkInPhotoPath: 'checkin/evt_summit_2026/att_marcus_chen_01.jpg',
          checkInPhotoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80',
          deleteOn: new Date(Date.now() + 30 * 86400000).toISOString()
        },
        {
          id: 'att_sophia_martinez_02',
          eventId: event1Id,
          event_id: event1Id,
          fullName: 'Sophia Martinez',
          email: 'sophia.m@horizonmedia.io',
          phone: '+1 (312) 555-8831',
          ticketType: 'Speaker & Press',
          sessionPreferences: ['Breakout A: Enterprise Cloud Architecture', 'Workshop: Autonomous Photography Workflows'],
          dietaryAccessibility: 'Vegetarian',
          customResponses: { company: 'Horizon Media Ventures', job_title: 'VP Engineering', first_time: true },
          consentGiven: true,
          photoConsentGiven: true,
          allowedMarketingChannels: ['LinkedIn', 'Facebook'],
          checkedInAt: new Date(Date.now() - 3600000 * 2).toISOString(),
          checkInPhotoPath: 'checkin/evt_summit_2026/att_sophia_martinez_02.jpg',
          checkInPhotoUrl: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=500&auto=format&fit=crop&q=80',
          deleteOn: new Date(Date.now() + 30 * 86400000).toISOString()
        },
        {
          id: 'att_liam_patel_03',
          eventId: event1Id,
          event_id: event1Id,
          fullName: 'Liam Patel',
          email: 'liam.patel@novatech.co',
          phone: '+1 (206) 555-4421',
          ticketType: 'General Admission',
          sessionPreferences: ['Keynote: The Future of Vision AI & Media'],
          dietaryAccessibility: 'None',
          customResponses: { company: 'NovaTech Solutions', job_title: 'Cloud Architect', first_time: true },
          consentGiven: true,
          photoConsentGiven: false, // Refused photo tagging -> should be blurred!
          allowedMarketingChannels: [],
          checkedInAt: new Date(Date.now() - 3600000 * 1).toISOString(),
          checkInPhotoPath: null,
          checkInPhotoUrl: null,
          deleteOn: new Date(Date.now() + 30 * 86400000).toISOString()
        }
      ];

      for (const a of sampleAttendees) {
        // Write to root attendees table
        await setDoc(doc(db, 'attendees', a.id), a);
        // Also write to subcollection for backward compatibility
        await setDoc(doc(db, 'events', a.eventId, 'attendees', a.id), a);
      }

      collectionsInitialized.push('attendees');
      recordsCount += sampleAttendees.length;
    } catch (e) {
      console.warn('Attendees seed error:', e);
    }

    return {
      success: collectionsInitialized.length > 0,
      collectionsInitialized,
      recordsCount
    };
  },

  // Completely wipe all events, photos, and attendees to start over
  async wipeAllData(): Promise<{ deletedEvents: number; deletedPhotos: number; deletedAttendees: number }> {
    let deletedPhotos = 0;
    let deletedAttendees = 0;
    let deletedEvents = 0;

    // 1. Delete all root /photos
    try {
      const snap = await getDocs(collection(db, 'photos'));
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
        deletedPhotos++;
      }
    } catch (e) {
      console.warn('Wipe root photos notice:', e);
    }

    // 2. Delete all root /attendees
    try {
      const snap = await getDocs(collection(db, 'attendees'));
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
        deletedAttendees++;
      }
    } catch (e) {
      console.warn('Wipe root attendees notice:', e);
    }

    // 3. Delete all events and subcollections
    try {
      const eventsSnap = await getDocs(collection(db, 'events'));
      for (const ev of eventsSnap.docs) {
        try {
          const subP = await getDocs(collection(db, 'events', ev.id, 'photos'));
          for (const d of subP.docs) await deleteDoc(d.ref);
        } catch (e) {}

        try {
          const subA = await getDocs(collection(db, 'events', ev.id, 'attendees'));
          for (const d of subA.docs) await deleteDoc(d.ref);
        } catch (e) {}

        await deleteDoc(ev.ref);
        deletedEvents++;
      }
    } catch (e) {
      console.warn('Wipe events notice:', e);
    }

    return { deletedEvents, deletedPhotos, deletedAttendees };
  },

  // Wipe and reset demo from scratch
  async resetDemoToScratch(adminUid: string, adminEmail: string) {
    await this.wipeAllData();
    return await this.initializeAndSeedDatabase(adminUid, adminEmail);
  },

  // Seed sample event if manager empty
  async seedSampleEventIfEmpty(ownerUid: string): Promise<EventItem | null> {
    try {
      const existing = await this.listManagerEvents(ownerUid);
      if (existing.length > 0) return existing[0];
    } catch (e) {
      // ignore
    }

    const sampleEvent: Omit<EventItem, 'id' | 'createdAt'> = {
      ownerUid,
      name: 'Global Tech & AI Innovation Summit 2026',
      date: '2026-10-15',
      location: 'Grand Horizon Convention Center & Virtual Hall',
      ticketTypes: ['VIP All-Access', 'General Admission', 'Speaker & Press', 'Student Pass'],
      sessions: [
        'Keynote: The Future of Vision AI & Media',
        'Breakout A: Enterprise Cloud Architecture',
        'Breakout B: Real-Time Media Pipelines',
        'Workshop: Autonomous Photography Workflows',
        'Networking Mixer & Fireside Chat'
      ],
      customFields: [
        { id: 'company', label: 'Company / Organization', type: 'text', required: true },
        { id: 'job_title', label: 'Job Title / Function', type: 'text', required: false },
        { id: 'first_time', label: 'First time attending this summit?', type: 'boolean', required: false }
      ],
      marketingChannels: [
        'Instagram',
        'Facebook',
        'LinkedIn',
        'X (Twitter)',
        'Event Website & Press Releases'
      ],
      assignedPhotographers: [
        { email: 'photographer@lumina.event', inviteStatus: 'active' },
        { email: 'alex.photos@summit.io', inviteStatus: 'pending' },
        { email: 'thomas_leffler@berkeley.edu', inviteStatus: 'active' }
      ],
      photographerEmails: ['photographer@lumina.event', 'alex.photos@summit.io', 'thomas_leffler@berkeley.edu'],
      photographerUids: []
    };

    try {
      const newId = await this.createEvent(sampleEvent);
      return await this.getEvent(newId);
    } catch (err) {
      console.warn('Could not seed sample event:', err);
      return null;
    }
  }
};
