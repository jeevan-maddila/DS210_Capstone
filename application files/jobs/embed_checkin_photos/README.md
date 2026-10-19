# Cloud Run Job 1: Check-In Photo Embedder (AuraFace-v1)

A containerized batch processing job designed for **Google Cloud Run** to process attendee check-in reference photos, generate 512-dimensional facial feature embeddings using **AuraFace-v1** (Apache 2.0 license), and schedule automated `deleteOn` (+30 days) retention timestamps in Firestore.

---

## 1. Model & Licensing Details

- **Model**: `fal/AuraFace-v1` ([Hugging Face Model Card](https://huggingface.co/fal/AuraFace-v1))
- **Weights**: `glintr100.onnx` (~261 MB FP32 ResNet-100 backbone)
- **License**: **Apache 2.0** (Fully permissive for commercial use)
- **Architecture**: ResNet-100 trained with Additive Angular Margin Loss (ArcFace)
- **Output**: 512-dimensional float32 vector, $L_2$-normalized ($\|\mathbf{v}\|_2 = 1.0$)
- **Data Privacy**: 100% self-hosted within your private Google Cloud Run container. No external telemetry, no external API calls, and zero third-party training data exposure.

---

## 2. Directory Structure

```
jobs/embed_checkin_photos/
├── Dockerfile              # Multi-stage image with pre-cached ONNX weights & OpenCV
├── requirements.txt        # Python dependencies (onnxruntime, firebase-admin, etc.)
├── model.py                # AuraFace-v1 loader, YuNet landmark detector & aligner
├── firestore_client.py     # Firestore scanner, batch updater & Storage downloader
├── main.py                 # CLI & Cloud Run Job execution orchestrator
├── deploy.sh               # One-click gcloud build & deployment script
└── README.md               # Documentation & setup guide
```

---

## 3. Prerequisites & Setup (Actions You Must Perform)

Since AI Studio cannot run `gcloud` provisioning commands against your personal Google Cloud account, run the following commands once from your terminal:

### Step 1: Enable Required GCP APIs
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  firebasestorage.googleapis.com \
  --project=mids-capstone-ajt
```

### Step 2: Grant Cloud Run IAM Permissions
Cloud Run jobs execute under the default Compute Engine service account. Grant it access to Firestore and Firebase Storage:
```bash
# 1. Get Project Number
PROJECT_NUMBER=$(gcloud projects describe mids-capstone-ajt --format='value(projectNumber)')

# 2. Grant Firestore Read/Write Access
gcloud projects add-iam-policy-binding mids-capstone-ajt \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"

# 3. Grant Firebase Storage Read Access
gcloud projects add-iam-policy-binding mids-capstone-ajt \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/storage.objectViewer"
```

---

## 4. Deploying to Cloud Run

From your local machine inside `jobs/embed_checkin_photos/`:

```bash
chmod +x deploy.sh
./deploy.sh
```

Or manually:
```bash
# 1. Build & Push Image via Cloud Build
gcloud builds submit --tag gcr.io/mids-capstone-ajt/embed-checkins:latest .

# 2. Deploy Cloud Run Job
gcloud run jobs deploy embed-checkins \
  --image gcr.io/mids-capstone-ajt/embed-checkins:latest \
  --region us-east1 \
  --project mids-capstone-ajt \
  --cpu 2 \
  --memory 2Gi \
  --max-retries 1 \
  --task-timeout 15m \
  --set-env-vars GCP_PROJECT_ID=mids-capstone-ajt,STORAGE_BUCKET=mids-capstone-ajt.firebasestorage.app
```

---

## 5. Running the Job

### A. Run On-Command via `gcloud` (Manual Trigger)
To trigger the job immediately across all pending check-in photos:
```bash
gcloud run jobs execute embed-checkins --region us-east1 --project mids-capstone-ajt
```

To target a specific event:
```bash
gcloud run jobs execute embed-checkins \
  --region us-east1 \
  --project mids-capstone-ajt \
  --args="--event-id=evt_example123"
```

### B. View Real-Time Logs
```bash
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=embed-checkins" \
  --limit 50 \
  --project mids-capstone-ajt \
  --format="value(textPayload)"
```

---

## 6. Local Development & Testing

You can also run the worker directly on your local laptop to verify embeddings before cloud deployment:

```bash
# 1. Create Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 2. Test single image extraction
python main.py --local-image /path/to/test_selfie.jpg

# 3. Test Firestore batch run (Dry-Run mode, does not mutate database)
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
python main.py --dry-run
```

---

## 7. Database Updates Performed by Job 1

For every attendee document at `events/{eventId}/attendees/{attendeeId}`:
- `photoEmbedding`: Array of 512 floats ($L_2$-normalized). Ready for KNN search queries by Job 2.
- `deleteOn`: ISO 8601 string (`checkedInAt + 30 days`). Ready for the automated vector cleanup job.
- `photoProcessingStatus`: `'processed'` (or `'no_face_detected'` if unaligned).
- `processedAt`: ISO 8601 timestamp of worker execution.
