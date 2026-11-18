# Masquerade

This folder contains the application and its deployment configuration.

## Run Locally

**Prerequisites:** Node.js 22.13 or newer and access to the Firebase project.

1. Install dependencies:

   ```bash
   npm ci
   ```

2. Copy the environment template and fill in the values:

   ```bash
   cp .env.example .env.local
   ```

   For local server access to Firestore, run `gcloud auth application-default login`. A service-account JSON file may alternatively be configured with `GOOGLE_APPLICATION_CREDENTIALS`. In Cloud Run, use the service account attached to the service instead of a JSON key.

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Photographer invitation email setup

Photographer invitations are created and accepted by the Express server. The browser never receives the email provider key or writes invitation records directly.

Set these values in `.env.local` for development or in the deployed service environment:

- `RESEND_API_KEY`: a Resend API key with sending access.
- `EMAIL_FROM`: a sender on a domain verified in Resend, such as `Masquerade <invites@example.com>`.
- `APP_BASE_URL`: the public HTTPS URL of this app.

`APP_BASE_URL=http://localhost:3000` is suitable only for same-computer testing. Use the deployed URL when sending invitations to another person.

The invite endpoint verifies the manager's Firebase ID token and event ownership. The recipient must sign in with the exact invited email address; acceptance expires after seven days and activates their event access in a Firestore transaction.

Before using invitations in production, deploy the updated `firestore.rules` and `storage.rules` to the Firebase project.

## Attendee photo galleries

Event managers can release one private gallery per consenting attendee from the Photo Gallery tab. A gallery contains the original, unredacted photos in which that attendee was matched. Links expire after 30 days and support individual downloads or a streamed ZIP download.

Set `GALLERY_TOKEN_SECRET` to a random value of at least 32 characters:

```bash
openssl rand -hex 32
```

For local development only, the server derives a temporary fallback from `RESEND_API_KEY` when `GALLERY_TOKEN_SECRET` is absent. Production requires the dedicated secret. `APP_BASE_URL=http://localhost:3000` creates links that only work on the computer running the app.

The release endpoint groups processed photos by `matchedAttendees`, skips attendees without `photoConsentGiven`, and sends Resend batches of at most 100 emails. Firestore delivery records and Resend idempotency keys prevent duplicate messages for an unchanged gallery.

## Cloud Run container

The Dockerfile uses separate build and runtime stages. The build stage compiles the browser application and bundles the TypeScript server. The runtime installs only Express, dotenv, Firebase Admin, and their transitive dependencies, and runs the compiled server as a non-root user. Vite, tsx, React, and the Firebase browser SDK are build dependencies; the browser receives the compiled assets. From this folder, build and run it locally with Docker:

```bash
docker build -t lumina-app .
docker run --rm -p 8080:8080 -e PORT=8080 lumina-app
```

