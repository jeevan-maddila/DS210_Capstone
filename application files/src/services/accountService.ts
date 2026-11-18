import { auth } from '../lib/firebase';
import type { UserRole } from '../types';

export interface ManagedAccount {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole | null;
  disabled: boolean;
  provisioned: boolean;
  assignedEvents?: string[];
  ownedEvents?: { id: string; name: string }[];
  photographerEvents?: { id: string; name: string }[];
  protected?: boolean;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in with a real superuser account to manage accounts.');
  const response = await fetch(`/api/admin${path}`, {
    method,
    headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof result?.error === 'string' ? result.error : 'Account management is unavailable. Please try again.');
  if (!result) throw new Error('Account management is unavailable. Redeploy the web service and try again.');
  return result as T;
}

export const accountService = {
  list: (pageToken?: string) => request<{ accounts: ManagedAccount[]; nextPageToken: string | null }>(`/accounts${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`),
  get: (uid: string) => request<ManagedAccount>(`/accounts/${encodeURIComponent(uid)}`),
  lookup: (email: string) => request<ManagedAccount>('/accounts/lookup', 'POST', { email }),
  save: (uid: string, displayName: string, role: UserRole) => request<ManagedAccount>(`/accounts/${encodeURIComponent(uid)}`, 'PATCH', { displayName, role }),
  assign: (uid: string, eventId: string, remove = false) => request<ManagedAccount>(`/accounts/${encodeURIComponent(uid)}/assignments`, remove ? 'DELETE' : 'POST', { eventId }),
  transferOwnership: (uid: string, eventId: string, expectedOwnerUid: string) => request<ManagedAccount>(`/accounts/${encodeURIComponent(uid)}/ownership`, 'POST', { eventId, expectedOwnerUid, confirmTransfer: true }),
  delete: (uid: string, confirmEmail: string) => request<{ success: boolean }>(`/accounts/${encodeURIComponent(uid)}`, 'DELETE', { confirmEmail })
};
