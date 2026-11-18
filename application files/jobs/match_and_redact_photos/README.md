# Cloud Run Task 2: Photographer Matcher & Privacy Redactor

A containerized batch processing job on **Google Cloud Run** that processes high-resolution event photographs uploaded by photographers:
1. Detects all faces in each photo using official **InsightFace `FaceAnalysis`** with **AuraFace-v1** (Apache 2.0).
2. Performs cosine similarity matching using `app.compute_sim()` against event attendees who checked in with a photo.
3. Tags confirmed consenting attendees in `matchedAttendees` (enabling personal attendee gallery queries).
4. Automatically applies **privacy Gaussian blur** to any face that:
   - Was matched to an attendee who explicitly withheld photo consent (`photoConsentGiven == False`).
   - Was an unconfirmed bystander (similarity < 0.55).
5. Uploads the privacy-cleared marketing copy to `events/{eventId}/photos/cleared/{photoId}.jpg` and updates Firestore status to `'processed'`, unblocking Event Manager access.
6. Preserves the original unblurred photo in `rawStoragePath` for an optional future **Task 3** AI-face regeneration upgrade.

---

## Thumbnail focal point

Successful processing now writes `thumbnailFocus` to the same photo documents as
the cleared output: normalized `x`/`y` coordinates plus `imageWidth` and
`imageHeight`. The point is the center of the union of the existing detected face
bounds. It uses the job's existing detections; it adds no model call or identity
matching step and does not store face boxes. The cleared JPEG keeps the decoded
image dimensions. Failed processing removes stale focal metadata.

The manager grid uses a 16:9 `object-fit: cover` box. Its helper converts the point
and dimensions into CSS positioning that centers the point along cropped axes,
clamping at image edges to avoid blank space. Axes with no overflow cannot pan;
a wide face group may still not fit. Older photos without complete metadata stay
centered. Photographer thumbnails continue showing uncropped originals.

Deploy the web application and rebuild/redeploy **match-photos** for this change.
The Dockerfile caches the existing AuraFace weights at build time. No cloud build
was run during local verification. Existing processed photos receive metadata only
when reprocessed; use the job's documented event/photo scoping and `--force` only
for the records you intend to reprocess. No bulk backfill is automatic.

Focused test: `python -B -m unittest discover -s tests -v` from this directory.

## 1. Directory Structure

```
jobs/match_and_redact_photos/
├── Dockerfile                   # Python 3.11-slim container with pre-cached AuraFace weights
├── requirements.txt             # insightface, onnxruntime, opencv, google-cloud-firestore/storage
├── main.py                      # Task 2 orchestrator, matcher & OpenCV Gaussian blurring
├── deploy.sh                    # One-command build and deploy script
└── README.md                    # Documentation & setup guide
```

---

## 2. Deploying to Google Cloud Run

From your local machine or Google Cloud Shell:

```bash
cd ~/match_and_redact_photos
chmod +x deploy.sh
./deploy.sh
```

---

## 3. Triggering Task 2 on Command

Whenever photographers upload a new batch of event photos:

```bash
gcloud run jobs execute match-photos --region us-east1 --project mids-capstone-ajt
```

To tail real-time execution logs:
```bash
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=match-photos" \
  --limit 50 \
  --project mids-capstone-ajt \
  --format="value(textPayload)"
```

---

## 4. Database Fields Updated on `events/{eventId}/photos/{photoId}`

- `status`: `'processed'` (Event Managers only view and export photos with this status).
- `matchedAttendees`: Array of attendee IDs confirmed and consented in the photo.
- `hasBlurredFaces`: `true` if any non-consenting or unconfirmed faces were blurred.
- `blurredFaceCount`: Number of blurred faces in the image.
- `clearedStoragePath`: Cloud Storage path to the privacy-cleared version for marketing.
- `rawStoragePath`: Cloud Storage path to the original unblurred photo (restricted; preserved for Task 3 AI regeneration).
- `processedAt`: ISO 8601 execution timestamp.
