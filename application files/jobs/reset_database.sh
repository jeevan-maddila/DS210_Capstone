#!/usr/bin/env bash
set -e

PROJECT_ID="${GCP_PROJECT_ID:-mids-capstone-ajt}"
DATABASE_ID="${FIRESTORE_DATABASE_ID:-ai-studio-a1858ef2-f062-409f-aaff-1218861a9484}"

# Resolve Storage Bucket
if [ -n "${STORAGE_BUCKET}" ]; then
  BUCKET_NAME="${STORAGE_BUCKET#gs://}"
else
  DETECTED_BUCKET=$(gcloud storage buckets list --project="${PROJECT_ID}" --format="value(name)" 2>/dev/null | grep -E "(${PROJECT_ID}|firebasestorage|appspot)" | head -n 1)
  BUCKET_NAME="${DETECTED_BUCKET:-${PROJECT_ID}.firebasestorage.app}"
fi

export GCP_PROJECT_ID="${PROJECT_ID}"
export FIRESTORE_DATABASE_ID="${DATABASE_ID}"
export STORAGE_BUCKET="${BUCKET_NAME}"

echo "=================================================================="
echo "  Resetting Firestore Database & Demo State"
echo "  Project:   ${PROJECT_ID}"
echo "  Database:  ${DATABASE_ID}"
echo "  Storage:   ${BUCKET_NAME}"
echo "=================================================================="

# Ensure dependencies are installed in Cloud Shell or local python environment
if ! python3 -c "from google.cloud import firestore, storage" &>/dev/null; then
  echo "Installing required Python SDKs (google-cloud-firestore, google-cloud-storage)..."
  python3 -m pip install --quiet --user google-cloud-firestore google-cloud-storage 2>/dev/null || \
  pip3 install --quiet --user google-cloud-firestore google-cloud-storage
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Run python reset script
python3 "${SCRIPT_DIR}/reset_database.py" "$@"
