import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { registerInvitationRoutes } from './server/invitations';
import { registerAttendeeGalleryRoutes } from './server/attendeeGalleries';
import { registerAdminAccountRoutes } from './server/adminAccounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env.local') });
dotenv.config({ path: path.join(__dirname, '.env') });

const GCP_PROJECT_ID = process.env.GCP_PROJECT_ID || 'mids-capstone-ajt';
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'ai-studio-a1858ef2-f062-409f-aaff-1218861a9484';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET || 'mids-capstone-ajt.firebasestorage.app';

async function startServer() {
  const app = express();
  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    return res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  registerAdminAccountRoutes(app, { projectId: GCP_PROJECT_ID, databaseId: FIRESTORE_DATABASE_ID });

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

  // Vite dev middleware or static production serve
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
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
