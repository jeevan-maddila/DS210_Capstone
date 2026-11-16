import type { NextFunction, Request, Response } from 'express';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAuth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirestore } from 'firebase-admin/firestore';

export interface FirebaseAdminConfig {
  databaseId: string;
  projectId: string;
}

export interface AuthenticatedRequest extends Request {
  firebaseUser?: DecodedIdToken;
}

const SPECIAL_ADMIN_EMAIL = 'thomas.leffler2@gmail.com';

let cachedServices:
  | {
      app: ReturnType<typeof initializeApp>;
      auth: ReturnType<typeof getAuth>;
      db: Firestore;
    }
  | null = null;

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function getAdminServices(config: FirebaseAdminConfig) {
  if (cachedServices) return cachedServices;

  const app =
    getApps()[0] ||
    initializeApp({
      credential: applicationDefault(),
      projectId: config.projectId
    });

  cachedServices = {
    app,
    auth: getAuth(app),
    db: getFirestore(app, config.databaseId)
  };
  return cachedServices;
}

function bearerToken(req: Request): string | null {
  const authorization = req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

export function authenticate(config: FirebaseAdminConfig) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const token = bearerToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Authentication is required.' });
    }

    try {
      req.firebaseUser = await getAdminServices(config).auth.verifyIdToken(token);
      return next();
    } catch (error) {
      console.warn('Server authentication failed:', error);
      return res.status(401).json({ error: 'Your session is invalid or expired. Please sign in again.' });
    }
  };
}

export async function canManageEvent(
  db: Firestore,
  user: DecodedIdToken,
  eventData: FirebaseFirestore.DocumentData
) {
  if (eventData.ownerUid === user.uid) return true;
  if (normalizeEmail(user.email) === SPECIAL_ADMIN_EMAIL) return true;

  const adminDoc = await db.collection('admins').doc(user.uid).get();
  return adminDoc.exists;
}
