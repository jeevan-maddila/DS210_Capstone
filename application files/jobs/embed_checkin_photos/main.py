"""Shared helpers for Task 1 and Task 2.

Deploy this file alongside each task's main.py. The recognition and detector weights
are downloaded from the explicit fal/AuraFace-v1 Hugging Face repository; there are
NO fake embedding, Haar-cascade or unaligned-crop fallbacks.
"""
from __future__ import annotations

import base64
import logging
import os
from pathlib import Path
import urllib.parse
from uuid import uuid4

import cv2
import numpy as np
from google.cloud import firestore, storage
from huggingface_hub import snapshot_download
from insightface.app import FaceAnalysis

LOG = logging.getLogger(__name__)
PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "mids-capstone-ajt")
DATABASE_ID = os.environ.get("FIRESTORE_DATABASE_ID", "ai-studio-a1858ef2-f062-409f-aaff-1218861a9484")
BUCKET_NAME = os.environ.get("STORAGE_BUCKET", "mids-capstone-ajt.firebasestorage.app")
MODEL_REPO = "fal/AuraFace-v1"
MODEL_REVISION = os.environ.get("HF_MODEL_REVISION", "af6d057")
MODEL_ROOT = Path(os.environ.get("MODEL_ROOT", "/app"))
PACK_NAME = "auraface"
MODEL_SIGNATURE = f"fal/AuraFace-v1@{MODEL_REVISION}:glintr100:insightface-aligned-v1"
REQUIRED_WEIGHTS = ("glintr100.onnx", "scrfd_10g_bnkps.onnx")
MAX_IMAGE_BYTES = 30 * 1024 * 1024


def firestore_client():
    return firestore.Client(project=PROJECT_ID, database=DATABASE_ID) if DATABASE_ID != "(default)" else firestore.Client(project=PROJECT_ID)


def storage_bucket():
    return storage.Client(project=PROJECT_ID).bucket(BUCKET_NAME)


def unit_vector(candidate):
    """Accept only genuine, finite, approximately normalized 512-D embeddings."""
    if candidate is None:
        return None
    try:
        vector = np.asarray(candidate, dtype=np.float32).reshape(-1)
        length = float(np.linalg.norm(vector))
        if vector.shape != (512,) or not np.isfinite(vector).all() or not (0.99 <= length <= 1.01):
            return None
        return vector / length
    except (TypeError, ValueError):
        return None


