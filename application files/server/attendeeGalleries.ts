import { createHash, createHmac } from 'node:crypto';
import type { Express, Response } from 'express';
import { crc32 } from 'node:zlib';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  AuthenticatedRequest,
  FirebaseAdminConfig,
  authenticate,
  canManageEvent,
  getAdminServices,
  normalizeEmail
} from './firebaseAdmin';

interface GalleryConfig extends FirebaseAdminConfig {
  appBaseUrl: string;
  emailFrom: string;
  galleryTokenSecret: string;
  resendApiKey: string;
  storageBucket: string;
}

interface GalleryRecord {
  attendeeId: string;
  attendeeName: string;
  email: string;
  eventId: string;
  eventName: string;
  expiresAt: Timestamp;
  photoIds: string[];
  snapshotHash: string;
  status: 'active';
  tokenHash: string;
}

interface DeliveryCandidate {
  attendeeId: string;
  deliveryId: string;
  email: string;
  galleryLink: string;
  photoCount: number;
}

const GALLERY_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_BATCH_SIZE = 100;

class UserFacingError extends Error {}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cleanFilename(value: unknown, fallback: string): string {
  const cleaned = typeof value === 'string' ? value.replace(/[^a-zA-Z0-9._ -]/g, '_').trim() : '';
  return cleaned || fallback;
}

function zipDateTime(date = new Date()) {
  const year = Math.max(1980, Math.min(2107, date.getFullYear()));
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function localZipHeader(name: Buffer, size: number, checksum: number, date: number, time: number) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(size, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}

function centralZipHeader(
  name: Buffer,
  size: number,
  checksum: number,
  offset: number,
  date: number,
  time: number
) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
}

function endOfCentralDirectory(entries: number, centralSize: number, centralOffset: number) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

async function writeResponse(res: Response, data: Buffer) {
  if (res.write(data)) return;
  await new Promise<void>((resolve) => res.once('drain', resolve));
}

function galleryToken(config: GalleryConfig, eventId: string, attendeeId: string, snapshotHash: string) {
  if (config.galleryTokenSecret.length < 32) {
    throw new UserFacingError('Gallery delivery is not configured. Set GALLERY_TOKEN_SECRET to at least 32 characters.');
  }
  return createHmac('sha256', config.galleryTokenSecret)
    .update(`${eventId}:${attendeeId}:${snapshotHash}`)
    .digest('base64url');
}

function galleryLink(config: GalleryConfig, token: string): string {
  let url: URL;
  try {
    url = new URL(config.appBaseUrl);
  } catch {
    throw new UserFacingError('APP_BASE_URL must be a valid absolute URL.');
  }
  const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocal) {
    throw new UserFacingError('APP_BASE_URL must use HTTPS outside local development.');
  }
  url.searchParams.set('gallery', token);
  return url.toString();
}

function isValidEmail(email: string) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendBatch(config: GalleryConfig, eventName: string, candidates: DeliveryCandidate[]) {
  const emails = candidates.map((candidate) => ({
    from: config.emailFrom,
    to: [candidate.email],
    subject: `Your photos from ${eventName} are ready`,
    html: `
      <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a">
        <div style="max-width:560px;margin:auto;background:white;border:1px solid #e2e8f0;border-radius:18px;padding:32px">
          <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#4f46e5;text-transform:uppercase">Masquerade</div>
          <h1 style="font-size:24px;line-height:1.25;margin:12px 0">Your event photos are ready</h1>
          <p style="font-size:15px;line-height:1.6;color:#475569">
            We found ${candidate.photoCount} ${candidate.photoCount === 1 ? 'photo' : 'photos'} of you from
            <strong>${escapeHtml(eventName)}</strong>.
          </p>
          <p style="margin:28px 0">
            <a href="${escapeHtml(candidate.galleryLink)}" style="display:inline-block;background:#4f46e5;color:white;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:700">
              View and download your photos
            </a>
          </p>
          <p style="font-size:12px;line-height:1.5;color:#64748b">
            This private link expires in 30 days.
          </p>
        </div>
      </div>
    `,
    text: [
      `Your photos from ${eventName} are ready.`,
      `We found ${candidate.photoCount} ${candidate.photoCount === 1 ? 'photo' : 'photos'} of you.`,
      `View and download them: ${candidate.galleryLink}`,
      'This private link expires in 30 days.'
    ].join('\n\n')
  }));

  const idempotencyKey = `gallery-release/${hash(candidates.map((item) => item.deliveryId).join(':')).slice(0, 32)}`;
  const response = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(emails)
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: Array<{ id?: string }>;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(body.message || `Resend returned HTTP ${response.status}`);
  }
  return Array.isArray(body.data) ? body.data : [];
}

