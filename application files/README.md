<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a1858ef2-f062-409f-aaff-1218861a9484

## Run Locally

**Prerequisites:** Node.js 22 and access to the Firebase project.

1. Install dependencies:

   ```bash
   npm install
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
- `EMAIL_FROM`: a sender on a domain verified in Resend, such as `Lumina <invites@example.com>`.
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
