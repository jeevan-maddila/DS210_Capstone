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
    """Redact a face inside an elliptical OpenCV mask, leaving surroundings unchanged.

    Uses only OpenCV's resize, GaussianBlur, ellipse and copyTo functions.
    Bounding boxes come from the existing face detector; no segmentation model needed.
    """
    height, width = image.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox)
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(width, x2), min(height, y2)
    if x2 <= x1 or y2 <= y1:
        raise RuntimeError("Cannot redact an empty bounding box")

    face_w, face_h = x2 - x1, y2 - y1
    center_x, center_y = (x1 + x2) // 2, (y1 + y2) // 2
    # The ellipse extends slightly beyond the detector's bounding box so
    # forehead, jaw and face edges remain obscured.
    radius_x = max(1, int(round(face_w * 0.62)))
    radius_y = max(1, int(round(face_h * 0.62)))
    left = max(0, center_x - radius_x)
    top = max(0, center_y - radius_y)
    right = min(width, center_x + radius_x + 1)
    bottom = min(height, center_y + radius_y + 1)
    roi = image[top:bottom, left:right]
    roi_h, roi_w = roi.shape[:2]

    # Preserve the existing strong pixelation followed by Gaussian blur.
    block_w = max(1, roi_w // 24)
    block_h = max(1, roi_h // 24)
    small = cv2.resize(roi, (block_w, block_h), interpolation=cv2.INTER_AREA)
    pixelated = cv2.resize(small, (roi_w, roi_h), interpolation=cv2.INTER_NEAREST)
    sigma = max(10.0, min(roi_w, roi_h) / 8.0)
    obscured = cv2.GaussianBlur(pixelated, (0, 0), sigmaX=sigma, sigmaY=sigma)

    mask = np.zeros((roi_h, roi_w), dtype=np.uint8)
    cv2.ellipse(mask, (center_x - left, center_y - top),
                (radius_x, radius_y), 0, 0, 360, 255, -1)
    cv2.copyTo(obscured, mask, roi)


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


# ---- Cloud Run TASK2 entrypoint ----

import argparse
from datetime import datetime, timezone
import json
import logging
import os
import sys

import numpy as np
from google.cloud import firestore


LOG = logging.getLogger("task2")
# These are starting configuration values, NOT a validated confidence/accuracy claim.
MATCH_THRESHOLD = float(os.getenv("FACE_COSINE_THRESHOLD", "0.55"))
MATCH_MARGIN = float(os.getenv("FACE_MIN_MARGIN", "0.05"))


def parse_args():
    parser = argparse.ArgumentParser(description="Event photo privacy redaction")
    parser.add_argument("--event-id")
    parser.add_argument("--photo-id")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--scan-limit", type=int, default=100, help="Maximum documents per event-scoped photo query")
    parser.add_argument("--global-scan-limit", type=int, default=25, help="Maximum pending root photos fetched when launched without IDs")
    parser.add_argument("--max-attendees-per-source", type=int, default=500, help="Fail closed if any attendee collection/query exceeds this count")
    parser.add_argument("--force", action="store_true", help="Explicitly reprocess photos already marked processed")
    parser.add_argument("--pubsub-message")
    return parser.parse_args()


def parse_pubsub(value):
    if not value:
        return None, None
    raw = json.loads(value)
    if "message" in raw and "data" in raw["message"]:
        import base64
        raw = json.loads(base64.b64decode(raw["message"]["data"]))
    name = raw.get("name") or (raw.get("object") or {}).get("name", "")
    parts = name.split("/")
    if len(parts) == 3 and parts[0] == "photographers":
        return parts[1], parts[2].rsplit(".", 1)[0]
    if len(parts) == 4 and parts[0] == "events" and parts[2] == "photos":
        return parts[1], parts[3].rsplit(".", 1)[0]
    return None, None


def collect_photos(db, event_id, photo_id, limit, scan_limit=100, force=False, global_scan_limit=25):
    """Read exclusively /photos. An unscoped job checks a bounded pending queue."""
    if min(limit, scan_limit, global_scan_limit) < 1:
        raise ValueError("All limits must be positive")
    root = db.collection("photos")
    if photo_id:
        snapshots = [root.document(photo_id).get()]
    elif event_id:
        # Composite (eventId, status) index may be needed for this query.
        snapshots = list(root.where("eventId", "==", event_id)
                         .where("status", "==", "pending").limit(scan_limit).stream())
    else:
        snapshots = list(root.where("status", "==", "pending")
                         .limit(min(global_scan_limit, limit)).stream())
    selected = []
    for doc in snapshots:
        if not doc.exists:
            continue
        data = doc.to_dict() or {}
        eid = data.get("eventId")
        if not eid or (event_id and eid != event_id):
            LOG.warning("Skipping root photo %s: missing/conflicting eventId", doc.id)
            continue
        if not force and data.get("status") != "pending":
            continue
        sources = [v for v in (data.get("storagePath"), data.get("downloadUrl")) if v]
        selected.append({"event_id": eid, "photo_id": doc.id,
                         "docs": [doc.reference], "sources": sources})
        if len(selected) >= limit:
            break
    LOG.info("Task 2 root-only photo reads: %d documents; selected=%d", len(snapshots), len(selected))
    return selected


def load_attendees(db, event_id, max_per_source=500):
    """One authoritative root attendee roster; fail closed on incomplete data."""
    query = db.collection("attendees").where("eventId", "==", event_id)
    snapshots = list(query.limit(max_per_source + 1).stream())
    if len(snapshots) > max_per_source:
        raise RuntimeError(f"Event {event_id} exceeds attendee query cap {max_per_source}")
    diagnostics = {"records": len(snapshots), "model_mismatch": 0,
                   "status_incomplete": 0, "expiry_missing_or_invalid": 0,
                   "expired": 0, "invalid_vector": 0, "valid_embeddings": 0,
                   "without_consent_true": 0}
    usable = []
    now = datetime.now(timezone.utc)
    for snap in snapshots:
        data = snap.to_dict() or {}
        consent = data.get("photoConsentGiven") is True
        if not consent:
            diagnostics["without_consent_true"] += 1
        if data.get("embeddingModel") != MODEL_SIGNATURE:
            diagnostics["model_mismatch"] += 1
            continue
        if data.get("embeddingStatus") != "completed":
            diagnostics["status_incomplete"] += 1
            continue
        expiry = data.get("embeddingExpiresAt")
        if not isinstance(expiry, datetime):
            diagnostics["expiry_missing_or_invalid"] += 1
            continue
        if expiry.replace(tzinfo=expiry.tzinfo or timezone.utc) <= now:
            diagnostics["expired"] += 1
            continue
        emb = unit_vector(data.get("photoEmbedding"))
        if emb is None:
            diagnostics["invalid_vector"] += 1
            continue
        diagnostics["valid_embeddings"] += 1
        usable.append({"id": snap.id, "consent": consent, "embedding": emb})
    LOG.info("Task 2 root-only attendee lookup event=%s retrieved=%d usable=%d stats=%s",
             event_id, len(snapshots), len(usable), diagnostics)
    if diagnostics["model_mismatch"]:
        LOG.warning("Attendee model signature mismatch; expected %s", MODEL_SIGNATURE)
    if not usable:
        LOG.warning("No usable templates for event=%s", event_id)
    return usable


def match_face(embedding, attendees):
    """Return (consenting attendee ID or None, diagnostic reason, best similarity).

    This does not lower thresholds or weaken the privacy check.
    """
    if embedding is None:
        return None, "face_embedding_unavailable", None
    if not attendees:
        return None, "no_usable_attendee_templates", None
    sims = sorted(
        [(float(np.dot(embedding, person["embedding"])), person) for person in attendees],
        key=lambda pair: pair[0], reverse=True,
    )
    best_score, best = sims[0]
    runner_up = sims[1][0] if len(sims) > 1 else -1.0
    if best_score < MATCH_THRESHOLD:
        return None, "below_similarity_threshold", best_score
    if best_score - runner_up < MATCH_MARGIN:
        return None, "ambiguous_margin", best_score
    if not best["consent"]:
        return None, "consent_not_confirmed", best_score
    return best["id"], "matched", best_score


def process_photo(db, bucket, engine, row, cache, max_attendees_per_source=500):
    event_id, photo_id = row["event_id"], row["photo_id"]
    label = f"{event_id}/{photo_id}"
    try:
        if event_id not in cache:
            cache[event_id] = load_attendees(db, event_id, max_per_source=max_attendees_per_source)
        image = read_from_sources(bucket, *row["sources"])
        faces = engine.detect(image)
        # Empty detection is NOT proof that a crowded/photo of people is safe.
        if not faces:
            raise RuntimeError("Detector found no faces; human review required before publication")

        cleared = image.copy()
        matched_ids = set()
        count_blurred = 0
        for face in faces:
            consenting_id, match_reason, best_similarity = match_face(face["embedding"], cache[event_id])
            LOG.info("%s face match: reason=%s best_cosine=%s threshold=%.3f margin=%.3f",
                     label, match_reason,
                     "unavailable" if best_similarity is None else f"{best_similarity:.4f}",
                     MATCH_THRESHOLD, MATCH_MARGIN)
            if consenting_id is None:
                blur_face(cleared, face["bbox"])
                count_blurred += 1
            else:
                matched_ids.add(consenting_id)

        cleared_path = f"events/{event_id}/photos/cleared/{photo_id}.jpg"
        # If uploading fails, DO NOT replace the output with original bytes,
        # a data URL in Firestore, or a misleading "processed" state.
        cleared_url = upload_cleared_image(bucket, cleared_path, cleared)
        update_existing(db, row["docs"], {
            "status": "processed",
            "matchedAttendees": sorted(matched_ids),
            "hasBlurredFaces": count_blurred > 0,
            "blurredFaceCount": count_blurred,
            "detectedFaceCount": len(faces),
            "clearedStoragePath": cleared_path,
            "clearedDownloadUrl": cleared_url,
            "recognitionModel": MODEL_SIGNATURE,
            "processedAt": datetime.now(timezone.utc),
            "processingError": None,
        })
        LOG.info("%s published: %d faces, %d redacted, %d consenting attendees", label, len(faces), count_blurred, len(matched_ids))
        return True
    except Exception as exc:
        LOG.error("%s requires review: %s", label, exc)
        # Revoke any previously published bearer-token URL where possible.
        try:
            bucket.blob(f"events/{event_id}/photos/cleared/{photo_id}.jpg").delete()
        except Exception as delete_error:
            LOG.warning("Could not revoke previously cleared photo for %s: %s", label, delete_error)
        # Quarantine without exposing originals or implying privacy processing succeeded.
        try:
            update_existing(db, row["docs"], {
                "status": "needs_review",
                "matchedAttendees": [],
                "hasBlurredFaces": False,
                "blurredFaceCount": 0,
                "clearedStoragePath": firestore.DELETE_FIELD,
                "clearedDownloadUrl": firestore.DELETE_FIELD,
                "processingError": str(exc)[:500],
                "processedAt": firestore.DELETE_FIELD,
            })
        except Exception:
            LOG.exception("Failed to quarantine photo %s in Firestore", label)
        return False


def main():
    args = parse_args()
    if args.limit < 1 or args.scan_limit < 1 or args.global_scan_limit < 1 or args.max_attendees_per_source < 1 or not (0 <= MATCH_THRESHOLD <= 1) or not (0 <= MATCH_MARGIN <= 1):
        raise ValueError("Invalid limits, FACE_COSINE_THRESHOLD or FACE_MIN_MARGIN")
    event_from_upload, photo_from_upload = parse_pubsub(args.pubsub_message)
    event_id = args.event_id or event_from_upload
    photo_id = args.photo_id or photo_from_upload
    if args.pubsub_message and not (event_from_upload or photo_from_upload) and not (args.event_id or args.photo_id):
        LOG.info("Skipping unrelated Storage notification (including cleared images)")
        return
    if not (event_id or photo_id):
        LOG.info("No IDs supplied; running bounded pending-photo discovery instead of a full collection scan")
    db, bucket = firestore_client(), storage_bucket()
    photos = collect_photos(db, event_id, photo_id, args.limit, scan_limit=args.scan_limit, force=args.force, global_scan_limit=args.global_scan_limit)
    LOG.info("Found %d pending photograph(s)", len(photos))
    if not photos:
        return
    engine = FaceEngine(det_size=1024)
    cache = {}
    failures = sum(not process_photo(db, bucket, engine, photo, cache, max_attendees_per_source=args.max_attendees_per_source) for photo in photos)
    LOG.info("Task 2 done: attempted=%d, review_required=%d", len(photos), failures)
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(levelname)s %(message)s")
    main()
