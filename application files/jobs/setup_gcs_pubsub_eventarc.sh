#!/usr/bin/env bash
set -e

# ==============================================================================
# Google Cloud Setup: GCS Bucket Notifications -> Pub/Sub -> Eventarc -> Cloud Workflows -> Cloud Run Jobs
# Project: mids-capstone-ajt
# Job 1:   embed-checkins (Check-In Face Vectorizer)
# Job 2:   match-photos   (Photographer Face Matcher & Privacy Redactor)
# ==============================================================================

PROJECT_ID="${GCP_PROJECT_ID:-mids-capstone-ajt}"
REGION="${GCP_REGION:-us-east1}"
SERVICE_ACCOUNT="photo-pipeline-runner@${PROJECT_ID}.iam.gserviceaccount.com"

echo "=================================================================="
echo "  Setting up GCS -> Pub/Sub -> Eventarc -> Workflows -> Jobs"
echo "  Project:     ${PROJECT_ID}"
echo "  Region:      ${REGION}"
echo "  Service Acc: ${SERVICE_ACCOUNT}"
echo "=================================================================="

# 1. Set project
gcloud config set project "${PROJECT_ID}"

# 2. Detect or Validate Storage Bucket
echo ""
echo "[1/7] Discovering active Cloud Storage bucket..."
if [ -n "${STORAGE_BUCKET}" ] && gcloud storage buckets describe "gs://${STORAGE_BUCKET#gs://}" &>/dev/null; then
  BUCKET_NAME="${STORAGE_BUCKET#gs://}"
  echo "Using explicitly configured bucket: gs://${BUCKET_NAME}"
else
  # Auto-detect existing bucket in the project matching project name or firebase
  DETECTED_BUCKET=$(gcloud storage buckets list --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null | grep -E "(${PROJECT_ID}|firebasestorage|appspot)" | head -n 1)
  if [ -z "${DETECTED_BUCKET}" ]; then
    # Fallback to the first bucket listed in the project
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

# 3. Enable necessary GCP APIs
echo ""
echo "[2/7] Enabling GCP APIs..."
gcloud services enable \
  firestore.googleapis.com \
  run.googleapis.com \
  pubsub.googleapis.com \
  eventarc.googleapis.com \
  workflows.googleapis.com \
  workflowexecutions.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com

# 4. Create and Provision Service Accounts & Identities
echo ""
echo "[3/7] Configuring Service Accounts and IAM permissions..."

# Create custom pipeline service account if not existing
if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT}" &> /dev/null; then
  gcloud iam service-accounts create photo-pipeline-runner \
    --display-name="Photo Pipeline Runner Service Account"
fi

# Ensure Cloud Storage service agent exists
echo "Provisioning Cloud Storage service identity..."
gcloud beta services identity create --service=storage.googleapis.com --project="${PROJECT_ID}" 2>/dev/null || true
GCS_SERVICE_ACCOUNT="$(gcloud storage service-agent --project="${PROJECT_ID}" 2>/dev/null || echo "")"
if [ -z "${GCS_SERVICE_ACCOUNT}" ]; then
  # Fallback to standard service agent pattern if command didn't output
  PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
  GCS_SERVICE_ACCOUNT="service-${PROJECT_NUMBER}@gs-project-accounts.iam.gserviceaccount.com"
fi
echo "GCS Service Agent: ${GCS_SERVICE_ACCOUNT}"

# Grant required IAM roles to the pipeline runner service account
for ROLE in \
  "roles/workflows.invoker" \
  "roles/run.jobs.executor" \
  "roles/run.developer" \
  "roles/run.viewer" \
  "roles/logging.logWriter" \
  "roles/datastore.user" \
  "roles/storage.objectAdmin"; do
  echo "Granting ${ROLE} to ${SERVICE_ACCOUNT}..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="${ROLE}" \
    --condition=None || true
done

# 5. Create Pub/Sub Topics
echo ""
echo "[4/7] Creating Pub/Sub Topics..."
gcloud pubsub topics create checkin-upload-events 2>/dev/null || true
gcloud pubsub topics create photo-upload-events 2>/dev/null || true

if [ -n "${GCS_SERVICE_ACCOUNT}" ]; then
  gcloud pubsub topics add-iam-policy-binding checkin-upload-events \
    --member="serviceAccount:${GCS_SERVICE_ACCOUNT}" \
    --role="roles/pubsub.publisher" || true

  gcloud pubsub topics add-iam-policy-binding photo-upload-events \
    --member="serviceAccount:${GCS_SERVICE_ACCOUNT}" \
    --role="roles/pubsub.publisher" || true
fi

# 6. Configure Cloud Storage Bucket Notifications with prefix filters
echo ""
echo "[5/7] Configuring GCS Bucket Notifications with prefix filters on gs://${BUCKET_NAME}..."

