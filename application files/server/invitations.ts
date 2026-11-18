import { createHash, randomBytes } from 'node:crypto';
import type { Express } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  AuthenticatedRequest,
  authenticate,
  canManageEvent,
  getAdminServices,
  normalizeEmail
} from './firebaseAdmin';

interface InvitationConfig {
  appBaseUrl: string;
  databaseId: string;
  emailFrom: string;
  projectId: string;
  resendApiKey: string;
}

interface InvitationRecord {
  eventId: string;
  eventName: string;
  normalizedEmail: string;
  invitedByUid: string;
  invitedByEmail: string;
  tokenHash: string;
  status: 'pending' | 'accepted' | 'revoked' | 'failed';
  deliveryStatus: 'sending' | 'sent' | 'failed';
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  acceptedAt?: Timestamp;
  acceptedByUid?: string;
  providerMessageId?: string;
}

interface AssignedPhotographer {
  email: string;
  inviteStatus: 'pending' | 'active';
  uid?: string;
  assignedAt?: string;
}

const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
class UserFacingError extends Error {}

function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function invitationId(eventId: string, email: string): string {
  return hash(`${eventId}:${email}`);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function inviteUrl(config: InvitationConfig, token: string): string {
  if (!config.appBaseUrl) {
    throw new UserFacingError('Email delivery is not configured. Set APP_BASE_URL.');
  }

  let url: URL;
  try {
    url = new URL(config.appBaseUrl);
  } catch {
    throw new UserFacingError('APP_BASE_URL must be a valid absolute URL.');
  }
  const isLocalUrl = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalUrl) {
    throw new UserFacingError('APP_BASE_URL must use HTTPS outside local development.');
  }
  url.searchParams.set('portal', 'photographer');
  url.hash = new URLSearchParams({ invite: token }).toString();
  return url.toString();
}

async function sendInvitationEmail(
  config: InvitationConfig,
  recipient: string,
  eventName: string,
  managerName: string,
  link: string
): Promise<string | undefined> {
  if (!config.resendApiKey || !config.emailFrom || !config.appBaseUrl) {
    throw new UserFacingError(
      'Email delivery is not configured. Set RESEND_API_KEY, EMAIL_FROM, and APP_BASE_URL.'
    );
  }

  const safeEventName = escapeHtml(eventName);
  const safeManagerName = escapeHtml(managerName);
  const safeLink = escapeHtml(link);
  const subjectEventName = eventName.replace(/[\r\n]+/g, ' ').trim();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `photographer-invite/${hash(link).slice(0, 32)}`
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [recipient],
      subject: `You're invited to photograph ${subjectEventName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1e293b">
          <h2>You're invited to photograph ${safeEventName}</h2>
          <p>${safeManagerName} invited you to join the event as a photographer.</p>
          <p>Use the button below, then sign in with <strong>${escapeHtml(recipient)}</strong>.</p>
          <p style="margin:28px 0">
            <a href="${safeLink}" style="background:#4f46e5;color:white;padding:12px 20px;border-radius:8px;text-decoration:none">
              Open photographer portal
            </a>
          </p>
          <p style="font-size:12px;color:#64748b">This invitation expires in 7 days and can only be used by the invited email address.</p>
        </div>
      `,
      text: [
        `You're invited to photograph ${eventName}.`,
        `${managerName} invited you to join this event as a photographer.`,
        `Open the invitation: ${link}`,
        `Sign in with ${recipient} to accept it. This invitation expires in 7 days.`
      ].join('\n\n')
    })
  });

  const responseBody = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) {
    console.error('Resend invitation delivery failed; HTTP status:', response.status);
    throw new UserFacingError(
      'The invitation email could not be sent. Check the sender configuration and try again.'
    );
  }
  return responseBody.id;
}

