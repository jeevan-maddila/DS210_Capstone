import type { UserRole } from '../types';

export function portalForRole(role: UserRole, isSuperAdmin: boolean): 'admin' | 'manager' | 'photographer' {
  if (isSuperAdmin || role === 'super_admin') return 'admin';
  return role === 'photographer' ? 'photographer' : 'manager';
}

export function publicCheckInEvent(url: URL): string | null {
  const query = url.searchParams.get('checkin');
  const path = url.pathname.match(/^\/checkin\/([a-zA-Z0-9_-]+)\/?$/)?.[1];
  const value = query || path;
  return value && /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;
}