class FaceEngine:
    def __init__(self, det_size: int = 1024):
        pack_dir = MODEL_ROOT / "models" / PACK_NAME
        if not all((pack_dir / name).is_file() for name in REQUIRED_WEIGHTS):
            if os.environ.get("HF_LOCAL_FILES_ONLY") == "1":
                raise RuntimeError(f"Missing AuraFace model files in {pack_dir}; rebuild container with weights")
            pack_dir.mkdir(parents=True, exist_ok=True)
            LOG.info("Downloading AuraFace recognition and detection models from Hugging Face")
            snapshot_download(
                repo_id=MODEL_REPO,
                revision=MODEL_REVISION,
                local_dir=str(pack_dir),
                allow_patterns=list(REQUIRED_WEIGHTS),
            )
        for name in REQUIRED_WEIGHTS:
            if not (pack_dir / name).is_file():
                raise RuntimeError(f"Missing required model: {pack_dir / name}")

        # InsightFace handles SCRFD detection, five-point face alignment, and ArcFace
        # preprocessing. FaceAnalysis is intentionally restricted to this model pack.
        self.app = FaceAnalysis(
            name=PACK_NAME,
            root=str(MODEL_ROOT),
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        models = getattr(self.app, "models", {})
        if "detection" not in models or "recognition" not in models:
            raise RuntimeError("AuraFace model pack must contain both detection and recognition modules")
        loaded_recognition_path = Path(str(getattr(models["recognition"], "model_file", ""))).name
        if loaded_recognition_path and loaded_recognition_path != "glintr100.onnx":
            raise RuntimeError(f"Unexpected recognition model loaded: {loaded_recognition_path}")
        self.app.prepare(ctx_id=-1, det_size=(det_size, det_size), det_thresh=0.35)
        LOG.info("AuraFace loaded: detector + glintr100 recognition; det_size=%d", det_size)

    def detect(self, bgr_image):
        """List of {'bbox': (x1,y1,x2,y2), 'embedding': ndarray | None}.

        No detection does NOT establish that a photograph contains no people.
        """
        if bgr_image is None or bgr_image.ndim != 3 or bgr_image.shape[2] != 3:
            raise ValueError("Expected a BGR color image")
        faces = self.app.get(bgr_image, max_num=0)
        height, width = bgr_image.shape[:2]
        results = []
        for face in faces:
            box = np.asarray(face.bbox, dtype=float)
            if box.shape != (4,) or not np.isfinite(box).all():
                raise RuntimeError("Detector returned invalid face coordinates")
            x1, y1, x2, y2 = box
            bbox = (max(0, int(x1)), max(0, int(y1)), min(width, int(np.ceil(x2))), min(height, int(np.ceil(y2))))
            if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                raise RuntimeError("Detector returned empty face rectangle")
            emb = unit_vector(getattr(face, "normed_embedding", None))
            results.append({"bbox": bbox, "embedding": emb})
        return results


def _limit_size(payload: bytes) -> bytes:
    if len(payload) > MAX_IMAGE_BYTES:
        raise ValueError(f"Image exceeds {MAX_IMAGE_BYTES // (1024 * 1024)} MiB limit")
    return payload


def download_image(bucket, source: str | None) -> bytes:
    """Download from exact GCS path, gs://, Firebase Storage URL or HTTPS URL.

    Known Firebase URLs are resolved through the authenticated GCS client, avoiding
    missing download-token errors. No speculative or cross-event path rewrites.
    """
    if not isinstance(source, str) or not source.strip():
        raise ValueError("Missing image source")
    if source.startswith("data:image/"):
        try:
            return _limit_size(base64.b64decode(source.split(",", 1)[1], validate=True))
        except (ValueError, IndexError) as error:
            raise ValueError("Malformed base64 image") from error

    value = source
    if source.startswith("gs://"):
        parsed = urllib.parse.urlparse(source)
        if parsed.netloc != bucket.name:
            raise ValueError("Image is stored in a different bucket")
        value = parsed.path.lstrip("/")
    elif source.startswith("https://"):
        parsed = urllib.parse.urlparse(source)
        host = (parsed.hostname or "").lower()
        if host == "firebasestorage.googleapis.com":
            parts = parsed.path.split("/o/", 1)
            marker = "/v0/b/" + bucket.name + "/o/"
            if parsed.path.startswith(marker) and len(parts) == 2:
                value = urllib.parse.unquote(parts[1])
            else:
                raise ValueError("Unexpected Firebase Storage URL / bucket")
        elif host == "storage.googleapis.com":
            prefix = "/" + bucket.name + "/"
            if not parsed.path.startswith(prefix):
                raise ValueError("Unexpected Google Storage bucket")
            value = urllib.parse.unquote(parsed.path[len(prefix):])
        elif host == bucket.name + ".storage.googleapis.com":
            value = urllib.parse.unquote(parsed.path.lstrip("/"))
        else:
            raise ValueError(f"Unsupported remote image host: {host}")
    elif "://" in source:
        raise ValueError("Unsupported image URL scheme")

    value = value.lstrip("/")
    if not value or ".." in Path(value).parts:
        raise ValueError("Invalid image object path")
    payload = bucket.blob(value).download_as_bytes()
    return _limit_size(payload)


def decode_image(payload: bytes):
    image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("OpenCV could not decode image")
    return image


def read_from_sources(bucket, *sources):
    errors = []
    for src in dict.fromkeys(s for s in sources if s):
        try:
            return decode_image(download_image(bucket, src))
        except Exception as exc:
            errors.append(f"{type(exc).__name__}: {exc}")
    raise RuntimeError("Unable to load photo from the document sources: " + "; ".join(errors or ["no path or URL"]))


def update_existing(db, refs, changes):
    """Atomically update existing mirrors only. Never create ghost attendee/photo docs."""
    unique = {ref.path: ref for ref in refs}
    if not unique:
        raise RuntimeError("No Firestore references to update")
    batch = db.batch()
    for ref in unique.values():
        batch.update(ref, changes)
    batch.commit()


def blur_face(image, bbox):
    """Aggressive rectangular pixelation + blur, with padding for face edges."""
    height, width = image.shape[:2]
    x1, y1, x2, y2 = bbox
    pad_x = int((x2 - x1) * 0.30)
    pad_y = int((y2 - y1) * 0.30)
    x1, y1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
    x2, y2 = min(width, x2 + pad_x), min(height, y2 + pad_y)
    if x2 <= x1 or y2 <= y1:
        raise RuntimeError("Cannot redact an empty bounding box")
    roi = image[y1:y2, x1:x2]
    # The source is downsampled to a very small grid before enlargement.
    block_w = max(1, (x2 - x1) // 24)
    block_h = max(1, (y2 - y1) // 24)
    small = cv2.resize(roi, (block_w, block_h), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(small, (x2 - x1, y2 - y1), interpolation=cv2.INTER_NEAREST)
    sigma = max(10.0, min(x2 - x1, y2 - y1) / 8.0)
    image[y1:y2, x1:x2] = cv2.GaussianBlur(pixelated, (0, 0), sigmaX=sigma, sigmaY=sigma)


def upload_cleared_image(bucket, storage_path: str, bgr_image):
    ok, encoded = cv2.imencode(".jpg", bgr_image, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise RuntimeError("Failed to encode cleared photograph")
    token = str(uuid4())
    blob = bucket.blob(storage_path)
    # Firebase's download URL requires a download token on the GCS object.
    # Such a URL is bearer-accessible: only put privacy-cleared photos here.
    blob.metadata = {"firebaseStorageDownloadTokens": token}
    blob.cache_control = "private, no-store"
    blob.upload_from_string(encoded.tobytes(), content_type="image/jpeg")
    encoded_path = urllib.parse.quote(storage_path, safe="")
    encoded_bucket = urllib.parse.quote(bucket.name, safe="")
    url = f"https://firebasestorage.googleapis.com/v0/b/{encoded_bucket}/o/{encoded_path}?alt=media&token={token}"
    return url


# ---- Cloud Run TASK1 entrypoint ----

import argparse
from datetime import datetime, timedelta, timezone
import json
import hashlib
import logging
import os
import sys

from google.cloud import firestore


LOG = logging.getLogger("task1")


def parse_args():
    parser = argparse.ArgumentParser(description="Check-in face embedder")
    parser.add_argument("--event-id")
    parser.add_argument("--attendee-id")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--scan-limit", type=int, default=100, help="Maximum documents fetched per event-scoped source")
    parser.add_argument("--force", action="store_true", help="Explicitly regenerate an existing embedding")
    parser.add_argument("--retention-days", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--local-image")
    parser.add_argument("--pubsub-message")
    return parser.parse_args()


def parse_pubsub(value):
    if not value:
        return None, None
    raw = json.loads(value)
    # CLI can receive either the raw GCS notification or a decoded push envelope.
    if "message" in raw and "data" in raw["message"]:
        import base64
        raw = json.loads(base64.b64decode(raw["message"]["data"]))
    name = raw.get("name") or (raw.get("object") or {}).get("name", "")
    parts = name.split("/")
    if len(parts) == 3 and parts[0] == "checkin":
        return parts[1], parts[2].rsplit(".", 1)[0]
    if len(parts) == 4 and parts[0] == "events" and parts[2] == "checkin":
        return parts[1], parts[3].rsplit(".", 1)[0]
    return None, None


def collect_attendees(db, event_id, attendee_id, limit, force=False, scan_limit=100):
    """Root /attendees is authoritative. Never inspect event mirrors."""
    if limit < 1 or scan_limit < 1:
        raise ValueError("limit and scan_limit must be positive")
    if not (event_id or attendee_id):
        raise ValueError("An event ID or attendee ID is required")
    root = db.collection("attendees")
    if attendee_id:
        snapshots = [root.document(attendee_id).get()]
    else:
        snapshots = list(root.where("eventId", "==", event_id).limit(scan_limit).stream())
    pending = []
    now = datetime.now(timezone.utc)
    for doc in snapshots:
        if not doc.exists:
            continue
        data = doc.to_dict() or {}
        eid = data.get("eventId")
        if not eid or (event_id and eid != event_id):
            LOG.warning("Skipping root attendee %s: missing/conflicting eventId", doc.id)
            continue
        sources = [v for v in (data.get("checkInPhotoPath"), data.get("checkInPhotoUrl")) if v]
        if not sources:
            continue
        fingerprint = hashlib.sha256("\n".join(sorted(sources)).encode()).hexdigest()
        valid = (
            data.get("embeddingModel") == MODEL_SIGNATURE
            and data.get("embeddingStatus") == "completed"
            and data.get("embeddingPhotoFingerprint") == fingerprint
            and unit_vector(data.get("photoEmbedding")) is not None
            and isinstance(data.get("embeddingExpiresAt"), datetime)
            and data["embeddingExpiresAt"].replace(tzinfo=data["embeddingExpiresAt"].tzinfo or timezone.utc) > now
        )
        if force or not valid:
            pending.append({"event_id": eid, "attendee_id": doc.id,
                            "docs": [doc.reference], "photos": sources,
                            "photo_fingerprint": fingerprint})
        if len(pending) >= limit:
            break
    LOG.info("Task 1 root-only reads: %d retrieved documents; %d candidates", len(snapshots), len(pending))
    return pending


def main():
    args = parse_args()
    if args.limit < 1 or args.scan_limit < 1 or args.retention_days < 1:
        raise ValueError("--limit, --scan-limit and --retention-days must be positive")
    event_from_upload, attendee_from_upload = parse_pubsub(args.pubsub_message)
    event_id = args.event_id or event_from_upload
    attendee_id = args.attendee_id or attendee_from_upload
    # An irrelevant bucket notification MUST NOT trigger a global database scan.
    if args.pubsub_message and not (event_from_upload or attendee_from_upload) and not (args.event_id or args.attendee_id):
        LOG.info("Skipping unrelated Storage notification (not a check-in photo)")
        return
    if args.local_image:
        engine = FaceEngine(det_size=640)
        import cv2
        img = cv2.imread(args.local_image)
        if img is None:
            raise RuntimeError("Could not open local image")
        faces = engine.detect(img)
        if len(faces) != 1 or faces[0]["embedding"] is None:
            raise RuntimeError(f"Expected exactly one face with a valid embedding; detected {len(faces)}")
        print(f"Local test OK; embedding length={len(faces[0]['embedding'])}; model={MODEL_SIGNATURE}")
        return

    if not (event_id or attendee_id):
        LOG.error("Skipping unscoped execution; supply --event-id / --attendee-id or a valid upload notification")
        return  # Success exit avoids Cloud Run retry storms without consuming reads.
    db, bucket = firestore_client(), storage_bucket()
    attendees = collect_attendees(db, event_id, attendee_id, args.limit, force=args.force, scan_limit=args.scan_limit)
    LOG.info("Found %d check-in candidates for embedding", len(attendees))
    if not attendees:
        return
    engine = FaceEngine(det_size=640)
    errors = 0
    for row in attendees:
        name = f"{row['event_id']}/{row['attendee_id']}"
        try:
            image = read_from_sources(bucket, *row["photos"])
            faces = engine.detect(image)
            # A check-in photo must be a single-person portrait. No center-crop guessing.
            if len(faces) != 1 or faces[0]["embedding"] is None:
                raise RuntimeError(f"Check-in photo has {len(faces)} validly detected face(s); exactly one required")
            vec = faces[0]["embedding"].astype(float).tolist()
            now = datetime.now(timezone.utc)
            payload = {
                "photoEmbedding": vec,
                "embeddingModel": MODEL_SIGNATURE,
                "embeddingPhotoFingerprint": row["photo_fingerprint"],
                "embeddingStatus": "completed",
                "embeddedAt": now,
                # A cleanup job must remove biometric fields at this time; DO NOT
                # configure Firestore TTL on attendee docs (it deletes the entire doc).
                "embeddingExpiresAt": now + timedelta(days=args.retention_days),
                "embeddingError": None,
                "deleteOn": firestore.DELETE_FIELD,
            }
            if not args.dry_run:
                update_existing(db, row["docs"], payload)
            LOG.info("%s: embedded 512-D face%s", name, " [dry run]" if args.dry_run else "")
        except Exception as exc:
            errors += 1
            LOG.error("%s: %s", name, exc)
            if not args.dry_run:
                try:
                    update_existing(db, row["docs"], {
                        "embeddingStatus": "needs_review", "embeddingError": str(exc)[:500],
                        "photoEmbedding": firestore.DELETE_FIELD,
                        "embeddingModel": firestore.DELETE_FIELD,
                        "embeddingPhotoFingerprint": firestore.DELETE_FIELD,
                    })
                except Exception:
                    LOG.exception("Failed to save embedding error for %s", name)
    LOG.info("Task 1 done: attempted=%d, failed=%d", len(attendees), errors)
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(message)s")
    main()
