#!/usr/bin/env bash
set -e

PROJECT_ID="${GCP_PROJECT_ID:-mids-capstone-ajt}"
REGION="${GCP_REGION:-us-east1}"
JOB_NAME="match-photos"
IMAGE_TAG="gcr.io/${PROJECT_ID}/${JOB_NAME}:latest"
STORAGE_BUCKET="${STORAGE_BUCKET:-${PROJECT_ID}.firebasestorage.app}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-ai-studio-a1858ef2-f062-409f-aaff-1218861a9484}"

echo "==================================================================="
echo "  Deploying Task 2: Photographer Matcher & Privacy Redactor"
echo "  Project:   ${PROJECT_ID}"
echo "  Region:    ${REGION}"
echo "  Image:     ${IMAGE_TAG}"
echo "  Firestore: ${DATABASE_ID}"
echo "==================================================================="

gcloud config set project "${PROJECT_ID}"

echo ""
echo "[1/2] Building container image via Google Cloud Build..."
gcloud builds submit --tag "${IMAGE_TAG}" .

echo ""
echo "[2/2] Deploying Cloud Run Job '${JOB_NAME}'..."
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
echo "Deployment Complete!"
echo "To execute Task 2 on command, run:"
echo "  gcloud run jobs execute ${JOB_NAME} --region ${REGION} --project ${PROJECT_ID}"