if gcloud storage buckets describe "gs://${BUCKET_NAME}" &>/dev/null; then
  # Clean up older notifications on this bucket to avoid duplicates
  for notif_id in $(gcloud storage buckets notifications list "gs://${BUCKET_NAME}" --format="value(ID)" 2>/dev/null); do
    gcloud storage buckets notifications delete "gs://${BUCKET_NAME}" --notification="${notif_id}" --quiet 2>/dev/null || true
  done

  # Check-in photos prefix filter -> checkin-upload-events
  gcloud storage buckets notifications create "gs://${BUCKET_NAME}" \
    --topic="projects/${PROJECT_ID}/topics/checkin-upload-events" \
    --event-types=OBJECT_FINALIZE \
    --object-prefix="checkin/"

  # Photographer photos prefix filter -> photo-upload-events
  gcloud storage buckets notifications create "gs://${BUCKET_NAME}" \
    --topic="projects/${PROJECT_ID}/topics/photo-upload-events" \
    --event-types=OBJECT_FINALIZE \
    --object-prefix="photographers/"

  echo "Active notifications on gs://${BUCKET_NAME}:"
  gcloud storage buckets notifications list "gs://${BUCKET_NAME}"
else
  echo "WARNING: Bucket gs://${BUCKET_NAME} was not accessible or does not exist."
  echo "Skipped notification creation. Please check the bucket name and re-run step 5."
fi

# 7. Deploy Cloud Workflows (Orchestrators for Cloud Run Jobs)
echo ""
echo "[6/7] Deploying Cloud Workflows..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOWS_DIR="${SCRIPT_DIR}/workflows"

gcloud workflows deploy trigger-embed-checkins \
  --source="${WORKFLOWS_DIR}/trigger_embed_checkins.yaml" \
  --location="${REGION}" \
  --service-account="${SERVICE_ACCOUNT}"

gcloud workflows deploy trigger-match-photos \
  --source="${WORKFLOWS_DIR}/trigger_match_photos.yaml" \
  --location="${REGION}" \
  --service-account="${SERVICE_ACCOUNT}"

# 8. Create Eventarc Triggers routing Pub/Sub -> Cloud Workflows
echo ""
echo "[7/7] Creating Eventarc Triggers targeting Cloud Workflows..."

# Trigger 1: Check-in upload -> trigger-embed-checkins workflow -> embed-checkins Job
gcloud eventarc triggers delete gcs-checkin-wake-job1 --location="${REGION}" --quiet 2>/dev/null || true
gcloud eventarc triggers create gcs-checkin-wake-job1 \
  --location="${REGION}" \
  --destination-workflow="trigger-embed-checkins" \
  --destination-workflow-location="${REGION}" \
  --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
  --transport-topic="projects/${PROJECT_ID}/topics/checkin-upload-events" \
  --service-account="${SERVICE_ACCOUNT}"

# Trigger 2: Photographer upload -> trigger-match-photos workflow -> match-photos Job
gcloud eventarc triggers delete gcs-photo-wake-job2 --location="${REGION}" --quiet 2>/dev/null || true
gcloud eventarc triggers create gcs-photo-wake-job2 \
  --location="${REGION}" \
  --destination-workflow="trigger-match-photos" \
  --destination-workflow-location="${REGION}" \
  --event-filters="type=google.cloud.pubsub.topic.v1.messagePublished" \
  --transport-topic="projects/${PROJECT_ID}/topics/photo-upload-events" \
  --service-account="${SERVICE_ACCOUNT}"

echo ""
echo "=================================================================="
echo "  ✓ Google Cloud Infrastructure Setup Complete!"
echo "  • Check-in uploads to checkin/ -> checkin-upload-events -> trigger-embed-checkins (concurrency guarded: max 2)"
echo "  • Photographer uploads to photographers/ -> photo-upload-events -> trigger-match-photos (concurrency guarded: max 2)"
echo ""
echo "  [PROD LIVE MODE TIP: Cloud Scheduler Scheduled Batching]"
echo "  For live events with thousands of photos where you prefer scheduled batch runs (e.g. every 3 min):"
echo "  1. Pause instant Eventarc triggers:"
echo "     gcloud eventarc triggers delete gcs-photo-wake-job2 --location=${REGION} --quiet"
echo "  2. Create a recurring Cloud Scheduler job to invoke the workflow every 3 minutes:"
echo "     gcloud scheduler jobs create http scheduled-match-photos \\"
echo "       --schedule='*/3 * * * *' --location=${REGION} \\"
echo "       --uri='https://workflowexecutions.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/workflows/trigger-match-photos/executions' \\"
echo "       --oauth-service-account-email='${SERVICE_ACCOUNT}' \\"
echo "       --message-body='{}'"
echo "=================================================================="