export function registerInvitationRoutes(app: Express, config: InvitationConfig) {
  const requireAuth = authenticate(config);

  app.post('/api/photographer-invitations', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.firebaseUser!;
    const eventId = typeof req.body.eventId === 'string' ? req.body.eventId.trim() : '';
    const email = normalizeEmail(req.body.email);

    if (!eventId || eventId.includes('/') || eventId.length > 200 || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid event and photographer email are required.' });
    }

    try {
      const { db } = getAdminServices(config);
      const eventRef = db.collection('events').doc(eventId);
      const eventSnapshot = await eventRef.get();
      if (!eventSnapshot.exists) {
        return res.status(404).json({ error: 'Event not found.' });
      }

      const eventData = eventSnapshot.data()!;
      if (!(await canManageEvent(db, user, eventData))) {
        return res.status(403).json({ error: 'Only the event owner can invite photographers.' });
      }

      const activePhotographers = (eventData.assignedPhotographers || []) as AssignedPhotographer[];
      if (
        activePhotographers.some(
          (photographer) =>
            normalizeEmail(photographer.email) === email && photographer.inviteStatus === 'active'
        )
      ) {
        return res.status(409).json({ error: 'This photographer is already assigned to the event.' });
      }

      // Remove records created by the old unsigned-link flow before issuing a
      // secure invitation. Pending users must not gain access through an email
      // stored directly on the public event document.
      const legacyPendingAssignments = activePhotographers.filter(
        (photographer) =>
          normalizeEmail(photographer.email) === email && photographer.inviteStatus === 'pending'
      );
      if (legacyPendingAssignments.length > 0) {
        await eventRef.update({
          assignedPhotographers: FieldValue.arrayRemove(...legacyPendingAssignments),
          photographerEmails: FieldValue.arrayRemove(email)
        });
      }

      const token = randomBytes(32).toString('base64url');
      const now = Timestamp.now();
      const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITATION_LIFETIME_MS);
      const eventName = typeof eventData.name === 'string' ? eventData.name : 'your event';
      const managerName = typeof user.name === 'string' ? user.name : normalizeEmail(user.email) || 'An event manager';
      const ref = db.collection('photographerInvitations').doc(invitationId(eventId, email));

      const invitation: InvitationRecord = {
        eventId,
        eventName,
        normalizedEmail: email,
        invitedByUid: user.uid,
        invitedByEmail: normalizeEmail(user.email),
        tokenHash: hash(token),
        status: 'pending',
        deliveryStatus: 'sending',
        createdAt: now,
        updatedAt: now,
        expiresAt
      };
      await ref.set(invitation);

      try {
        const providerMessageId = await sendInvitationEmail(
          config,
          email,
          eventName,
          managerName,
          inviteUrl(config, token)
        );
        await ref.update({
          deliveryStatus: 'sent',
          providerMessageId: providerMessageId || null,
          updatedAt: Timestamp.now()
        });
      } catch (emailError) {
        await ref.update({
          status: 'failed',
          deliveryStatus: 'failed',
          updatedAt: Timestamp.now()
        });
        throw emailError;
      }

      return res.status(201).json({
        success: true,
        message: `Invitation sent to ${email}.`,
        email,
        invitation: {
          id: ref.id,
          email,
          status: 'pending',
          expiresAt: expiresAt.toDate().toISOString()
        }
      });
    } catch (error) {
      console.error('Could not create photographer invitation:');
      const message =
        error instanceof UserFacingError ? error.message : 'Could not send the invitation. Please try again.';
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/photographer-invitations/accept', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.firebaseUser!;
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    const userEmail = normalizeEmail(user.email);

    if (!token || !userEmail) {
      return res.status(400).json({ error: 'A valid invitation and signed-in email are required.' });
    }

    try {
      const { db } = getAdminServices(config);
      const matches = await db
        .collection('photographerInvitations')
        .where('tokenHash', '==', hash(token))
        .limit(1)
        .get();
      if (matches.empty) {
        return res.status(404).json({ error: 'This invitation is invalid or has been replaced.' });
      }

      const invitationRef = matches.docs[0].ref;
      const result = await db.runTransaction(async (transaction) => {
        const invitationSnapshot = await transaction.get(invitationRef);
        const invitation = invitationSnapshot.data() as InvitationRecord;

        if (invitation.tokenHash !== hash(token)) {
          throw new UserFacingError('This invitation has been replaced.');
        }
        if (invitation.status === 'accepted' && invitation.acceptedByUid === user.uid) {
          return { eventId: invitation.eventId, email: invitation.normalizedEmail };
        }
        if (invitation.status !== 'pending') {
          throw new UserFacingError('This invitation is no longer active.');
        }
        if (invitation.expiresAt.toMillis() <= Date.now()) {
          throw new UserFacingError('This invitation has expired.');
        }
        if (invitation.normalizedEmail !== userEmail) {
          throw new UserFacingError(
            `This invitation was sent to ${invitation.normalizedEmail}. Sign in with that email to continue.`
          );
        }

        const eventRef = db.collection('events').doc(invitation.eventId);
        const userRef = db.collection('users').doc(user.uid);
        const eventSnapshot = await transaction.get(eventRef);
        const userSnapshot = await transaction.get(userRef);
        if (userSnapshot.data()?.accountState === 'deleting') {
          throw new UserFacingError('This account is being deleted and cannot accept invitations.');
        }
        if (!eventSnapshot.exists) {
          throw new UserFacingError('The invited event no longer exists.');
        }

        const eventData = eventSnapshot.data()!;
        const existingPhotographers = (eventData.assignedPhotographers || []) as AssignedPhotographer[];
        const priorAssignment = existingPhotographers.find(
          (photographer) => normalizeEmail(photographer.email) === userEmail
        );
        const assignedPhotographers = existingPhotographers.filter(
          (photographer) => normalizeEmail(photographer.email) !== userEmail && photographer.uid !== user.uid
        );
        assignedPhotographers.push({
          email: userEmail,
          uid: user.uid,
          inviteStatus: 'active',
          assignedAt: priorAssignment?.assignedAt || new Date().toISOString()
        });

        const photographerEmails = Array.from(
          new Set([...(eventData.photographerEmails || []).map(normalizeEmail), userEmail].filter(Boolean))
        );
        const photographerUids = Array.from(new Set([...(eventData.photographerUids || []), user.uid]));
        transaction.update(eventRef, { assignedPhotographers, photographerEmails, photographerUids });

        if (userSnapshot.exists) {
          const profile = userSnapshot.data()!;
          const assignedEvents = Array.from(new Set([...(profile.assignedEvents || []), invitation.eventId]));
          const updates: Record<string, unknown> = { assignedEvents, inviteStatus: 'active' };
          if (!['event_manager', 'super_admin'].includes(profile.role)) updates.role = 'photographer';
          transaction.update(userRef, updates);
        } else {
          transaction.set(userRef, {
            uid: user.uid,
            email: userEmail,
            displayName: typeof user.name === 'string' ? user.name : userEmail,
            role: 'photographer',
            assignedEvents: [invitation.eventId],
            inviteStatus: 'active',
            createdAt: new Date().toISOString()
          });
        }

        transaction.update(invitationRef, {
          status: 'accepted',
          acceptedAt: Timestamp.now(),
          acceptedByUid: user.uid,
          updatedAt: Timestamp.now()
        });

        return { eventId: invitation.eventId, email: invitation.normalizedEmail };
      });

      return res.json({ success: true, message: 'Invitation accepted.', ...result });
    } catch (error) {
      console.warn('Could not accept photographer invitation:');
      const message =
        error instanceof UserFacingError ? error.message : 'Could not accept the invitation. Please try again.';
      return res.status(400).json({ error: message });
    }
  });

}
