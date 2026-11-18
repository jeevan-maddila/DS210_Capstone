# Deployment TODO

- [x] Write thumbnail focal coordinates/dimensions in successful matching-job results, correct CSS crop positioning, clear stale metadata on failure, and test portrait/wide/edge cases.
- [ ] Build and deploy the updated matcher and web app; verify a newly processed photo's focal thumbnail. Scope any reprocessing of older photos explicitly.

- [x] Remove workspace switching; route by staff role, open admin event management directly, and make internal check-in previews read-only. Public check-in has no portal return link.
- [x] Show photographers their own original uploads, add exact-input duplicate detection for new uploads, and convert HEIC locally to JPEG with visible preparation/errors and bounded timeouts. Remove unsupported RAW promises.
- [ ] Deploy narrowed Firestore photo-read rules and verify HEIC with real phone files. Complete the authorized staff Storage flow if the checked-in fail-closed Storage rules are deployed; these UI changes do not change Storage permissions.

- [x] Separate browser/build dependencies from the Cloud Run runtime, compile the server, and remove unused Motion, Autoprefixer, and direct Google Auth dependencies. Keep the Gemini SDK as a development dependency for its existing test script.
- [ ] Recheck full and runtime-only npm audit reports after dependency upgrades; resolve remaining reachable vulnerabilities and track unpatched upstream findings. Smoke-test the production image and real Firebase authentication/database/storage access before deployment.

- [x] Add superuser account management for existing Firebase users: names, roles, direct photographer assignments, ownership transfers, and protected deletion. Runtime service account permissions and live smoke testing remain deployment steps.

- [ ] Require a valid invitation for staff access: event managers invite photographers to their events; superusers invite staff. Validate invitations server-side and prevent self-assigned privileged profiles in Firestore rules. Preserve existing administrator and test access, and test both email/password and Google sign-in before deployment. Firebase Authentication account creation itself also requires enforcement beyond hiding the signup form.
- [x] Generate event check-in QR codes locally in the browser.
- [x] Remove demo sign-in, simulated role switching, and restoration of saved demo sessions. Google and email/password authentication remain.
- [ ] Validate the real photo-processing pipeline and access rules using Firebase-authenticated accounts.
- [x] Add a biometric-only cleanup job with dry-run mode, retention guards in the embedder, container, deployment/scheduler script, and isolated tests.
- [ ] Redeploy the guarded embedder, deploy and inspect a cleanup dry run, then activate the daily cleanup schedule. Confirm expired vector removal preserves registration and consent; selfie deletion is separate.
- [x] Remove unused manual pipeline controls; upload-triggered jobs remain separate.

- [ ] Migrate the existing Firestore database to a professionally named database (for example, `masquerade-production`). The current database ID contains `ai-studio` and is an actual resource identifier; changing the name in code alone would disconnect the app from its existing data.
  - [ ] Choose the destination database ID and location; confirm migration, backup, downtime, billing, and rollback requirements.
  - [ ] Create the destination database and migrate existing documents using an appropriate Firestore-supported method; validate document counts and representative data.
  - [ ] Update the Firebase client configuration, server environment, job and reset scripts, and any other references to the old database ID. Review and deploy the destination database's security rules and indexes.
  - [ ] Test authentication, check-ins, photo processing, galleries, and access controls against the new database before switching production traffic.
  - [ ] Keep the original database until the migration and rollback plan are verified; retire it only after approval.
