#!/usr/bin/env bash
set -e

# Configuration
PROJECT_ID="${GCP_PROJECT_ID:-mids-capstone-ajt}"
REGION="${GCP_REGION:-us-east1}"
JOB_NAME="embed-checkins"
IMAGE_TAG="gcr.io/${PROJECT_ID}/${JOB_NAME}:latest"
STORAGE_BUCKET="${STORAGE_BUCKET:-${PROJECT_ID}.firebasestorage.app}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-ai-studio-a1858ef2-f062-409f-aaff-1218861a9484}"

echo "==================================================================="
echo "  Deploying Cloud Run Job 1: AuraFace-v1 Check-In Embedder"
echo "  Project:   ${PROJECT_ID}"
echo "  Region:    ${REGION}"
echo "  Image:     ${IMAGE_TAG}"
echo "  Firestore: ${DATABASE_ID}"
echo "==================================================================="

# Verify gcloud CLI is available
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed or not in PATH."
  echo "Please install Google Cloud SDK: https://cloud.google.com/sdk/docs/install"
  exit 1
fi

# Ensure project context is set
gcloud config set project "${PROJECT_ID}"

echo ""
echo "[1/3] Building and pushing container image via Google Cloud Build..."
gcloud builds submit --tag "${IMAGE_TAG}" .

echo ""
echo "[2/3] Creating/Updating Cloud Run Job '${JOB_NAME}'..."
gcloud run jobs deploy "${JOB_NAME}" \
  --image "${IMAGE_TAG}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --cpu 2 \
  --memory 2Gi \
  --max-retries 1 \
  --task-timeout 15m \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},STORAGE_BUCKET=${STORAGE_BUCKET},FIRESTORE_DATABASE_ID=${DATABASE_ID}"

echo ""
echo "[3/3] Deployment Successful!"
echo "==================================================================="
echo "To execute Job 1 on command, run:"
echo "  gcloud run jobs execute ${JOB_NAME} --region ${REGION} --project ${PROJECT_ID}"
echo ""
echo "To view execution logs, run:"
echo "  gcloud logging read \"resource.type=cloud_run_job AND resource.labels.job_name=${JOB_NAME}\" --limit 50"
echo "==================================================================="
