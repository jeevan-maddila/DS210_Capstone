import type { Express, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminServices, normalizeEmail, type AuthenticatedRequest, type FirebaseAdminConfig } from './firebaseAdmin';

const OWNER_EMAIL = 'thomas.leffler2@gmail.com';
const ROLES = ['event_manager', 'photographer', 'super_admin'] as const;
type Role = typeof ROLES[number];
type Services = ReturnType<typeof getAdminServices>;
class AccountError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('/')) {
    throw new AccountError(400, 'A valid account or event identifier is required.');
  }
  return value.trim();
}
function photographerFields(event: FirebaseFirestore.DocumentData, uid: string, email: string, add: boolean) {
  const assigned = (Array.isArray(event.assignedPhotographers) ? event.assignedPhotographers : [])
    .filter((entry: { uid?: string; email?: string }) => entry.uid !== uid && normalizeEmail(entry.email) !== email);
  const emails = (Array.isArray(event.photographerEmails) ? event.photographerEmails : []).map(normalizeEmail)
    .filter((value: string) => value && value !== email);
  const uids = (Array.isArray(event.photographerUids) ? event.photographerUids : []).filter((value: string) => value !== uid);
  if (add) {
    assigned.push({ uid, email, inviteStatus: 'active', assignedAt: new Date().toISOString() });
    emails.push(email);
    uids.push(uid);
  }
  return { assignedPhotographers: assigned, photographerEmails: [...new Set(emails)], photographerUids: [...new Set(uids)] };
}

