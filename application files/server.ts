import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { registerInvitationRoutes } from './server/invitations';
import { registerAttendeeGalleryRoutes } from './server/attendeeGalleries';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config({ path: path.join(__dirname, '.env') });

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'mids-capstone-ajt';
const GCP_REGION = process.env.GCP_REGION || 'us-east1';
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-a1858ef2-f062-409f-aaff-1218861a9484';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'mids-capstone-ajt.firebasestorage.app';

async function startServer() {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    return res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Cloud Run Jobs Pipeline Status Endpoint
  app.get('/api/jobs/status', (_req, res) => {
    return res.json({
      status: 'cloud_ready',
      cloudRunConfig: {
        projectId: GCP_PROJECT_ID,
        region: GCP_REGION,
        databaseId: FIRESTORE_DATABASE_ID,
        job1: 'embed-checkins',
        job2: 'match-photos',
        eventarcTopic: 'photo-upload-events'
      }
    });
  });

  registerInvitationRoutes(app, {
    appBaseUrl: process.env.APP_BASE_URL || '',
    databaseId: FIRESTORE_DATABASE_ID,
    emailFrom: process.env.EMAIL_FROM || '',
    projectId: GCP_PROJECT_ID,
    resendApiKey: process.env.RESEND_API_KEY || ''
  });

  registerAttendeeGalleryRoutes(app, {
    appBaseUrl: process.env.APP_BASE_URL || '',
    databaseId: FIRESTORE_DATABASE_ID,
    emailFrom: process.env.EMAIL_FROM || '',
    galleryTokenSecret:
      process.env.GALLERY_TOKEN_SECRET ||
      (process.env.NODE_ENV !== 'production' && process.env.RESEND_API_KEY
        ? `local-gallery:${process.env.RESEND_API_KEY}`
        : ''),
    projectId: GCP_PROJECT_ID,
    resendApiKey: process.env.RESEND_API_KEY || '',
    storageBucket: STORAGE_BUCKET
  });

  // Run Task 1 (embed-checkins)
  app.post('/api/jobs/run-task1', (req, res) => {
    const { eventId, attendeeId } = req.body;
    const cmd = `gcloud run jobs execute embed-checkins --region ${GCP_REGION}${eventId ? ` --args="--event-id=${eventId}"` : ''}`;
    return res.json({
      success: true,
      message: `Trigger request logged for embed-checkins (Job 1) in region ${GCP_REGION}`,
      command: cmd,
      eventId: eventId || 'all',
      attendeeId: attendeeId || null,
      timestamp: new Date().toISOString()
    });
  });

  // Run Task 2 (match-photos)
  app.post('/api/jobs/run-task2', (req, res) => {
    const { eventId, photoId } = req.body;
    const cmd = `gcloud run jobs execute match-photos --region ${GCP_REGION}${eventId ? ` --args="--event-id=${eventId}"` : ''}`;
    return res.json({
      success: true,
      message: `Trigger request logged for match-photos (Job 2) in region ${GCP_REGION}`,
      command: cmd,
      eventId: eventId || 'all',
      photoId: photoId || null,
      timestamp: new Date().toISOString()
    });
  });

  // Vite dev middleware or static production serve
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
