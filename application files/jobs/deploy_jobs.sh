#!/usr/bin/env bash
set -e

# ==============================================================================
# Deploy Cloud Run Jobs 1 and 2
# Project:  mids-capstone-ajt
# Region:   us-east1
# Job 1:    embed-checkins (Check-In Face Vectorizer)
# Job 2:    match-photos   (Photographer Face Matcher & Privacy Redactor)
# ==============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-mids-capstone-ajt}"
REGION="${GCP_REGION:-us-east1}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-ai-studio-a1858ef2-f062-409f-aaff-1218861a9484}"
SERVICE_ACCOUNT="photo-pipeline-runner@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=================================================================="
echo "  Deploying Cloud Run Jobs 1 & 2 to Google Cloud"
echo "  Project:     ${PROJECT_ID}"
echo "  Region:      ${REGION}"
echo "  Firestore:   ${DATABASE_ID}"
echo "  Service Acc: ${SERVICE_ACCOUNT}"
echo "=================================================================="

gcloud config set project "${PROJECT_ID}"

# Ensure photo-pipeline-runner service account exists
echo ""
echo "[Step 1/4] Ensuring service account ${SERVICE_ACCOUNT} is configured..."
if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT}" &> /dev/null; then
  gcloud iam service-accounts create photo-pipeline-runner \
    --display-name="Photo Pipeline Runner Service Account" 2>/dev/null || true
fi

for ROLE in \
  "roles/run.jobs.executor" \
  "roles/run.developer" \
  "roles/run.viewer" \
  "roles/logging.logWriter" \
  "roles/datastore.user" \
  "roles/storage.objectAdmin"; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="${ROLE}" \
    --condition=None 2>/dev/null || true
done

# Discover or Validate Storage Bucket
echo ""
echo "[Step 2/4] Resolving active Cloud Storage bucket..."
if [ -n "${STORAGE_BUCKET}" ] && gcloud storage buckets describe "gs://${STORAGE_BUCKET#gs://}" &>/dev/null; then
  BUCKET_NAME="${STORAGE_BUCKET#gs://}"
  echo "Using configured bucket: gs://${BUCKET_NAME}"
else
  DETECTED_BUCKET=$(gcloud storage buckets list --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null | grep -E "(${PROJECT_ID}|firebasestorage|appspot)" | head -n 1)
  if [ -z "${DETECTED_BUCKET}" ]; then
    DETECTED_BUCKET=$(gcloud storage buckets list --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null | head -n 1)
  fi

  if [ -n "${DETECTED_BUCKET}" ]; then
    BUCKET_NAME="${DETECTED_BUCKET#gs://}"
    echo "Auto-detected active bucket: gs://${BUCKET_NAME}"
  else
    BUCKET_NAME="${PROJECT_ID}.firebasestorage.app"
    echo "Warning: No existing bucket detected via list. Defaulting to: gs://${BUCKET_NAME}"
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# [3/4] Build and Deploy Job 1: Check-in Embedder
echo ""
echo "[Step 3/4] Building and Deploying Job 1: embed-checkins..."
cd "${SCRIPT_DIR}/embed_checkin_photos"
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/embed-checkins:latest" .

# Optional cleanup of existing job specification before fresh deployment
gcloud run jobs delete embed-checkins --region "${REGION}" --quiet 2>/dev/null || true

gcloud run jobs deploy embed-checkins \
  --image "gcr.io/${PROJECT_ID}/embed-checkins:latest" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --cpu 2 \
  --memory 2Gi \
  --max-retries 1 \
  --task-timeout 15m \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},STORAGE_BUCKET=${BUCKET_NAME},FIRESTORE_DATABASE_ID=${DATABASE_ID}"

# [3/3] Build and Deploy Job 2: Photographer Matcher & Redactor
echo ""
echo "[Step 3/3] Building and Deploying Job 2: match-photos..."
cd "${SCRIPT_DIR}/match_and_redact_photos"
gcloud builds submit --tag "gcr.io/${PROJECT_ID}/match-photos:latest" .

# Optional cleanup of existing job specification before fresh deployment
gcloud run jobs delete match-photos --region "${REGION}" --quiet 2>/dev/null || true

gcloud run jobs deploy match-photos \
  --image "gcr.io/${PROJECT_ID}/match-photos:latest" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --cpu 2 \
  --memory 2Gi \
  --max-retries 1 \
  --task-timeout 15m \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},STORAGE_BUCKET=${BUCKET_NAME},FIRESTORE_DATABASE_ID=${DATABASE_ID}"

echo ""
echo "=================================================================="
echo "  ✓ Deployment Complete!"
echo "  Job 1: embed-checkins deployed (Image: gcr.io/${PROJECT_ID}/embed-checkins:latest)"
echo "  Job 2: match-photos   deployed (Image: gcr.io/${PROJECT_ID}/match-photos:latest)"
echo ""
echo "  To run Job 1 on demand via CLI:"
echo "    gcloud run jobs execute embed-checkins --region ${REGION}"
echo ""
echo "  To run Job 2 on demand via CLI:"
echo "    gcloud run jobs execute match-photos --region ${REGION}"
echo "=================================================================="
