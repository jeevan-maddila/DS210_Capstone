import {
  db,
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  handleFirestoreError,
  OperationType
} from '../lib/firebase';
import {
  EventItem,
  AttendeeRecord,
  PhotoRecord,
  PlatformMetrics,
  ManagerSummary,
  PhotographerSummary,
  UserProfile
} from '../types';
import { eventService } from './eventService';

export const SUPER_ADMIN_EMAIL = 'thomas.leffler2@gmail.com';

let cachedOverview: {
  data: {
    metrics: PlatformMetrics;
    events: EventItem[];
    managers: ManagerSummary[];
    photographers: PhotographerSummary[];
    allPhotos: PhotoRecord[];
    allUsers: UserProfile[];
  };
  timestamp: number;
} | null = null;

const OVERVIEW_CACHE_TTL_MS = 20000; // 20 seconds

export const adminService = {
  isSuperAdmin(email?: string | null): boolean {
    if (!email) return false;
    return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase();
  },

  clearOverviewCache(): void {
    cachedOverview = null;
  },

  async getAllEvents(): Promise<EventItem[]> {
    const eventsCol = collection(db, 'events');
    try {
      const snap = await getDocs(query(eventsCol, orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => d.data() as EventItem);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'events');
      return [];
    }
  },

  // Company Owner Master Photo Query: Returns all photos directly across all events
  async getAllPhotos(): Promise<PhotoRecord[]> {
    try {
      const [photos, events] = await Promise.all([
        eventService.listAllPhotos(),
        this.getAllEvents()
      ]);

      const eventMap = new Map<string, string>();
      events.forEach((e) => eventMap.set(e.id, e.name));

      // Attach readable event names to photos
      return photos.map((p) => ({
        ...p,
        eventName: p.eventName || eventMap.get(p.eventId) || eventMap.get(p.event_id || '') || 'Unassigned Event'
      }));
    } catch (err) {
      console.warn('Failed to fetch all photos:', err);
      return [];
    }
  },

  // Company Owner Master Users Query: Returns all users directly
  async getAllUsers(): Promise<UserProfile[]> {
    try {
      const snap = await getDocs(collection(db, 'users'));
      const users: UserProfile[] = [];
      snap.forEach((d) => {
        users.push(d.data() as UserProfile);
      });
      return users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    } catch (err) {
      console.warn('Failed to fetch users table:', err);
      return [];
    }
  },

  async getPlatformOverview(forceRefresh = false): Promise<{
    metrics: PlatformMetrics;
    events: EventItem[];
    managers: ManagerSummary[];
    photographers: PhotographerSummary[];
    allPhotos: PhotoRecord[];
    allUsers: UserProfile[];
  }> {
    const now = Date.now();
    if (!forceRefresh && cachedOverview && (now - cachedOverview.timestamp < OVERVIEW_CACHE_TTL_MS)) {
      return cachedOverview.data;
    }

    try {
      const [events, allPhotos, allAttendees, allUsers] = await Promise.all([
        this.getAllEvents(),
        eventService.listAllPhotos(),
        eventService.listAllAttendees(),
        this.getAllUsers()
      ]);

      const photoConsentCount = allAttendees.filter((a) => a.photoConsentGiven).length;
      const consentPercentage =
        allAttendees.length > 0 ? Math.round((photoConsentCount / allAttendees.length) * 100) : 0;

      const managersMap = new Map<string, ManagerSummary>();
      const photographersMap = new Map<string, PhotographerSummary>();

      // Populate known users from master users table
      allUsers.forEach((u) => {
        if (!u) return;
        const uEmail = (u.email || '').toLowerCase();
        const uUid = u.uid || `user_${Math.random().toString(36).substring(2, 9)}`;
        const uDisplayName = u.displayName || (u.email ? u.email.split('@')[0] : 'User');

        if (u.role === 'event_manager') {
          managersMap.set(uUid, {
            ownerUid: uUid,
            email: u.email || 'manager@system.local',
            displayName: uDisplayName,
            eventsCount: u.assignedEvents?.length || 0,
            totalAttendees: 0,
            totalPhotos: 0
          });
        } else if (u.role === 'photographer' && uEmail) {
          photographersMap.set(uEmail, {
            email: u.email,
            uid: uUid,
            assignedEventsCount: u.assignedEvents?.length || 0,
            assignedEventNames: [],
            totalPhotosUploaded: allPhotos.filter((p) => p.uploadedBy === uUid).length
          });
        }
      });

      // Augment events with counts
      const enhancedEvents: EventItem[] = events.map((ev) => {
        if (!ev) return ev;
        const evId = ev.id || '';
        const evPhotos = allPhotos.filter((p) => p.eventId === evId || p.event_id === evId);
        const evAttendees = allAttendees.filter((a) => a.eventId === evId || a.event_id === evId);

        const safeOwnerUid = ev.ownerUid || 'unknown';
        const managerKey = safeOwnerUid;
        const existingMgr = managersMap.get(managerKey);
        if (existingMgr) {
          existingMgr.eventsCount = Math.max(existingMgr.eventsCount, 1);
          existingMgr.totalAttendees += evAttendees.length;
          existingMgr.totalPhotos += evPhotos.length;
          if (ev.createdAt && ev.createdAt > (existingMgr.lastEventDate || '')) {
            existingMgr.lastEventDate = ev.createdAt;
          }
        } else {
          managersMap.set(managerKey, {
            ownerUid: safeOwnerUid,
            email: ev.ownerEmail || `manager_${safeOwnerUid.slice(0, 6)}@system.internal`,
            displayName: ev.ownerEmail ? ev.ownerEmail.split('@')[0] : `Manager ${safeOwnerUid.slice(0, 6)}`,
            eventsCount: 1,
            totalAttendees: evAttendees.length,
            totalPhotos: evPhotos.length,
            lastEventDate: ev.createdAt || new Date().toISOString()
          });
        }

        // Photographers
        if (ev.assignedPhotographers && Array.isArray(ev.assignedPhotographers) && ev.assignedPhotographers.length > 0) {
          ev.assignedPhotographers.forEach((p) => {
            if (!p || !p.email) return;
            const pKey = p.email.toLowerCase().trim();
            const existingPhotog = photographersMap.get(pKey);
            const evName = ev.name || 'Untitled Event';
            if (existingPhotog) {
              if (!existingPhotog.assignedEventNames) existingPhotog.assignedEventNames = [];
              if (!existingPhotog.assignedEventNames.includes(evName)) {
                existingPhotog.assignedEventNames.push(evName);
              }
              existingPhotog.assignedEventsCount = existingPhotog.assignedEventNames.length;
            } else {
              photographersMap.set(pKey, {
                email: p.email,
                uid: p.uid || pKey,
                assignedEventsCount: 1,
                assignedEventNames: [evName],
                totalPhotosUploaded: allPhotos.filter((ph) => ph.uploadedByEmail?.toLowerCase() === pKey).length
              });
            }
          });
        }

        return {
          ...ev,
          counts: {
            attendees: evAttendees.length,
            photos: evPhotos.length,
            processed: evPhotos.filter((p) => p.status === 'processed').length
          }
        };
      });

      const metrics: PlatformMetrics = {
        totalEvents: enhancedEvents.length,
        totalAttendees: allAttendees.length,
        totalPhotos: allPhotos.length,
        photoConsentCount,
        photoConsentPercentage: consentPercentage,
        totalManagers: managersMap.size,
        totalPhotographers: photographersMap.size
      };

      const eventMap = new Map<string, string>();
      events.forEach((e) => eventMap.set(e.id, e.name));

      const photosWithEventNames = allPhotos.map((p) => ({
        ...p,
        eventName: p.eventName || eventMap.get(p.eventId) || eventMap.get(p.event_id || '') || 'Event ' + p.eventId
      }));

      const overviewResult = {
        metrics,
        events: enhancedEvents,
        managers: Array.from(managersMap.values()),
        photographers: Array.from(photographersMap.values()),
        allPhotos: photosWithEventNames,
        allUsers
      };

      cachedOverview = {
        data: overviewResult,
        timestamp: Date.now()
      };

      return overviewResult;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, 'events_overview');
      throw err;
    }
  },

  async initializeDatabase(adminUid: string, adminEmail: string) {
    return await eventService.initializeAndSeedDatabase(adminUid, adminEmail);
  },

  async wipeAllData() {
    return await eventService.wipeAllData();
  },

  async resetDemoToScratch(adminUid: string, adminEmail: string) {
    return await eventService.resetDemoToScratch(adminUid, adminEmail);
  },

  async deleteEventAsAdmin(eventId: string): Promise<void> {
    const eventRef = doc(db, 'events', eventId);
    try {
      // 1. Delete associated photos from root /photos
      const photosSnap = await getDocs(query(collection(db, 'photos'), where('eventId', '==', eventId)));
      for (const d of photosSnap.docs) {
        await deleteDoc(d.ref);
      }

      // 2. Delete associated attendees from root /attendees
      const attSnap = await getDocs(query(collection(db, 'attendees'), where('eventId', '==', eventId)));
      for (const d of attSnap.docs) {
        await deleteDoc(d.ref);
      }

      // 3. Delete event subcollections
      const legacyPhotos = await getDocs(collection(db, 'events', eventId, 'photos'));
      for (const d of legacyPhotos.docs) {
        await deleteDoc(d.ref);
      }
      const legacyAtt = await getDocs(collection(db, 'events', eventId, 'attendees'));
      for (const d of legacyAtt.docs) {
        await deleteDoc(d.ref);
      }

      // 4. Delete event doc
      await deleteDoc(eventRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `events/${eventId}`);
    }
  }
};
