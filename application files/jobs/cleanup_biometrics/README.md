# Biometric cleanup

A small Cloud Run Job for **Firestore fields only**. It deletes expired attendee
face vectors and their metadata, preserving the attendee document, registration,
contact details, consent, event links, and check-in photo fields. It never calls
Storage and does not delete selfies or event photos. It does not scan the separate
`photos` collection or remove any biometric data stored there.

## What it does

- Scans `attendees` collection groups in document-ID pages, covering root records
  and `events/{eventId}/attendees/{attendeeId}` mirrors. It reads all attendee
  documents each day, including already-purged ones, to handle legacy schemas.
  Read costs therefore grow with the attendee roster; this is intended for the
  current project size. Other nested paths are skipped.
- Uses `embeddingExpiresAt`, or legacy `deleteOn`. For records without either,
  uses `embeddedAt + 30 days`, then `checkedInAt + 30 days`. ISO strings and
  Firestore timestamps are supported. Invalid explicit dates are skipped and
  counted instead of guessing a retention deadline.
- Re-reads the authoritative root and its existing event mirror in a transaction.
  If the root was refreshed and has not expired, it leaves both alone. An orphan
  mirror uses its own dates. No document is created or deleted.
- Removes only `photoEmbedding`, `embeddingModel`, `embeddingPhotoFingerprint`,
  `embeddedAt`, `embeddingError`, `embeddingExpiresAt`, and legacy `deleteOn`.
  Sets `embeddingStatus: purged` and `biometricsPurgedAt`.
- Updates are idempotent. Concurrent cleanups and retries are safe. Failed updates
  cause a failed execution; logs report aggregate counts and exception types,
  never vectors, attendee IDs, names, or emails. Dry-run candidate counts can
  include the same family twice because no purge marker is written.

The embedder was updated to skip expired/purged records even with `--force`,
recheck that condition inside its write transaction, and preserve an existing
expiration when reprocessing. **Redeploy the embedder before enabling cleanup**;
an old deployed image can still regenerate fields after deletion. The matching
job already rejects expired/missing vectors. To intentionally enroll someone
again, use a deliberate fresh registration; no automatic reset is provided.

## Files and permissions

- [main.py](./main.py): cleanup code and dry-run CLI.
- [Dockerfile](./Dockerfile) and [requirements.txt](./requirements.txt): lightweight
  Python image; no face model, image libraries, GPU, or new npm packages.
- [deploy.sh](./deploy.sh): builds the image, deploys the job, and optionally
  configures Cloud Scheduler using OAuth to the Run Jobs API.
- [tests/test_cleanup.py](./tests/test_cleanup.py): isolated tests, no credentials
  or installed SDK required.

Deployment creates `biometric-cleanup` (Firestore runtime identity) and
`biometric-cleanup-scheduler` (invocation identity). The runtime receives
`roles/datastore.user` in the configured project; the scheduler receives only
`roles/run.invoker` on this job. No Storage role or service-account key is needed.
The human deploying needs permission to enable APIs, build/push images, deploy
jobs, create/update schedules, create service accounts, assign roles, and act as
both service accounts. Cloud Build's build identity also needs Artifact Registry
write permissions. Existing project policies may require an administrator for
these setup steps; the script stops on errors.

## Deploy and verify

Run in Bash, WSL, or Cloud Shell from this directory. Scripts use their own
directory as the build context, so invocation from another directory also works.
All commands specify a project without changing your gcloud default project.

1. Redeploy the updated embedder using its existing deployment workflow. Confirm
   that the deployed image contains the new retention guard.
2. Deploy this job in its default **dry-run** mode (no schedule is created, and an
   existing daily schedule is paused during deployment):

   ```bash
   bash deploy.sh
   gcloud run jobs execute cleanup-biometrics --wait \
     --project=mids-capstone-ajt --region=us-east1
   gcloud logging read \
     'resource.type="cloud_run_job" AND resource.labels.job_name="cleanup-biometrics"' \
     --project=mids-capstone-ajt --limit=30
   ```

3. Review candidate counts, missing dates, and a representative expired test
   record. Then deploy **apply mode** and enable daily execution at 03:00 Eastern:

   ```bash
   APPLY=true CLEANUP_SCHEDULE='0 3 * * *' \
     CLEANUP_TIME_ZONE=America/New_York bash deploy.sh
   ```

   This second command enables real, irreversible field deletion on the next
   scheduled run. It does not execute cleanup immediately. You can manually run
   the same `gcloud run jobs execute` command to apply it immediately after review.

4. Check the test record: vector/metadata removed; `embeddingStatus` is `purged`;
   name, consent, and photo paths unchanged. Check its existing mirror too. Retry
   embedding and verify that it remains purged.

Change the schedule/time zone with the environment variables above, for example
`CLEANUP_SCHEDULE='30 5 * * *'` for 05:30. With a daily sweep, deletion can happen
almost 24 hours after expiry; scheduler delays or execution failures can extend
that. `America/New_York` observes daylight saving time; use `Etc/UTC` if you need
a fixed UTC schedule.

Other optional overrides: `GCP_PROJECT_ID`, `GCP_REGION`,
`FIRESTORE_DATABASE_ID`, and `ARTIFACT_REPOSITORY`. Defaults preserve the existing
named database. This job does **not** use Firestore TTL; do not enable document
TTL on attendee records to implement field cleanup.

## Pause and test

Pause future scheduled executions (does not cancel an execution already running):

```bash
gcloud scheduler jobs pause cleanup-biometrics-daily \
  --project=mids-capstone-ajt --location=us-east1
```

Run isolated tests locally with Python 3.12 or newer:

```bash
python -B -m unittest discover -s tests -v
```

No cloud resources are created by running these tests.