async function loadGallery(config: GalleryConfig, token: string): Promise<GalleryRecord> {
  if (!/^[a-zA-Z0-9_-]{40,100}$/.test(token)) {
    throw new UserFacingError('This gallery link is invalid.');
  }
  const { db } = getAdminServices(config);
  const snapshot = await db.collection('attendeeGalleries').doc(hash(token)).get();
  if (!snapshot.exists) {
    throw new UserFacingError('This gallery link is invalid or has been replaced.');
  }
  const gallery = snapshot.data() as GalleryRecord;
  if (gallery.status !== 'active' || gallery.tokenHash !== hash(token)) {
    throw new UserFacingError('This gallery is no longer active.');
  }
  if (!(gallery.expiresAt instanceof Timestamp) || gallery.expiresAt.toMillis() <= Date.now()) {
    throw new UserFacingError('This gallery link has expired. Ask the event manager to release it again.');
  }
  return gallery;
}

async function loadGalleryPhotos(config: GalleryConfig, gallery: GalleryRecord) {
  const { db } = getAdminServices(config);
  const refs = gallery.photoIds.map((photoId) => db.collection('photos').doc(photoId));
  if (refs.length === 0) return [];
  const snapshots = await db.getAll(...refs);
  return snapshots.flatMap((snapshot) => {
    if (!snapshot.exists) return [];
    const data = snapshot.data()!;
    const matchedAttendees = Array.isArray(data.matchedAttendees) ? data.matchedAttendees : [];
    if (
      data.eventId !== gallery.eventId ||
      data.status !== 'processed' ||
      !matchedAttendees.includes(gallery.attendeeId)
    ) {
      return [];
    }
    const storagePath = typeof data.rawStoragePath === 'string' && data.rawStoragePath
      ? data.rawStoragePath
      : data.storagePath;
    const allowedPrefixes = [
      `photographers/${gallery.eventId}/`,
      `events/${gallery.eventId}/photos/`
    ];
    if (
      typeof storagePath !== 'string' ||
      storagePath.includes('..') ||
      !allowedPrefixes.some((prefix) => storagePath.startsWith(prefix))
    ) {
      return [];
    }
    return [{
      fileName: cleanFilename(data.fileName, `${snapshot.id}.jpg`),
      id: snapshot.id,
      storagePath
    }];
  });
}

function sendGalleryError(res: Response, error: unknown) {
  const message = error instanceof UserFacingError ? error.message : 'The gallery could not be loaded.';
  const status = error instanceof UserFacingError ? 404 : 500;
  if (!(error instanceof UserFacingError)) console.error('Attendee gallery error:');
  return res.status(status).json({ error: message });
}

