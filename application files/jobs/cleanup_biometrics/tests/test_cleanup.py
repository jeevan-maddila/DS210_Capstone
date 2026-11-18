import ast
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("cleanup", HERE / "main.py")
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)
NOW = datetime(2026, 11, 18, tzinfo=timezone.utc)
DELETE = object()
SDK = SimpleNamespace(DELETE_FIELD=DELETE, transactional=lambda callback: callback)


class Reference:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def get(self, transaction=None):
        return Snapshot(self)

    def collection(self, name):
        return Collection(self.db, self.path + "/" + name)


class Snapshot:
    def __init__(self, ref):
        self.reference = ref
        self.id = ref.path.split("/")[-1]
        self.exists = ref.path in ref.db.docs
        self.data = deepcopy(ref.db.docs.get(ref.path))

    def to_dict(self):
        return deepcopy(self.data)


class Collection:
    def __init__(self, db, path):
        self.db, self.path = db, path

    def document(self, name):
        return Reference(self.db, self.path + "/" + name)


class Transaction:
    def __init__(self, db):
        self.db = db

    def update(self, ref, patch):
        if self.db.fail:
            raise RuntimeError("simulated update failure")
        self.db.writes.append((ref.path, patch))
        for key, value in patch.items():
            if value is DELETE:
                self.db.docs[ref.path].pop(key, None)
            else:
                self.db.docs[ref.path][key] = value


class Query:
    def __init__(self, db, size=200, cursor=""):
        self.db, self.size, self.cursor = db, size, cursor

    def order_by(self, name):
        return self

    def limit(self, size):
        return Query(self.db, size, self.cursor)

    def start_after(self, cursor):
        return Query(self.db, self.size, cursor.reference.path)

    def stream(self):
        paths = [path for path in sorted(self.db.docs)
                 if path > self.cursor and path.split("/")[-2] == "attendees"]
        return [Snapshot(Reference(self.db, path)) for path in paths[:self.size]]


class DB:
    def __init__(self, docs):
        self.docs = deepcopy(docs)
        self.writes = []
        self.fail = False

    def collection(self, name):
        return Collection(self, name)

    def collection_group(self, name):
        return Query(self)

    def transaction(self):
        return Transaction(self)


def attendee(**overrides):
    return dict(eventId="event1", fullName="Preserved", email="test@example.invalid",
                consentGiven=True, photoConsentGiven=True, checkInPhotoPath="checkin/event1/a.jpg",
                checkedInAt=NOW - timedelta(days=40), photoEmbedding=[0.5] * 512,
                embeddingExpiresAt=NOW - timedelta(days=1), embeddingStatus="completed",
                embeddingModel="model", **overrides)


