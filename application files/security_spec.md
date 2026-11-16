# Lumina Event Photo Hub - Security Specification

## 1. Data Invariants

1. **Manager Ownership Invariant**: An Event document can only be created, modified, or deleted by its designated `ownerUid`. Public event reads remain enabled for attendee check-in and gallery discovery, but only the owner can manage an event.
2. **Attendee Privacy Invariant (Public Insert-Only)**: Unauthenticated and public users can create (insert) a new attendee record for an existing event with valid consent fields. They cannot read, update (except strictly attaching their own `checkInPhotoPath` on session finish), or delete any attendee records.
3. **Photographer Isolation Invariant**: Photographers can only create photo metadata for events where their accepted UID is present on the event. Photographers can NEVER read or query attendee records.
4. **Photo Ownership & Lifecycle Invariant**: Photographers can delete their own uploaded photos (`resource.data.uploadedBy == request.auth.uid`). Event Managers can update status (e.g. flag), edit, or delete any photo in events they own.
5. **PII Isolation**: Attendee PII (emails, phone numbers, dietary requirements, check-in photos) can ONLY be read by the Event Manager owning the specific event.
6. **Invitation Integrity Invariant**: Invitation records and token hashes are server-only. Clients cannot read or write them, and users cannot change their own role, invitation status, or event assignments.
7. **Attendee Gallery Capability Invariant**: Gallery and delivery records are server-only. A public gallery request must present a high-entropy, expiring token; the server hashes the token, verifies the attendee-to-photo match again, and streams only the original files included in that attendee's released snapshot.

---

## 2. The "Dirty Dozen" Threat Payloads

1. **Payload 1: Manager Impersonation**: Attacker creates an event with another manager's `ownerUid`. (Denied by `incoming().ownerUid == request.auth.uid`).
2. **Payload 2: Cross-Manager PII Snooping**: Event Manager A attempts to read attendee records owned by Event Manager B. (Denied by `isEventOwner(eventId)`). Public event metadata remains readable by design.
3. **Payload 3: Photographer Reading Attendees**: Photographer tries to query `/attendees/{eventId}` to harvest emails and faces. (Denied: Attendees collection denies all read access to non-managers).
4. **Payload 4: Unassigned Photographer Metadata Write**: Photographer attempts to create a photo record for an event they are not assigned to. (Denied: accepted UID must be present on the parent event).
5. **Payload 5: Public Attendee Table Dump**: Unauthenticated script attempts to `list` or `get` records from `/attendees/{eventId}`. (Denied: reads denied to unauthenticated users).
6. **Payload 6: Attendee Record Tampering**: Malicious user attempts to alter consent or registration fields. (Denied: public updates are restricted to check-in photo and embedding lifecycle fields).
7. **Payload 7: Photographer Deleting Another Photographer's Upload**: Photographer A tries to delete photo uploaded by Photographer B. (Denied: photographer can only delete if `resource.data.uploadedBy == request.auth.uid`).
8. **Payload 8: Invitation Token Disclosure**: Client attempts to read invitation documents or hashed tokens. (Denied: invitation collections have no client access).
9. **Payload 9: Profile Role Escalation**: User attempts to add or change protected fields on their profile. (Denied: self-updates are limited to `displayName`).
10. **Payload 10: Event Manager Hijack Update**: Attacker attempts to change `ownerUid` of an existing event to transfer ownership. (Denied: `incoming().ownerUid == existing().ownerUid`).
11. **Payload 11: Fake Role Escalation**: User attempts to update their own `users/{uid}` document to change their role to `event_manager` without credentials. (Denied: restricted user update).
12. **Payload 12: Arbitrary Storage Bypass**: User attempts to upload outside an explicit check-in or photographer-photo path. (Denied by the default-deny Storage fallback).

---

## 3. Storage Authorization Constraint

This app stores event records in a named Firestore database. Firebase Storage Security Rules can read authorization documents only from the default Firestore database, so the Storage rules enforce authentication, explicit upload paths, image MIME types, and size limits, but cannot directly verify event membership in the named database.

For full assignment enforcement at the blob layer, route photographer uploads through the authenticated backend or mirror minimal event-membership records into the default Firestore database. Firestore photo metadata writes already enforce accepted event membership.

Public attendee galleries do not receive direct Firestore or Storage access. The Express server validates the expiring gallery capability and streams each original file or generated ZIP through Firebase Admin. Because original photos are intentionally unredacted, gallery emails warn recipients that anyone possessing the link can view the files.