export function registerAttendeeGalleryRoutes(app: Express, config: GalleryConfig) {
  const requireAuth = authenticate(config);

  app.post('/api/attendee-galleries/release', requireAuth, async (req: AuthenticatedRequest, res) => {
    const eventId = typeof req.body.eventId === 'string' ? req.body.eventId.trim() : '';
    if (!eventId || eventId.includes('/') || eventId.length > 200) {
      return res.status(400).json({ error: 'A valid event is required.' });
    }
    if (!config.resendApiKey || !config.emailFrom || !config.appBaseUrl) {
      return res.status(500).json({
        error: 'Email delivery is not configured. Set RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL.'
      });
    }

    try {
      const { db } = getAdminServices(config);
      const eventSnapshot = await db.collection('events').doc(eventId).get();
      if (!eventSnapshot.exists) return res.status(404).json({ error: 'Event not found.' });
      const eventData = eventSnapshot.data()!;
      if (!(await canManageEvent(db, req.firebaseUser!, eventData))) {
        return res.status(403).json({ error: 'Only the event owner can release attendee galleries.' });
      }

      const [attendeeSnapshots, photoSnapshots] = await Promise.all([
        db.collection('attendees').where('eventId', '==', eventId).get(),
        db.collection('photos').where('eventId', '==', eventId).get()
      ]);
      const photoIdsByAttendee = new Map<string, Set<string>>();
      for (const photo of photoSnapshots.docs) {
        const data = photo.data();
        if (data.status !== 'processed' || !Array.isArray(data.matchedAttendees)) continue;
        for (const attendeeId of data.matchedAttendees) {
          if (typeof attendeeId !== 'string' || !attendeeId) continue;
          const photoIds = photoIdsByAttendee.get(attendeeId) || new Set<string>();
          photoIds.add(photo.id);
          photoIdsByAttendee.set(attendeeId, photoIds);
        }
      }

      const eventName = typeof eventData.name === 'string' ? eventData.name : 'your event';
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + GALLERY_LIFETIME_MS);
      const candidates: DeliveryCandidate[] = [];
      let skipped = 0;

      for (const attendeeSnapshot of attendeeSnapshots.docs) {
        const attendee = attendeeSnapshot.data();
        const email = normalizeEmail(attendee.email);
        const photoIds = Array.from(photoIdsByAttendee.get(attendeeSnapshot.id) || []).sort();
        if (attendee.photoConsentGiven !== true || !isValidEmail(email) || photoIds.length === 0) continue;

        const snapshotHash = hash(photoIds.join(':'));
        const deliveryId = hash(`${eventId}:${attendeeSnapshot.id}:${snapshotHash}`);
        const deliveryRef = db.collection('attendeeGalleryDeliveries').doc(deliveryId);
        const priorDelivery = await deliveryRef.get();
        if (priorDelivery.exists && priorDelivery.data()?.status === 'sent') {
          skipped += 1;
          continue;
        }

        const token = galleryToken(config, eventId, attendeeSnapshot.id, snapshotHash);
        const tokenHash = hash(token);
        const gallery: GalleryRecord = {
          attendeeId: attendeeSnapshot.id,
          attendeeName: typeof attendee.fullName === 'string' ? attendee.fullName : 'Attendee',
          email,
          eventId,
          eventName,
          expiresAt,
          photoIds,
          snapshotHash,
          status: 'active',
          tokenHash
        };
        const batch = db.batch();
        batch.set(db.collection('attendeeGalleries').doc(tokenHash), {
          ...gallery,
          createdAt: now,
          updatedAt: now
        });
        batch.set(deliveryRef, {
          attendeeId: attendeeSnapshot.id,
          email,
          eventId,
          eventName,
          expiresAt,
          galleryId: tokenHash,
          photoCount: photoIds.length,
          snapshotHash,
          status: 'pending',
          updatedAt: now,
          createdAt: priorDelivery.exists ? priorDelivery.data()?.createdAt || now : now
        });
        await batch.commit();
        candidates.push({
          attendeeId: attendeeSnapshot.id,
          deliveryId,
          email,
          galleryLink: galleryLink(config, token),
          photoCount: photoIds.length
        });
      }

      let sent = 0;
      let failed = 0;
      for (let start = 0; start < candidates.length; start += MAX_BATCH_SIZE) {
        const chunk = candidates.slice(start, start + MAX_BATCH_SIZE);
        try {
          const providerResults = await sendBatch(config, eventName, chunk);
          const batch = db.batch();
          chunk.forEach((candidate, index) => {
            batch.update(db.collection('attendeeGalleryDeliveries').doc(candidate.deliveryId), {
              providerMessageId: providerResults[index]?.id || null,
              sentAt: Timestamp.now(),
              status: 'sent',
              updatedAt: Timestamp.now()
            });
          });
          await batch.commit();
          sent += chunk.length;
        } catch (error) {
          console.error('Gallery email batch failed:');
          const batch = db.batch();
          chunk.forEach((candidate) => {
            batch.update(db.collection('attendeeGalleryDeliveries').doc(candidate.deliveryId), {
              error: 'Delivery failed. Check service logs and retry.',
              status: 'failed',
              updatedAt: Timestamp.now()
            });
          });
          await batch.commit();
          failed += chunk.length;
        }
      }

      return res.json({
        success: failed === 0,
        eligible: candidates.length + skipped,
        failed,
        sent,
        skipped
      });
    } catch (error) {
      console.error('Could not release attendee galleries:');
      const message = error instanceof UserFacingError ? error.message : 'Could not release attendee galleries.';
      return res.status(500).json({ error: message });
    }
  });

  app.get('/api/attendee-galleries/:token', async (req, res) => {
    try {
      const gallery = await loadGallery(config, req.params.token);
      const photos = await loadGalleryPhotos(config, gallery);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        attendeeName: gallery.attendeeName,
        eventName: gallery.eventName,
        expiresAt: gallery.expiresAt.toDate().toISOString(),
        downloadAllUrl: `/api/attendee-galleries/${encodeURIComponent(req.params.token)}/download-all`,
        photos: photos.map((photo) => ({
          id: photo.id,
          fileName: photo.fileName,
          viewUrl: `/api/attendee-galleries/${encodeURIComponent(req.params.token)}/photos/${encodeURIComponent(photo.id)}`,
          downloadUrl: `/api/attendee-galleries/${encodeURIComponent(req.params.token)}/photos/${encodeURIComponent(photo.id)}?download=1`
        }))
      });
    } catch (error) {
      return sendGalleryError(res, error);
    }
  });

  app.get('/api/attendee-galleries/:token/photos/:photoId', async (req, res) => {
    try {
      const gallery = await loadGallery(config, req.params.token);
      const photos = await loadGalleryPhotos(config, gallery);
      const photo = photos.find((item) => item.id === req.params.photoId);
      if (!photo) throw new UserFacingError('This photo is not available in your gallery.');
      const file = getStorage(getAdminServices(config).app).bucket(config.storageBucket).file(photo.storagePath);
      const [metadata] = await file.getMetadata();
      const [bytes] = await file.download();
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="${photo.fileName.replaceAll('"', '_')}"`);
      }
      return res.send(bytes);
    } catch (error) {
      return sendGalleryError(res, error);
    }
  });

  app.get('/api/attendee-galleries/:token/download-all', async (req, res) => {
    try {
      const gallery = await loadGallery(config, req.params.token);
      const photos = await loadGalleryPhotos(config, gallery);
      if (photos.length === 0) throw new UserFacingError('There are no downloadable photos in this gallery.');

      const bucket = getStorage(getAdminServices(config).app).bucket(config.storageBucket);
      const files = await Promise.all(
        photos.map(async (photo, index) => {
          const cloudFile = bucket.file(photo.storagePath);
          const [metadata] = await cloudFile.getMetadata();
          const size = Number(metadata.size);
          if (!Number.isSafeInteger(size) || size < 0 || size > 0xffffffff) {
            throw new UserFacingError(`The file ${photo.fileName} is too large to include in a ZIP.`);
          }
          const name = Buffer.from(`${String(index + 1).padStart(3, '0')}_${photo.fileName}`, 'utf8');
          return { cloudFile, name, size };
        })
      );
      const totalSize = files.reduce((total, file) => total + 30 + file.name.length + file.size + 46 + file.name.length, 22);
      if (files.length > 0xffff || totalSize > 0xffffffff) {
        throw new UserFacingError('This gallery is too large for one ZIP download. Download the photos individually.');
      }

      const zipName = cleanFilename(`${gallery.eventName}_photos.zip`, 'event_photos.zip');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
      res.setHeader('Content-Length', String(totalSize));

      const centralHeaders: Buffer[] = [];
      const { date, time } = zipDateTime();
      let offset = 0;
      for (const file of files) {
        const [bytes] = await file.cloudFile.download();
        if (bytes.length !== file.size) throw new Error('Cloud Storage returned an unexpected file size.');
        const checksum = crc32(bytes) >>> 0;
        const localHeader = localZipHeader(file.name, file.size, checksum, date, time);
        centralHeaders.push(centralZipHeader(file.name, file.size, checksum, offset, date, time));
        await writeResponse(res, localHeader);
        await writeResponse(res, bytes);
        offset += localHeader.length + bytes.length;
      }
      const centralOffset = offset;
      for (const centralHeader of centralHeaders) {
        await writeResponse(res, centralHeader);
        offset += centralHeader.length;
      }
      await writeResponse(res, endOfCentralDirectory(files.length, offset - centralOffset, centralOffset));
      res.end();
    } catch (error) {
      if (!res.headersSent) return sendGalleryError(res, error);
      res.destroy(error instanceof Error ? error : undefined);
    }
  });
}