class CleanupTests(unittest.TestCase):
    def family(self, root=None, mirror=None):
        return DB({"attendees/a": root or attendee(),
                   "events/event1/attendees/a": mirror or attendee()})

    def purge(self, db, path="attendees/a", dry_run=False):
        return cleanup.purge_family(db, Reference(db, path), NOW, 30, SDK, dry_run)

    def test_deletes_only_biometric_fields_and_preserves_registration_and_photos(self):
        db = self.family()
        before = deepcopy(db.docs)
        self.assertEqual(self.purge(db), 2)
        for path, record in db.docs.items():
            self.assertNotIn("photoEmbedding", record)
            self.assertEqual(record["embeddingStatus"], "purged")
            self.assertEqual(record["biometricsPurgedAt"], NOW)
            for field in ("fullName", "email", "eventId", "consentGiven", "photoConsentGiven", "checkInPhotoPath", "checkedInAt"):
                self.assertEqual(record[field], before[path][field])
        self.assertEqual(set(db.docs), set(before))

    def test_dry_run_never_writes(self):
        db = self.family()
        before = deepcopy(db.docs)
        self.assertEqual(self.purge(db, dry_run=True), 2)
        self.assertEqual(db.docs, before)
        self.assertEqual(db.writes, [])

    def test_retry_is_idempotent(self):
        db = self.family()
        self.purge(db)
        self.assertEqual(self.purge(db), 0)
        self.assertEqual(len(db.writes), 2)

    def test_refreshed_root_protects_against_stale_scan_and_expired_mirror(self):
        db = self.family()
        db.docs["attendees/a"]["embeddingExpiresAt"] = NOW + timedelta(days=10)
        self.assertEqual(self.purge(db, "events/event1/attendees/a"), 0)
        self.assertEqual(db.writes, [])

    def test_no_mirror_is_created_and_orphan_mirror_can_be_cleaned(self):
        db = DB({"attendees/a": attendee()})
        self.assertEqual(self.purge(db), 1)
        self.assertEqual(len(db.docs), 1)
        orphan = DB({"events/event1/attendees/a": attendee()})
        self.assertEqual(self.purge(orphan, "events/event1/attendees/a"), 1)
        self.assertNotIn("attendees/a", orphan.docs)

    def test_legacy_dates_missing_and_invalid_dates(self):
        legacy = attendee()
        legacy.pop("embeddingExpiresAt")
        legacy["deleteOn"] = "2026-11-01T00:00:00Z"
        self.assertTrue(cleanup.expired(legacy, NOW))
        legacy.pop("deleteOn")
        self.assertTrue(cleanup.expired(legacy, NOW))
        legacy["embeddingExpiresAt"] = "invalid"
        self.assertFalse(cleanup.expired(legacy, NOW))
        self.assertFalse(cleanup.expired({}, NOW))

    def test_boundary_and_unknown_paths(self):
        record = attendee()
        record["embeddingExpiresAt"] = NOW
        self.assertTrue(cleanup.expired(record, NOW))
        self.assertIsNone(cleanup.attendee_path("other/a/attendees/b"))
        self.assertEqual(cleanup.purge_family(DB({}), Reference(DB({}), "photos/a"), NOW, 30, SDK), 0)

    def test_pagination_reaches_all_records_and_skips_unexpired(self):
        docs = {f"attendees/{number}": attendee() for number in range(5)}
        docs["attendees/new"] = attendee()
        docs["attendees/new"]["embeddingExpiresAt"] = NOW + timedelta(days=1)
        db = DB(docs)
        counts = cleanup.run(db, SDK, dry_run=False, page_size=2, now=NOW)
        self.assertEqual(counts["scanned"], 6)
        self.assertEqual(counts["candidate_updates"], 5)
        self.assertIn("photoEmbedding", db.docs["attendees/new"])

    def test_failed_updates_make_execution_fail(self):
        db = DB({"attendees/a": attendee()})
        db.fail = True
        with self.assertRaises(RuntimeError):
            cleanup.run(db, SDK, dry_run=False, now=NOW)


# Extract actual embedder functions without importing image/model/cloud packages.
source = ast.parse((HERE.parent / "embed_checkin_photos" / "main.py").read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef)
             and node.name in ("biometrics_retired", "update_existing", "collect_attendees")]
namespace = dict(datetime=datetime, timezone=timezone, firestore=SDK, hashlib=hashlib,
                 LOG=SimpleNamespace(info=lambda *args: None, warning=lambda *args: None))
exec(compile(ast.Module(body=functions, type_ignores=[]), "embedder_retention", "exec"), namespace)


class EmbedderRetentionTests(unittest.TestCase):
    def test_purged_and_expired_records_are_retired(self):
        retired = namespace["biometrics_retired"]
        self.assertTrue(retired({"embeddingStatus": "purged"}, NOW))
        self.assertTrue(retired({"biometricsPurgedAt": NOW}, NOW))
        self.assertTrue(retired({"embeddingExpiresAt": NOW}, NOW))
        self.assertFalse(retired({"embeddingExpiresAt": NOW + timedelta(seconds=1)}, NOW))

    def test_force_collection_cannot_regenerate_a_purged_vector(self):
        db = DB({"attendees/a": {"eventId": "event1", "embeddingStatus": "purged",
                                 "checkInPhotoPath": "checkin/event1/a.jpg"}})
        result = namespace["collect_attendees"](db, "event1", "a", 10, force=True)
        self.assertEqual(result, [])

    def test_inflight_write_cannot_revive_a_purged_record(self):
        db = DB({"attendees/a": {"embeddingStatus": "purged"}})
        self.assertFalse(namespace["update_existing"](db, [Reference(db, "attendees/a")], {"photoEmbedding": [1]}))
        self.assertEqual(db.writes, [])

    def test_reprocessing_does_not_extend_expiry(self):
        deadline = datetime.now(timezone.utc) + timedelta(days=1)
        db = DB({"attendees/a": {"embeddingExpiresAt": deadline}})
        result = namespace["update_existing"](db, [Reference(db, "attendees/a")],
                                              {"photoEmbedding": [1], "embeddingExpiresAt": deadline + timedelta(days=30)})
        self.assertTrue(result)
        self.assertEqual(db.docs["attendees/a"]["embeddingExpiresAt"], deadline)


if __name__ == "__main__":
    unittest.main()
