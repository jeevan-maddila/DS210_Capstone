import { useEffect, useRef, useState } from 'react';
import { accountService, type ManagedAccount } from '../../services/accountService';
import { useAuth } from '../../context/AuthContext';
import type { EventItem, UserRole } from '../../types';

const roleNames: Record<UserRole, string> = { super_admin: 'Superuser', event_manager: 'Event manager', photographer: 'Photographer' };
const fieldClass = 'w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const buttonClass = 'rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50';

export function AccountManager({ events, onChanged }: { events: EventItem[]; onChanged: () => Promise<void> }) {
  const { user, isSuperAdmin } = useAuth();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<ManagedAccount | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('photographer');
  const [eventId, setEventId] = useState('');
  const [confirmOwnership, setConfirmOwnership] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const allowed = isSuperAdmin;

  function show(account: ManagedAccount) {
    setSelected(account);
    setDisplayName(account.displayName || account.email);
    setRole(account.role || 'photographer');
    setEventId('');
    setConfirmOwnership(false);
    setDeleting(false);
    setConfirmEmail('');
  }
  const loadAccounts = async (pageToken?: string) => {
    const page = await accountService.list(pageToken);
    if (!mounted.current) return;
    setAccounts((previous) => pageToken ? [...previous, ...page.accounts] : page.accounts);
    setNextPageToken(page.nextPageToken);
  };
  useEffect(() => {
    mounted.current = true;
    if (allowed) {
      setBusy(true);
      loadAccounts().catch(() => { if (mounted.current) setError('Could not load Firebase accounts. Check the web service’s Authentication permissions.'); })
        .finally(() => { if (mounted.current) setBusy(false); });
    }
    return () => { mounted.current = false; };
  }, [allowed]);

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'The operation did not finish. Refresh before retrying.'); }
    finally { setBusy(false); }
  }
  async function refreshAfterChange(account: ManagedAccount, message: string) {
    show(account);
    setAccounts((current) => current.map((entry) => entry.uid === account.uid ? account : entry));
    setNotice(message);
    try { await onChanged(); } catch { setError('The change was saved, but the overview could not be refreshed.'); }
  }

  if (!allowed) return <div className="p-6 text-sm text-slate-700">Account management requires a real superuser sign-in.</div>;
  const protectedAccount = selected?.uid === user?.uid || selected?.protected;
  const owned = selected?.ownedEvents || [];
  const assignments = selected?.photographerEvents || [];
  const canOwn = selected?.role === 'event_manager' || selected?.role === 'super_admin';
  const selectedEvent = events.find((event) => event.id === eventId);

  return <div className="p-4 sm:p-6 space-y-5">
    <div>
      <h2 className="text-lg font-bold text-slate-900">Account management</h2>
      <p className="mt-1 text-sm text-slate-600">Manage existing Firebase accounts, including accounts that have never signed in. Direct assignments do not send email.</p>
    </div>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); perform(async () => show(await accountService.lookup(email))); }}>
      <label className="flex-1 min-w-[200px] text-sm font-medium text-slate-700">Find by email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={`${fieldClass} mt-1`} /></label>
      <button disabled={busy} className={buttonClass}>Find account</button>
      <button type="button" disabled={busy} className={buttonClass} onClick={() => perform(async () => { await loadAccounts(); if (selected) show(await accountService.get(selected.uid)); })}>Refresh</button>
    </form>
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-label="Firebase accounts" className="overflow-hidden rounded-2xl border border-slate-200">
        <div className="bg-slate-50 px-4 py-3 text-xs text-slate-600">{accounts.length} Firebase account(s) loaded. Use email lookup to find any account.</div>
        <ul className="divide-y divide-slate-200 max-h-[600px] overflow-y-auto">
          {accounts.map((account) => <li key={account.uid}>
            <button disabled={busy} aria-pressed={selected?.uid === account.uid} className={`w-full p-4 text-left ${selected?.uid === account.uid ? 'bg-indigo-50' : 'bg-white'} disabled:opacity-50`} onClick={() => perform(async () => show(await accountService.get(account.uid)))}>
              <span className="block font-semibold text-sm text-slate-900">{account.displayName || account.email || 'Unnamed account'}</span>
              <span className="block text-xs text-slate-600 break-all">{account.email || 'No email address'}</span>
              <span className="mt-2 flex flex-wrap gap-2">
                <span className={`role-badge ${account.role ? `role-badge-${account.role}` : 'role-badge-unassigned'}`}>{account.role ? roleNames[account.role] || 'Unassigned' : 'No app role'}</span>
                {account.disabled && <span className="text-xs font-semibold text-rose-700">Disabled</span>}
              </span>
            </button>
          </li>)}
        </ul>
        {!busy && accounts.length === 0 && <p className="p-4 text-sm text-slate-600">No Firebase accounts loaded.</p>}
        {nextPageToken && <button disabled={busy} className={`${buttonClass} m-3`} onClick={() => perform(() => loadAccounts(nextPageToken))}>Load more accounts</button>}
      </section>
      <section aria-label="Selected account" className="rounded-2xl border border-slate-200 bg-white p-4 space-y-4">
        {selected ? <>
          <div><h3 className="font-bold text-slate-900 break-all">{selected.email || selected.uid}</h3><p className="text-xs text-slate-500 break-all">UID: {selected.uid}</p></div>
          {selected.disabled && <p className="text-sm text-rose-700">This Firebase account is disabled. If a deletion failed, you can refresh and retry deletion. Re-enabling is available in Firebase.</p>}
          {!selected.provisioned && <p className="text-sm text-slate-600">This account has no application profile yet. Save a name and role to activate its profile.</p>}
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); perform(async () => refreshAfterChange(await accountService.save(selected.uid, displayName, role), 'Account saved. The user should reload the app or sign in again to see role changes.')); }}>
            <label className="block text-sm text-slate-700">Display name<input required maxLength={200} disabled={busy} className={`${fieldClass} mt-1`} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
            <label className="block text-sm text-slate-700">System role<select disabled={busy || protectedAccount} className={`${fieldClass} mt-1`} value={role} onChange={(event) => setRole(event.target.value as UserRole)}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            {protectedAccount && <p className="text-xs text-slate-600">Your own role and the primary superuser account are protected.</p>}
            <button disabled={busy} className={buttonClass}>Save account</button>
          </form>
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <h4 className="font-semibold text-sm text-slate-900">Event access</h4>
            {owned.length > 0 && <div className="text-sm text-slate-700"><p className="font-semibold">Owned events</p><ul className="list-disc pl-5">{owned.map((event) => <li key={event.id}>{event.name}</li>)}</ul><p className="mt-1 text-xs">To transfer an event, select its new manager account and make that account the owner below.</p></div>}
            {assignments.length > 0 && <ul className="space-y-2">{assignments.map((event) => <li key={event.id} className="flex items-center justify-between gap-2 text-sm text-slate-700"><span>{event.name} (photographer)</span><button disabled={busy} type="button" className={buttonClass} onClick={() => perform(async () => refreshAfterChange(await accountService.assign(selected.uid, event.id, true), 'Photographer assignment removed.'))}>Remove</button></li>)}</ul>}
            {owned.length === 0 && assignments.length === 0 && <p className="text-sm text-slate-600">No event assignments.</p>}
            <label className="block text-sm text-slate-700">Choose an event<select disabled={busy} className={`${fieldClass} mt-1`} value={eventId} onChange={(event) => { setEventId(event.target.value); setConfirmOwnership(false); }}><option value="">Select an event</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            {selected.role === 'photographer' ? <button disabled={busy || !eventId || selected.disabled} className={buttonClass} onClick={() => perform(async () => refreshAfterChange(await accountService.assign(selected.uid, eventId), 'Photographer assigned. No email was sent.'))}>Assign as photographer</button> : canOwn ? <>
              <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={confirmOwnership} disabled={busy || !eventId} onChange={(event) => setConfirmOwnership(event.target.checked)} /><span>Make this account the event owner. This transfers ownership and the current owner’s owner-based access{selectedEvent?.ownerEmail ? ` from ${selectedEvent.ownerEmail}` : ''}.</span></label>
              <button disabled={busy || !selectedEvent || !confirmOwnership || selected.disabled} className={buttonClass} onClick={() => selectedEvent && perform(async () => refreshAfterChange(await accountService.transferOwnership(selected.uid, eventId, selectedEvent.ownerUid), 'Event ownership transferred.'))}>Transfer event ownership</button>
            </> : <p className="text-xs text-slate-600">Save an application role before assigning events.</p>}
          </div>
          {!protectedAccount && <div className="border-t border-slate-200 pt-4 space-y-2">
            <button type="button" disabled={busy || owned.length > 0} className="text-sm font-semibold text-rose-700 underline disabled:opacity-50" onClick={() => setDeleting(!deleting)}>Delete account</button>
            {owned.length > 0 && <p className="text-xs text-slate-600">Transfer all owned events before deleting this account.</p>}
            {deleting && <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 space-y-2 text-sm text-rose-800">
              <p>This deletes the Firebase sign-in account and application profile and removes event assignments. Event photos and attendee records are retained. This cannot be undone.</p>
              <label className="block">Type {selected.email} to confirm<input autoComplete="off" disabled={busy} className={`${fieldClass} mt-1`} value={confirmEmail} onChange={(event) => setConfirmEmail(event.target.value)} /></label>
              <button disabled={busy || !selected.email || confirmEmail !== selected.email} className={buttonClass} onClick={() => perform(async () => { await accountService.delete(selected.uid, confirmEmail); setSelected(null); await loadAccounts(); await onChanged(); setNotice('Account deleted. Event photos and attendee records were retained.'); })}>Permanently delete account</button>
            </div>}
          </div>}
        </> : <p className="text-sm text-slate-600">Select an account to edit its name, role, and event access.</p>}
        {busy && <p role="status" className="text-sm text-slate-600">Working…</p>}
      </section>
    </div>
  </div>;
}
