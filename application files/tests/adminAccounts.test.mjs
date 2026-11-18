import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

// Execute the actual route implementation with isolated Auth/Firestore/Express
// doubles. No cloud project, account, email, or credential is used by these tests.
const source = readFileSync(new URL('../server/adminAccounts.ts', import.meta.url), 'utf8');
const js = stripTypeScriptTypes(source, { mode: 'transform' })
  .replace(/^import .*;\s*$/gm, '')
  .replace('export function registerAdminAccountRoutes', 'function registerAdminAccountRoutes');
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const FieldValue = {
  arrayUnion: (...elements) => ({ operation: 'union', elements }),
  arrayRemove: (...elements) => ({ operation: 'remove', elements })
};
const register = vm.runInNewContext(`${js}\nregisterAdminAccountRoutes`, {
  FieldValue, normalizeEmail, getAdminServices: () => { throw new Error('Unexpected real service access'); }, console: { error() {} }
});

function setup() {
  const docs = new Map();
  const users = new Map([
    ['admin', { uid: 'admin', email: 'admin@example.test', displayName: 'Admin', disabled: false }],
    ['owner', { uid: 'owner', email: 'thomas.leffler2@gmail.com', displayName: 'Owner', disabled: false }],
    ['target', { uid: 'target', email: 'photographer@fake.com', displayName: '', disabled: false }],
    ['manager', { uid: 'manager', email: 'manager@example.test', displayName: 'Manager', disabled: false }]
  ]);
  docs.set('admins/admin', { role: 'super_admin' });
  docs.set('users/admin', { uid: 'admin', role: 'super_admin', assignedEvents: [] });
  docs.set('users/manager', { uid: 'manager', email: 'manager@example.test', role: 'event_manager', assignedEvents: ['event'] });
  docs.set('events/event', { name: 'Example event', ownerUid: 'manager', ownerEmail: 'manager@example.test', assignedPhotographers: [], photographerEmails: [], photographerUids: [] });
  const deepCopy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const apply = (path, data, merge) => {
    const result = merge ? deepCopy(docs.get(path) || {}) : {};
    for (const [key, value] of Object.entries(data)) {
      if (value?.operation === 'union') result[key] = [...new Set([...(result[key] || []), ...value.elements])];
      else if (value?.operation === 'remove') result[key] = (result[key] || []).filter((entry) => !value.elements.includes(entry));
      else result[key] = deepCopy(value);
    }
    docs.set(path, result);
  };
  function ref(path) {
    return {
      path, id: path.split('/').at(-1),
      get: async () => snap(path),
      update: async (data) => apply(path, data, true),
      delete: async () => { docs.delete(path); }
    };
  }
  function snap(path) { return { id: path.split('/').at(-1), exists: docs.has(path), ref: ref(path), data: () => deepCopy(docs.get(path)) }; }
  function collection(name, filters = []) {
    return {
      doc: (uid) => ref(`${name}/${uid}`),
      where: (field, operator, value) => collection(name, [...filters, { field, operator, value }]),
      get: async () => {
        const matches = [...docs.keys()].filter((path) => path.split('/')[0] === name && filters.every(({ field, operator, value }) => {
          const stored = docs.get(path)[field];
          return operator === '==' ? stored === value : Array.isArray(stored) && stored.some((entry) => JSON.stringify(entry) === JSON.stringify(value));
        })).map(snap);
        return { docs: matches, empty: matches.length === 0 };
      }
    };
  }
  const db = {
    collection,
    getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get())),
    runTransaction: async (action) => {
      let wrote = false;
      const changes = [];
      const transaction = {
        get: async (ref) => { assert.equal(wrote, false, 'All transaction reads must precede writes'); return ref.get(); },
        set: (ref, data, options) => { wrote = true; changes.push(() => apply(ref.path, data, options?.merge)); },
        update: (ref, data) => { wrote = true; changes.push(() => apply(ref.path, data, true)); },
        delete: (ref) => { wrote = true; changes.push(() => docs.delete(ref.path)); }
      };
      const result = await action(transaction);
      changes.forEach((change) => change());
      return result;
    }
  };
  const operations = [];
  const notFound = () => Object.assign(new Error('Not found'), { code: 'auth/user-not-found' });
  const auth = {
    verifyIdToken: async (token, checkRevoked) => {
      assert.equal(checkRevoked, true, 'Account administration must reject revoked credentials');
      if (token === 'invalid') throw new Error('Invalid token');
      const uid = token === 'unverified-owner' ? 'owner' : token;
      const user = users.get(uid);
      if (!user || user.disabled) throw new Error('Invalid user');
      return { uid, email: user.email, email_verified: token !== 'unverified-owner' };
    },
    getUser: async (uid) => { if (!users.has(uid)) throw notFound(); return deepCopy(users.get(uid)); },
    getUserByEmail: async (email) => { const user = [...users.values()].find((entry) => entry.email === email); if (!user) throw notFound(); return deepCopy(user); },
    listUsers: async () => ({ users: [...users.values()].map(deepCopy) }),
    updateUser: async (uid, data) => { if (!users.has(uid)) throw notFound(); operations.push(['update', uid, data]); Object.assign(users.get(uid), data); },
    revokeRefreshTokens: async (uid) => operations.push(['revoke', uid]),
    deleteUser: async (uid) => { operations.push(['delete', uid]); users.delete(uid); }
  };
  const routes = new Map();
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map((method) => [method, (path, ...handlers) => routes.set(`${method} ${path}`, handlers)]));
  register(app, { projectId: 'test', databaseId: 'test' }, () => ({ auth, db }));
  async function request(method, path, { token = 'admin', body = {}, uid = 'target' } = {}) {
    const req = { method: method.toUpperCase(), params: { uid }, body, query: {}, header: () => token === null ? undefined : `Bearer ${token}` };
    const res = { statusCode: 200, result: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.result = value; return this; } };
    const handlers = routes.get(`${method} ${path}`);
    assert.ok(handlers, `Route exists: ${method} ${path}`);
    let next = false;
    await handlers[0](req, res, () => { next = true; });
    if (next) await handlers[1](req, res);
    return { status: res.statusCode, body: res.result };
  }
  return { request, docs, users, operations, auth, db };
}
const saveBody = { displayName: 'Test Photographer', role: 'photographer' };

