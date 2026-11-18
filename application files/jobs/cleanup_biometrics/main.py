"""Purge expired attendee biometrics without deleting records or Storage objects."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import logging
import os

LOG = logging.getLogger(__name__)
BIOMETRIC_FIELDS = (
    "photoEmbedding", "embeddingModel", "embeddingPhotoFingerprint",
    "embeddedAt", "embeddingError", "embeddingExpiresAt", "deleteOn",
)


def timestamp(value):
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc)


def expiration(data, retention_days=30):
    """Honor explicit expiry first; support legacy ISO strings and older records."""
    for field in ("embeddingExpiresAt", "deleteOn"):
        if field in data:
            return timestamp(data[field])
    for field in ("embeddedAt", "checkedInAt"):
        if field in data:
            created = timestamp(data[field])
            return created + timedelta(days=retention_days) if created else None
    return None


def expired(data, cutoff, retention_days=30):
    if data.get("embeddingStatus") == "purged" or data.get("biometricsPurgedAt"):
        return True
    deadline = expiration(data, retention_days)
    return deadline is not None and deadline <= cutoff


def purge_patch(data, cutoff, delete_field):
    """A fixed allowlist makes registration, consent, and photo fields untouchable."""
    if (data.get("embeddingStatus") == "purged"
            and data.get("biometricsPurgedAt")
            and not any(field in data for field in BIOMETRIC_FIELDS)):
        return None
    patch = {field: delete_field for field in BIOMETRIC_FIELDS if field in data}
    patch.update(embeddingStatus="purged", biometricsPurgedAt=data.get("biometricsPurgedAt") or cutoff)
    return patch


def attendee_path(path):
    parts = path.split("/")
    if len(parts) == 2 and parts[0] == "attendees":
        return parts[1], None
    if len(parts) == 4 and parts[0] == "events" and parts[2] == "attendees":
        return parts[3], parts[1]
    return None


def purge_family(db, reference, cutoff, retention_days, firestore, dry_run=True):
    """Re-read root and mirror before an atomic field-only update.

    The current root record is authoritative. A stale mirror cannot purge a
    refreshed root. Orphan mirrors use their own expiry and are never recreated.
    """
    identity = attendee_path(reference.path)
    if identity is None:
        return 0
    attendee_id, mirror_event_id = identity

    @firestore.transactional
    def apply(transaction):
        root_ref = db.collection("attendees").document(attendee_id)
        root = root_ref.get(transaction=transaction)
        current = root if mirror_event_id is None else reference.get(transaction=transaction)
        if not current.exists:
            return 0
        authority = root if root.exists else current
        data = authority.to_dict() or {}
        if mirror_event_id and root.exists and data.get("eventId") != mirror_event_id:
            return 0
        if not expired(data, cutoff, retention_days):
            return 0

        snapshots = {current.reference.path: current}
        if root.exists:
            snapshots[root.reference.path] = root
        event_id = data.get("eventId") or mirror_event_id
        if isinstance(event_id, str) and event_id and "/" not in event_id:
            mirror_ref = db.collection("events").document(event_id).collection("attendees").document(attendee_id)
            if mirror_ref.path not in snapshots:
                mirror = mirror_ref.get(transaction=transaction)
                if mirror.exists:
                    snapshots[mirror_ref.path] = mirror
        # All reads precede writes. Firestore retries if any read document changes.
        patches = [(snapshot.reference, purge_patch(snapshot.to_dict() or {}, cutoff, firestore.DELETE_FIELD))
                   for snapshot in snapshots.values()]
        patches = [(ref, patch) for ref, patch in patches if patch is not None]
        if not dry_run:
            for ref, patch in patches:
                transaction.update(ref, patch)
        return len(patches)

    return apply(db.transaction())


def run(db, firestore, *, dry_run=True, retention_days=30, page_size=200, now=None):
    cutoff = now or datetime.now(timezone.utc)
    counts = {"scanned": 0, "candidate_updates": 0, "missing_expiry": 0, "errors": 0}
    # A paged scan also finds legacy records without an indexed expiry field.
    # Updating fields does not change document-ID cursor ordering.
    query = db.collection_group("attendees").order_by("__name__").limit(page_size)
    cursor = None
    while True:
        page_query = query.start_after(cursor) if cursor is not None else query
        page = list(page_query.stream())
        if not page:
            break
        for snapshot in page:
            counts["scanned"] += 1
            if attendee_path(snapshot.reference.path) is None:
                continue
            data = snapshot.to_dict() or {}
            if not expired(data, cutoff, retention_days):
                if expiration(data, retention_days) is None:
                    counts["missing_expiry"] += 1
                continue
            if purge_patch(data, cutoff, firestore.DELETE_FIELD) is None:
                continue
            try:
                counts["candidate_updates"] += purge_family(
                    db, snapshot.reference, cutoff, retention_days, firestore, dry_run)
            except Exception as error:
                counts["errors"] += 1
                LOG.error("Biometric cleanup update failed: %s", type(error).__name__)
        cursor = page[-1]
        if len(page) < page_size:
            break
    LOG.info("Biometric cleanup dry_run=%s counts=%s", dry_run, counts)
    if counts["missing_expiry"]:
        LOG.warning("Some records have no usable retention date; inspect and repair their dates.")
    if counts["errors"]:
        raise RuntimeError("Biometric cleanup had failed updates; rerun after resolving the errors")
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true", help="Apply deletions; otherwise dry-run")
    mode.add_argument("--dry-run", action="store_true", help="Report counts without writes (default)")
    parser.add_argument("--retention-days", type=int, default=30, help="Fallback for legacy records without explicit expiry")
    parser.add_argument("--page-size", type=int, default=200)
    args = parser.parse_args()
    if args.retention_days < 1 or not 1 <= args.page_size <= 1000:
        parser.error("retention-days must be positive; page-size must be between 1 and 1000")
    from google.cloud import firestore
    project = os.environ.get("GCP_PROJECT_ID", "mids-capstone-ajt")
    database = os.environ.get("FIRESTORE_DATABASE_ID", "ai-studio-a1858ef2-f062-409f-aaff-1218861a9484")
    db = firestore.Client(project=project, database=database)
    run(db, firestore, dry_run=not args.apply, retention_days=args.retention_days, page_size=args.page_size)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        main()
    except Exception as error:
        LOG.error("Biometric cleanup failed: %s", type(error).__name__)
        raise SystemExit(1) from None
