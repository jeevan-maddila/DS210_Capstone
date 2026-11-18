#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${GCP_PROJECT_ID:-mids-capstone-ajt}"
REGION="${GCP_REGION:-us-east1}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-ai-studio-a1858ef2-f062-409f-aaff-1218861a9484}"
JOB_NAME="cleanup-biometrics"
SCHEDULER_NAME="cleanup-biometrics-daily"
SCHEDULE="${CLEANUP_SCHEDULE:-0 3 * * *}"
TIME_ZONE="${CLEANUP_TIME_ZONE:-America/New_York}"
APPLY="${APPLY:-false}"
REPOSITORY="${ARTIFACT_REPOSITORY:-masquerade-jobs}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${JOB_NAME}:latest"
RUNNER="biometric-cleanup@${PROJECT_ID}.iam.gserviceaccount.com"
INVOKER="biometric-cleanup-scheduler@${PROJECT_ID}.iam.gserviceaccount.com"

command -v gcloud >/dev/null || { echo 'Install the Google Cloud CLI first.' >&2; exit 1; }
[[ "$APPLY" == true || "$APPLY" == false ]] || { echo 'APPLY must be true or false.' >&2; exit 1; }

gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com firestore.googleapis.com \
  --project="$PROJECT_ID"

for ACCOUNT in biometric-cleanup biometric-cleanup-scheduler; do
  if ! gcloud iam service-accounts describe "${ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
      --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$ACCOUNT" --project="$PROJECT_ID"
  fi
done

# Only the job runtime can read/update Firestore. The scheduler can only invoke it.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNNER}" --role=roles/datastore.user --condition=None --quiet >/dev/null

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" \
    --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" --repository-format=docker \
    --location="$REGION" --project="$PROJECT_ID"
fi

SCHEDULE_EXISTS=false
if gcloud scheduler jobs describe "$SCHEDULER_NAME" --location="$REGION" \
    --project="$PROJECT_ID" >/dev/null 2>&1; then
  SCHEDULE_EXISTS=true
  gcloud scheduler jobs pause "$SCHEDULER_NAME" --location="$REGION" --project="$PROJECT_ID"
fi

gcloud builds submit "$SCRIPT_DIR" --tag="$IMAGE" --project="$PROJECT_ID"
JOB_ARGS=--dry-run
if [[ "$APPLY" == true ]]; then JOB_ARGS=--apply; fi
gcloud run jobs deploy "$JOB_NAME" --image="$IMAGE" --region="$REGION" --project="$PROJECT_ID" \
  --service-account="$RUNNER" --tasks=1 --parallelism=1 --cpu=1 --memory=512Mi \
  --max-retries=1 --task-timeout=30m --args="$JOB_ARGS" \
  --set-env-vars="GCP_PROJECT_ID=${PROJECT_ID},FIRESTORE_DATABASE_ID=${DATABASE_ID}"

gcloud run jobs add-iam-policy-binding "$JOB_NAME" --region="$REGION" --project="$PROJECT_ID" \
  --member="serviceAccount:${INVOKER}" --role=roles/run.invoker --quiet >/dev/null

if [[ "$APPLY" == true ]]; then
  OPERATION=create
  if [[ "$SCHEDULE_EXISTS" == true ]]; then OPERATION=update; fi
  gcloud scheduler jobs "$OPERATION" http "$SCHEDULER_NAME" \
    --project="$PROJECT_ID" --location="$REGION" --schedule="$SCHEDULE" --time-zone="$TIME_ZONE" \
    --uri="https://run.googleapis.com/v2/projects/${PROJECT_ID}/locations/${REGION}/jobs/${JOB_NAME}:run" \
    --http-method=POST --headers=Content-Type=application/json --message-body='{}' \
    --oauth-service-account-email="$INVOKER" \
    --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
  if [[ "$SCHEDULE_EXISTS" == true ]]; then
    gcloud scheduler jobs resume "$SCHEDULER_NAME" --location="$REGION" --project="$PROJECT_ID"
  fi
  echo "Daily cleanup enabled: ${SCHEDULE} (${TIME_ZONE})."
else
  echo 'Dry-run job deployed. Its daily schedule is absent or paused; no data is deleted.'
fi
echo "Manual execution: gcloud run jobs execute ${JOB_NAME} --wait --region=${REGION} --project=${PROJECT_ID}"