test('rejects anonymous, non-superuser, unverified bootstrap and invalid-token callers', async () => {
  for (const [token, status] of [[null, 401], ['manager', 403], ['unverified-owner', 403], ['invalid', 401]]) {
    const env = setup();
    assert.equal((await env.request('get', '/api/admin/accounts', { token })).status, status);
    assert.equal(env.operations.length, 0);
  }
});
test('lists and looks up an Auth account before it has an app profile', async () => {
  const env = setup();
  const list = await env.request('get', '/api/admin/accounts');
  assert.equal(list.status, 200);
  assert.equal(list.body.accounts.find((account) => account.uid === 'target').provisioned, false);
  const found = await env.request('post', '/api/admin/accounts/lookup', { body: { email: 'Photographer@Fake.com' } });
  assert.equal(found.body.uid, 'target');
  assert.equal(found.body.role, null);
});
test('creates the missing app profile and synchronizes the Auth display name', async () => {
  const env = setup();
  const response = await env.request('patch', '/api/admin/accounts/:uid', { body: saveBody });
  assert.equal(response.status, 200);
  assert.equal(env.docs.get('users/target').role, 'photographer');
  assert.equal(env.users.get('target').displayName, 'Test Photographer');
  assert.deepEqual(env.docs.get('users/target').assignedEvents, []);
});
test('assigns and removes photographer membership consistently without email', async () => {
  const env = setup();
  await env.request('patch', '/api/admin/accounts/:uid', { body: saveBody });
  env.docs.set('photographerInvitations/invite', { eventId: 'event', normalizedEmail: 'photographer@fake.com', status: 'pending' });
  const assigned = await env.request('post', '/api/admin/accounts/:uid/assignments', { body: { eventId: 'event' } });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.photographerEvents[0].id, 'event');
  assert.deepEqual(env.docs.get('events/event').photographerUids, ['target']);
  assert.deepEqual(env.docs.get('users/target').assignedEvents, ['event']);
  assert.equal(env.docs.get('photographerInvitations/invite').status, 'revoked');
  await env.request('post', '/api/admin/accounts/:uid/assignments', { body: { eventId: 'event' } });
  assert.equal(env.docs.get('events/event').assignedPhotographers.length, 1, 'Repeat assignment is idempotent');
  const removed = await env.request('delete', '/api/admin/accounts/:uid/assignments', { body: { eventId: 'event' } });
  assert.equal(removed.status, 200);
  assert.deepEqual(env.docs.get('events/event').photographerUids, []);
  assert.deepEqual(env.docs.get('events/event').photographerEmails, []);
  assert.deepEqual(env.docs.get('events/event').assignedPhotographers, []);
  assert.deepEqual(env.docs.get('users/target').assignedEvents, []);
});
test('rejects invalid roles, IDs and missing events without writes', async () => {
  const env = setup();
  assert.equal((await env.request('patch', '/api/admin/accounts/:uid', { body: { ...saveBody, role: 'owner' } })).status, 400);
  assert.equal((await env.request('get', '/api/admin/accounts/:uid', { uid: '../bad' })).status, 400);
  await env.request('patch', '/api/admin/accounts/:uid', { body: saveBody });
  assert.equal((await env.request('post', '/api/admin/accounts/:uid/assignments', { body: { eventId: 'missing' } })).status, 404);
  assert.deepEqual(env.docs.get('users/target').assignedEvents, []);
});
test('protects self and primary superuser from deletion or demotion', async () => {
  const env = setup();
  for (const uid of ['admin', 'owner']) {
    assert.equal((await env.request('patch', '/api/admin/accounts/:uid', { uid, body: saveBody })).status, 409);
    assert.equal((await env.request('delete', '/api/admin/accounts/:uid', { uid, body: { confirmEmail: env.users.get(uid).email } })).status, 409);
    assert.ok(env.users.has(uid));
  }
});
test('prevents deleting or demoting event owners until ownership is transferred', async () => {
  const env = setup();
  assert.equal((await env.request('delete', '/api/admin/accounts/:uid', { uid: 'manager', body: { confirmEmail: 'manager@example.test' } })).status, 409);
  assert.equal((await env.request('patch', '/api/admin/accounts/:uid', { uid: 'manager', body: saveBody })).status, 409);
  await env.request('patch', '/api/admin/accounts/:uid', { body: { ...saveBody, role: 'event_manager' } });
  assert.equal((await env.request('post', '/api/admin/accounts/:uid/ownership', { body: { eventId: 'event' } })).status, 400);
  assert.equal((await env.request('post', '/api/admin/accounts/:uid/ownership', { body: { eventId: 'event', confirmTransfer: true, expectedOwnerUid: 'old-owner' } })).status, 409);
  const transferred = await env.request('post', '/api/admin/accounts/:uid/ownership', { body: { eventId: 'event', confirmTransfer: true, expectedOwnerUid: 'manager' } });
  assert.equal(transferred.status, 200);
  assert.equal(env.docs.get('events/event').ownerUid, 'target');
  assert.deepEqual(env.docs.get('users/manager').assignedEvents, []);
  assert.deepEqual(env.docs.get('users/target').assignedEvents, ['event']);
});
test('requires exact confirmation and deletes membership and sign-in, retaining event media', async () => {
  const env = setup();
  await env.request('patch', '/api/admin/accounts/:uid', { body: saveBody });
  await env.request('post', '/api/admin/accounts/:uid/assignments', { body: { eventId: 'event' } });
  env.docs.set('photos/photo', { uploadedBy: 'target' });
  env.docs.set('attendees/attendee', { fullName: 'Retained' });
  assert.equal((await env.request('delete', '/api/admin/accounts/:uid', { body: { confirmEmail: 'wrong' } })).status, 400);
  assert.equal(env.users.get('target').disabled, false);
  const response = await env.request('delete', '/api/admin/accounts/:uid', { body: { confirmEmail: 'photographer@fake.com' } });
  assert.equal(response.status, 200);
  assert.equal(env.users.has('target'), false);
  assert.equal(env.docs.has('users/target'), false);
  assert.deepEqual(env.docs.get('events/event').photographerUids, []);
  assert.ok(env.docs.has('photos/photo'));
  assert.ok(env.docs.has('attendees/attendee'));
  const deletion = env.operations.filter((operation) => operation[1] === 'target');
  assert.deepEqual(deletion.slice(-3).map((operation) => operation[0]), ['update', 'revoke', 'delete']);
});

