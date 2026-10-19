# Lumina Event Photo Hub - Security Specification

## 1. Data Invariants

1. **Manager Ownership Invariant**: An Event document can only be created, modified, or deleted by its designated `ownerUid`. Event Managers can only read and manage events where `ownerUid == request.auth.uid`.
2. **Attendee Privacy Invariant (Public Insert-Only)**: Unauthenticated and public users can create (insert) a new attendee record for an existing event with valid consent fields. They cannot read, update (except strictly attaching their own `checkInPhotoPath` on session finish), or delete any attendee records.
3. **Photographer Isolation Invariant**: Photographers can only upload and write photo records to events they are assigned to. Photographers can NEVER read, query, or write to the `/attendees/{eventId}/{attendeeId}` subcollection under any circumstances.
4. **Photo Ownership & Lifecycle Invariant**: Photographers can delete their own uploaded photos (`resource.data.uploadedBy == request.auth.uid`). Event Managers can update status (e.g. flag), edit, or delete any photo in events they own.
5. **PII Isolation**: Attendee PII (emails, phone numbers, dietary requirements, check-in photos) can ONLY be read by the Event Manager owning the specific event.
6. **Denial-of-Wallet Guard**: All document IDs, names, emails, and string fields are strictly length-bounded. Array lengths are strictly capped.

---

## 2. The "Dirty Dozen" Threat Payloads

1. **Payload 1: Manager Impersonation**: Attacker creates an event with another manager's `ownerUid`. (Denied by `incoming().ownerUid == request.auth.uid`).
2. **Payload 2: Cross-Manager Snooping**: Event Manager A attempts to read `/events/{eventBId}` or `/attendees/{eventBId}/{attendeeId}` owned by Event Manager B. (Denied by `isEventOwner(eventId)`).
3. **Payload 3: Photographer Reading Attendees**: Photographer tries to query `/attendees/{eventId}` to harvest emails and faces. (Denied: Attendees collection denies all read access to non-managers).
4. **Payload 4: Unassigned Photographer Upload**: Photographer attempts to write a photo to an event they are not assigned to. (Denied: Must be in `assignedPhotographers` of the parent event).
5. **Payload 5: Public Attendee Table Dump**: Unauthenticated script attempts to `list` or `get` records from `/attendees/{eventId}`. (Denied: reads denied to unauthenticated users).
6. **Payload 6: Attendee Record Tampering**: Malicious user attempts to overwrite an existing attendee's check-in or alter their consent status. (Denied: only create allowed, update restricted to initial checkInPhotoPath attachment with valid bounds).
7. **Payload 7: Photographer Deleting Another Photographer's Upload**: Photographer A tries to delete photo uploaded by Photographer B. (Denied: photographer can only delete if `resource.data.uploadedBy == request.auth.uid`).
8. **Payload 8: Ghost Field Injection**: Attacker injects `isAdmin: true` or random payload in attendee record. (Denied: strict key check in schema validator).
9. **Payload 9: Huge String Resource Exhaustion**: Attacker submits a 10MB base64 string in `fullName` or `dietaryAccessibility`. (Denied by `.size() <= 200` checks).
10. **Payload 10: Event Manager Hijack Update**: Attacker attempts to change `ownerUid` of an existing event to transfer ownership. (Denied: `incoming().ownerUid == existing().ownerUid`).
11. **Payload 11: Fake Role Escalation**: User attempts to update their own `users/{uid}` document to change their role to `event_manager` without credentials. (Denied: restricted user update).
12. **Payload 12: Arbitrary Storage Bypass**: User attempts to upload to storage path outside their assigned event structure. (Denied by Storage rules checking event ownership/assignment).