// Only server-verified superusers can manage Auth accounts. The injected service
// factory lets tests exercise the routes without contacting a real project.
export function registerAdminAccountRoutes(
  app: Express, config: FirebaseAdminConfig, services: (config: FirebaseAdminConfig) => Services = getAdminServices
) {
  const guard = async (req: AuthenticatedRequest, res: Response, next: () => void) => {
    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ') || !header.slice(7).trim()) return res.status(401).json({ error: 'Sign in with a real superuser account to manage accounts.' });
    try {
      const { auth, db } = services(config);
      const caller = await auth.verifyIdToken(header.slice(7).trim(), true);
      const admin = await db.collection('admins').doc(caller.uid).get();
      const owner = caller.email_verified === true && normalizeEmail(caller.email) === OWNER_EMAIL;
      if (!owner && !admin.exists) return res.status(403).json({ error: 'Superuser access is required.' });
      req.firebaseUser = caller;
      next();
    } catch {
      return res.status(401).json({ error: 'Your session could not be verified. Sign in again.' });
    }
  };
  const route = (handler: (req: AuthenticatedRequest, res: Response, context: Services) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try { await handler(req as AuthenticatedRequest, res, services(config)); }
      catch (error: unknown) {
        if (error instanceof AccountError) return res.status(error.status).json({ error: error.message });
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (code === 'auth/user-not-found') return res.status(404).json({ error: 'This Firebase Authentication account no longer exists.' });
        console.error('Account management failed', { code: typeof code === 'string' && /^[a-z0-9/-]{1,80}$/.test(code) ? code : 'unknown' });
        return res.status(500).json({ error: 'The operation did not finish. Refresh the account and check its state before retrying. The service needs Firebase Authentication and Firestore permissions.' });
      }
    };

  async function account(context: Services, uid: string) {
    const record = await context.auth.getUser(uid);
    const [profile, admin] = await Promise.all([
      context.db.collection('users').doc(uid).get(), context.db.collection('admins').doc(uid).get()
    ]);
    const data = profile.data();
    const role = normalizeEmail(record.email) === OWNER_EMAIL || admin.exists ? 'super_admin' : ROLES.includes(data?.role) ? data!.role : null;
    const owned = await context.db.collection('events').where('ownerUid', '==', uid).get();
    const [byUid, byEmail] = await Promise.all([
      context.db.collection('events').where('photographerUids', 'array-contains', uid).get(),
      context.db.collection('events').where('photographerEmails', 'array-contains', normalizeEmail(record.email)).get()
    ]);
    const photographerEvents = [...new Map([...byUid.docs, ...byEmail.docs].map((doc) => [doc.id, { id: doc.id, name: doc.data().name || 'Untitled event' }])).values()];
    return {
      uid, email: record.email || '', displayName: data?.displayName || record.displayName || '', role,
      disabled: record.disabled, provisioned: profile.exists, assignedEvents: Array.isArray(data?.assignedEvents) ? data!.assignedEvents : [],
      ownedEvents: owned.docs.map((doc) => ({ id: doc.id, name: doc.data().name || 'Untitled event' })),
      photographerEvents,
      protected: normalizeEmail(record.email) === OWNER_EMAIL
    };
  }
  async function checkRoleChange(context: Services, callerUid: string, uid: string, role: Role) {
    const current = await account(context, uid);
    const profile = await context.db.collection('users').doc(uid).get();
    if (profile.data()?.accountState === 'deleting') throw new AccountError(409, 'Account deletion is in progress. Retry deletion before editing.');
    if ((uid === callerUid || current.protected) && current.role !== role) throw new AccountError(409, 'You cannot change your own role or the primary superuser role.');
    if (role === 'photographer' && current.ownedEvents.length) throw new AccountError(409, 'Transfer this account’s owned events before changing it to a photographer.');
    return current;
  }

  app.get('/api/admin/accounts', guard, route(async (req, res, context) => {
    const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
    if (pageToken && pageToken.length > 2000) throw new AccountError(400, 'Invalid page cursor.');
    const page = await context.auth.listUsers(50, pageToken);
    const profiles = page.users.length ? await context.db.getAll(...page.users.map((user) => context.db.collection('users').doc(user.uid))) : [];
    const admins = page.users.length ? await context.db.getAll(...page.users.map((user) => context.db.collection('admins').doc(user.uid))) : [];
    res.json({ accounts: page.users.map((user, index) => ({
      uid: user.uid, email: user.email || '', displayName: profiles[index]?.data()?.displayName || user.displayName || '',
      disabled: user.disabled, provisioned: profiles[index]?.exists || false,
      role: normalizeEmail(user.email) === OWNER_EMAIL || admins[index]?.exists ? 'super_admin' : ROLES.includes(profiles[index]?.data()?.role) ? profiles[index].data()!.role : null
    })), nextPageToken: page.pageToken || null });
  }));
  app.post('/api/admin/accounts/lookup', guard, route(async (req, res, context) => {
    const email = normalizeEmail(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new AccountError(400, 'Enter a valid account email.');
    const target = await context.auth.getUserByEmail(email);
    res.json(await account(context, target.uid));
  }));
  app.get('/api/admin/accounts/:uid', guard, route(async (req, res, context) => {
    res.json(await account(context, identifier(req.params.uid)));
  }));
  app.patch('/api/admin/accounts/:uid', guard, route(async (req, res, context) => {
    const uid = identifier(req.params.uid);
    const role = req.body?.role;
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
    if (!ROLES.includes(role) || !displayName || displayName.length > 200) throw new AccountError(400, 'Enter a name of at most 200 characters and select a role.');
    const current = await checkRoleChange(context, req.firebaseUser!.uid, uid, role);
    const userRef = context.db.collection('users').doc(uid);
    const adminRef = context.db.collection('admins').doc(uid);
    // Firestore is authoritative for access. Write it before syncing the Auth display name.
    await context.db.runTransaction(async (transaction) => {
      const profile = await transaction.get(userRef);
      if (profile.data()?.accountState === 'deleting') throw new AccountError(409, 'Account deletion is in progress.');
      const owned = await transaction.get(context.db.collection('events').where('ownerUid', '==', uid));
      if (role === 'photographer' && !owned.empty) throw new AccountError(409, 'Transfer owned events before changing this role.');
      transaction.set(userRef, {
        uid, email: current.email, displayName, role, assignedEvents: profile.data()?.assignedEvents || [],
        inviteStatus: 'active', ...(!current.provisioned ? { createdAt: new Date().toISOString() } : {})
      }, { merge: true });
      if (role === 'super_admin') transaction.set(adminRef, { email: current.email, role: 'super_admin' }, { merge: true });
      else transaction.delete(adminRef);
    });
    await context.auth.updateUser(uid, { displayName });
    res.json(await account(context, uid));
  }));

  const assign = route(async (req, res, context) => {
    const eventId = identifier(req.body?.eventId);
    const uid = req.params.uid ? identifier(req.params.uid) : (await context.auth.getUserByEmail(normalizeEmail(req.body?.email))).uid;
    const target = await account(context, uid);
    const add = req.method !== 'DELETE';
    if (!target.email || (add && target.disabled)) throw new AccountError(400, 'An enabled account with an email address is required for a new assignment.');
    if (add && target.role !== 'photographer') throw new AccountError(409, 'Save this account with the Photographer role before assigning it as a photographer.');
    const eventRef = context.db.collection('events').doc(eventId);
    const userRef = context.db.collection('users').doc(uid);
    await context.db.runTransaction(async (transaction) => {
      const [event, profile] = await Promise.all([transaction.get(eventRef), transaction.get(userRef)]);
      if (!event.exists) throw new AccountError(404, 'The event was not found.');
      if (!profile.exists || profile.data()?.accountState === 'deleting' || (add && profile.data()?.role !== 'photographer')) throw new AccountError(409, 'The account changed. Refresh and try again.');
      const invites = await transaction.get(context.db.collection('photographerInvitations').where('eventId', '==', eventId).where('normalizedEmail', '==', normalizeEmail(target.email)));
      transaction.update(eventRef, photographerFields(event.data()!, uid, normalizeEmail(target.email), add));
      if (add || event.data()!.ownerUid !== uid) {
        transaction.update(userRef, { assignedEvents: add ? FieldValue.arrayUnion(eventId) : FieldValue.arrayRemove(eventId) });
      }
      // Invalidate any pending emailed invitation for the same assignment.
      for (const invite of invites.docs) if (invite.data().status === 'pending') transaction.update(invite.ref, { status: 'revoked' });
    });
    res.json(await account(context, uid));
  });
  app.post('/api/admin/accounts/:uid/assignments', guard, assign);
  app.delete('/api/admin/accounts/:uid/assignments', guard, assign);
  app.post('/api/admin/photographer-assignments', guard, assign);

  app.post('/api/admin/accounts/:uid/ownership', guard, route(async (req, res, context) => {
    const uid = identifier(req.params.uid);
    const eventId = identifier(req.body?.eventId);
    if (req.body?.confirmTransfer !== true || typeof req.body?.expectedOwnerUid !== 'string') throw new AccountError(400, 'Confirm the current owner before transferring the event.');
    const target = await account(context, uid);
    if (target.disabled || !['event_manager', 'super_admin'].includes(target.role)) throw new AccountError(409, 'Choose an enabled manager or superuser to own the event.');
    const eventRef = context.db.collection('events').doc(eventId);
    await context.db.runTransaction(async (transaction) => {
      const event = await transaction.get(eventRef);
      const newProfile = await transaction.get(context.db.collection('users').doc(uid));
      if (!event.exists) throw new AccountError(404, 'The event was not found.');
      if (event.data()!.ownerUid !== req.body.expectedOwnerUid) throw new AccountError(409, 'Event ownership changed. Refresh before transferring it.');
      if (newProfile.data()?.accountState === 'deleting') throw new AccountError(409, 'Account deletion is in progress.');
      if (!['event_manager', 'super_admin'].includes(newProfile.data()?.role)) throw new AccountError(409, 'The target role changed. Refresh and try again.');
      const previousUid = event.data()!.ownerUid;
      const previousRef = typeof previousUid === 'string' && previousUid && previousUid !== uid ? context.db.collection('users').doc(previousUid) : null;
      const previous = previousRef ? await transaction.get(previousRef) : null;
      transaction.update(eventRef, { ownerUid: uid, ownerEmail: target.email });
      transaction.update(newProfile.ref, { assignedEvents: FieldValue.arrayUnion(eventId) });
      if (previous?.exists && previousRef) {
        const oldIsPhotographer = (event.data()!.photographerUids || []).includes(previousUid) ||
          (event.data()!.assignedPhotographers || []).some((entry: { uid?: string; email?: string }) => entry.uid === previousUid || normalizeEmail(entry.email) === normalizeEmail(previous.data()?.email));
        if (!oldIsPhotographer) transaction.update(previousRef, { assignedEvents: FieldValue.arrayRemove(eventId) });
      }
    });
    res.json(await account(context, uid));
  }));

  app.delete('/api/admin/accounts/:uid', guard, route(async (req, res, context) => {
    const uid = identifier(req.params.uid);
    const target = await account(context, uid);
    if (uid === req.firebaseUser!.uid || target.protected) throw new AccountError(409, 'You cannot delete your own account or the primary superuser account.');
    if (req.body?.confirmEmail !== target.email) throw new AccountError(400, 'Type the account email exactly to confirm deletion.');
    if (target.ownedEvents.length) throw new AccountError(409, 'Transfer all owned events before deleting this account.');
    await context.db.runTransaction(async (transaction) => {
      const owned = await transaction.get(context.db.collection('events').where('ownerUid', '==', uid));
      if (!owned.empty) throw new AccountError(409, 'Transfer all owned events before deleting this account.');
      transaction.set(context.db.collection('users').doc(uid), { accountState: 'deleting' }, { merge: true });
    });
    // Disable first: if cleanup fails, an administrator can retry without leaving
    // the account able to sign in while its memberships are partially removed.
    await context.auth.updateUser(uid, { disabled: true });
    await context.auth.revokeRefreshTokens(uid);
    const email = normalizeEmail(target.email);
    const [allEvents, invitations] = await Promise.all([
      // Include legacy events whose assignment arrays were never indexed.
      context.db.collection('events').get(),
      context.db.collection('photographerInvitations').where('normalizedEmail', '==', email).get()
    ]);
    const memberships = allEvents.docs.filter((snapshot) => {
      const event = snapshot.data();
      return (event.photographerUids || []).includes(uid) || (event.photographerEmails || []).map(normalizeEmail).includes(email) ||
        (event.assignedPhotographers || []).some((entry: { uid?: string; email?: string }) => entry.uid === uid || normalizeEmail(entry.email) === email);
    });
    for (const snapshot of memberships) {
      const ref = snapshot.ref;
      await context.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (snapshot.exists) transaction.update(ref, photographerFields(snapshot.data()!, uid, email, false));
      });
    }
    for (const invitation of invitations.docs) {
      if (invitation.data().status === 'pending') await invitation.ref.update({ status: 'revoked' });
    }
    await context.db.collection('admins').doc(uid).delete();
    await context.db.collection('users').doc(uid).delete();
    await context.auth.deleteUser(uid);
    res.json({ success: true });
  }));
}