test('a claimed superuser profile without a server admin record cannot manage accounts', async () => {
  const env = setup();
  env.docs.set('users/target', { role: 'super_admin' });
  assert.equal((await env.request('get', '/api/admin/accounts', { token: 'target' })).status, 403);
});
test('role changes synchronize the server authorization record', async () => {
  const env = setup();
  assert.equal((await env.request('patch', '/api/admin/accounts/:uid', { body: { ...saveBody, role: 'super_admin' } })).status, 200);
  assert.ok(env.docs.has('admins/target'));
  assert.equal((await env.request('get', '/api/admin/accounts', { token: 'target' })).status, 200);
  await env.request('patch', '/api/admin/accounts/:uid', { body: saveBody });
  assert.equal(env.docs.has('admins/target'), false);
  assert.equal((await env.request('get', '/api/admin/accounts', { token: 'target' })).status, 403);
});
test('deletion also cleans legacy assignment arrays without indexed fields', async () => {
  const env = setup();
  env.docs.set('events/legacy', { name: 'Legacy event', assignedPhotographers: [{ email: 'photographer@fake.com', inviteStatus: 'active', assignedAt: 'yesterday' }] });
  const response = await env.request('delete', '/api/admin/accounts/:uid', { body: { confirmEmail: 'photographer@fake.com' } });
  assert.equal(response.status, 200);
  assert.deepEqual(env.docs.get('events/legacy').assignedPhotographers, []);
});
test('interrupted deletion leaves a disabled account that can safely be retried', async () => {
  const env = setup();
  const original = env.db.collection;
  env.db.collection = (name) => {
    const collection = original(name);
    if (name === 'events') collection.get = async () => { throw new Error('Firestore unavailable'); };
    return collection;
  };
  const failed = await env.request('delete', '/api/admin/accounts/:uid', { body: { confirmEmail: 'photographer@fake.com' } });
  assert.equal(failed.status, 500);
  assert.equal(env.users.get('target').disabled, true);
  assert.equal(env.docs.get('users/target').accountState, 'deleting');
  assert.equal(env.operations.some((operation) => operation[0] === 'delete'), false);
  assert.equal((await env.request('patch', '/api/admin/accounts/:uid', { body: saveBody })).status, 409);
  env.db.collection = original;
  const retried = await env.request('delete', '/api/admin/accounts/:uid', { body: { confirmEmail: 'photographer@fake.com' } });
  assert.equal(retried.status, 200);
  assert.equal(env.users.has('target'), false);
});

test('role badge text has at least 4.5:1 contrast in both themes', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const luminance = (hex) => {
    const [r, g, b] = hex.match(/\w\w/g).map((value) => parseInt(value, 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return .2126 * r + .7152 * g + .0722 * b;
  };
  const badges = [...css.matchAll(/(?:html\.dark )?\.role-badge-(?:super_admin|event_manager|photographer|unassigned) \{([^}]+)\}/g)];
  assert.equal(badges.length, 8, 'All four badge roles have light and dark definitions');
  for (const [rule, content] of badges) {
    const foreground = content.match(/(?:^|;)\s*color:\s*#([a-f0-9]{6})/)[1];
    const background = content.match(/background:\s*#([a-f0-9]{6})/)[1];
    const a = luminance(foreground), b = luminance(background);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, rule);
  }
});