The container needs the Firebase and email configuration described above for those features to work. For Cloud Run, set `GCP_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, `STORAGE_BUCKET`, `APP_BASE_URL`, and `EMAIL_FROM` on the service, and provide `RESEND_API_KEY` and `GALLERY_TOKEN_SECRET` through Secret Manager. Attach a service account with the required Firebase and Storage access; do not copy service-account keys into the image. Set `APP_BASE_URL` to the deployed HTTPS URL before sending invitations or gallery links.

The configured Firestore database ID includes a historical name. It identifies an existing database and must remain unchanged unless the application is deliberately migrated to a different database. The photo-processing jobs are separate containers and are not included in this web image.

For a local production preview, run `npm run build`, then `npm start`. This always serves the compiled production app; use `npm run dev` for development and hot reload.

### Dependency security checks

`@emnapi/runtime` is explicitly pinned as a build dependency because it was
repeatedly omitted from Tailwind's optional WebAssembly dependency tree after
lockfile updates, causing Linux Cloud Build's `npm ci` validation to fail. Keep
this pin until a clean cross-platform lockfile update no longer needs it. It is
excluded from the runtime container by `--omit=dev`.

Run `npm audit` for the complete dependency tree and `npm audit --omit=dev` for the server runtime dependency tree. Browser dependencies are still part of the built app and must also be reviewed, even though they are installed only in the build stage. Do not use `npm audit fix --force` to resolve findings automatically: it previously downgraded Firebase and Vite across major versions without eliminating all findings.

After dependency changes, run `npm ci`, `npm run test:accounts`, `npm run lint`, `npm run build`, and `npm run test:production`. The production smoke test checks the compiled server's health endpoint and SPA routing without calling Firebase. For the container, also check an event check-in URL, sign-in, and a protected staff action before deploying. A successful build does not verify Firebase credentials or live permissions.

## Superuser account management

Open **Super Admin → Accounts** while signed in with a superuser account. The directory reads Firebase Authentication, so accounts created manually in Firebase are visible even before their first app sign-in. Staff sign-in requires Firebase authentication; demo sign-in and simulated role switching have been removed.

For a test photographer with a non-deliverable email address:

1. Create the email/password account in Firebase Authentication.
2. Find it by email in Accounts, enter a display name, choose **Photographer**, and save.
3. Select an event and choose **Assign as photographer**. This does not send email.
4. Sign in as the test photographer, or reload their existing session.

Superusers can edit display names and roles, add/remove photographer assignments, and transfer event ownership to another manager or superuser. Owner transfers require explicit confirmation. The current account and primary superuser cannot be demoted or deleted. Transfer all owned events before deleting or demoting another manager.

Deleting an account requires typing its exact email address. The server disables the Firebase account, revokes refresh tokens, removes photographer assignments and pending invitations, and deletes its app profile and Firebase sign-in account. Photos and attendee records are retained. These operations span Firebase Authentication and Firestore; they cannot be one atomic transaction. If a deletion fails, the account may remain disabled and partially cleaned up. Refresh and retry deletion after resolving the error; Firebase can re-enable an account if necessary. Existing Firestore or Storage access tokens and previously shared download URLs are subject to their own authorization and expiry rules.

The **Cloud Run web service's runtime service account** needs Firebase Authentication user-management permissions (for example, `roles/firebaseauth.admin`) and Firestore read/write permissions. Human Cloud Run Invoker access does not grant these backend permissions. No service-account key should be put in the browser or container image. These changes do not themselves deploy IAM policies or implement invitation-only registration.

### Account-management checks

With Node.js 22.13 or newer, run `npm run test:accounts` (or `node tests/adminAccounts.test.mjs`). The isolated tests use in-memory Firebase and Express doubles and never contact the cloud. They exercise authorization, role/profile updates, assignments, ownership transfer, and protected deletion. Also run `npm run lint` and `npm run build` after installing the application's locked dependencies.

## Scheduled biometric cleanup

The [cleanup job](./jobs/cleanup_biometrics/README.md) includes its container,
deployment script, dry-run mode, daily Cloud Scheduler setup, and isolated tests.
It removes expired attendee vectors and metadata from root records and mirrors,
preserving registration, consent, and stored photos. Redeploy the updated embedder
before activating cleanup so retired vectors cannot be recreated by retries.
No deletion schedule is active merely because this code exists in the repository.

## Staff workspaces and photo uploads

Staff land in the workspace for their saved role; portal URL hints do not override
it. Superusers open an event from the event directory to manage it directly, with
their existing administrator permissions. **Create event** opens the shared event
form without a manager dashboard behind it; saving opens the newly created event,
and cancelling returns to the superuser dashboard. The creator is the initial
owner; ownership can be transferred through Accounts. Public check-in links have no portal
navigation. The preview opened from event management is read-only.

Photographers see only their own original uploads for the selected event. New
uploads store a SHA-256 fingerprint of input bytes to skip exact duplicates for
that photographer/event, including renamed copies and copies in the same batch.
This is not visual similarity matching or a cross-user transactional uniqueness
guarantee. Older uploads without fingerprints cannot be reliably deduplicated;
repeated filenames are labeled separately.

JPEG, PNG, WebP, HEIC, and HEIF are accepted up to 30 MB. HEIC/HEIF is converted
on-device to JPEG at quality 0.98 in a worker, using the bundled `heic-to`
decoder; no external conversion endpoint is called. Conversion is limited to 60
seconds and uploads to three minutes. HEIC source bytes/metadata are not retained:
the uploaded JPEG is also what the matching pipeline and private galleries use.
RAW formats are explicitly rejected with an export-to-JPEG instruction.

Deploy the updated Firestore rules to enforce owner/uploader/admin-only photo
metadata reads. The existing fail-closed Storage policy is unchanged: if that
policy is deployed, staff uploads/downloads still require the separately planned
authorized Storage flow. File conversion does not grant Storage access.

Run `npm run test:uploads`, `npm run lint`, and `npm run build` after installation.
Test a real HEIC from the target phone/browser before production deployment.
