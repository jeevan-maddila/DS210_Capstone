#!/usr/bin/env python3
"""
Full Database & Storage Reset Script
Project:  mids-capstone-ajt
Database: ai-studio-a1858ef2-f062-409f-aaff-1218861a9484

Usage:
  python reset_database.py           # Wipes test data and reseeds a fresh demo event
  python reset_database.py --wipe-only # Wipes everything clean without reseeding
  python reset_database.py --with-storage # Also removes uploaded test files from Cloud Storage
"""

import os
import sys
import argparse
from datetime import datetime, timezone
from google.cloud import firestore, storage

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "mids-capstone-ajt")
DATABASE_ID = os.environ.get("FIRESTORE_DATABASE_ID", "ai-studio-a1858ef2-f062-409f-aaff-1218861a9484")
BUCKET_NAME = os.environ.get("STORAGE_BUCKET", "mids-capstone-ajt_cloudbuild")
SUPER_ADMIN_EMAIL = "thomas.leffler2@gmail.com"


def parse_args():
    parser = argparse.ArgumentParser(description="Reset Firestore database and demo state")
    parser.add_argument("--wipe-only", action="store_true", help="Only wipe collections without reseeding fresh demo data")
    parser.add_argument("--with-storage", action="store_true", help="Also delete checkin/ and photographers/ test files in GCS")
    parser.add_argument("--database", type=str, default=DATABASE_ID, help="Firestore database ID")
    parser.add_argument("--project", type=str, default=PROJECT_ID, help="GCP project ID")
    return parser.parse_args()


def delete_collection_docs(db, collection_name, batch_size=100):
    """Deletes all documents in a collection in batches."""
    coll_ref = db.collection(collection_name)
    total_deleted = 0
    while True:
        docs = list(coll_ref.limit(batch_size).stream())
        if not docs:
            break
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
            total_deleted += 1
        batch.commit()
    return total_deleted


def wipe_firestore(db):
    print("\n[1/3] Wiping Firestore documents...")

    # 1. Delete root /photos
    deleted_photos = delete_collection_docs(db, "photos")
    print(f"  • Deleted {deleted_photos} document(s) from /photos")

    # 2. Delete root /attendees
    deleted_attendees = delete_collection_docs(db, "attendees")
    print(f"  • Deleted {deleted_attendees} document(s) from /attendees")

    # 3. Delete event subcollections and events
    events = list(db.collection("events").stream())
    sub_photos_count = 0
    sub_attendees_count = 0
    for ev in events:
        # Delete subcollection /events/{id}/photos
        sub_p = list(ev.reference.collection("photos").stream())
        for p in sub_p:
            p.reference.delete()
            sub_photos_count += 1

        # Delete subcollection /events/{id}/attendees
        sub_a = list(ev.reference.collection("attendees").stream())
        for a in sub_a:
            a.reference.delete()
            sub_attendees_count += 1

        ev.reference.delete()

    print(f"  • Deleted {len(events)} event(s)")
    print(f"  • Deleted {sub_photos_count} event photo subcollection document(s)")
    print(f"  • Deleted {sub_attendees_count} event attendee subcollection document(s)")


def wipe_storage_buckets(project_id, bucket_name):
    print("\n[2/3] Cleaning Cloud Storage test uploads...")
    try:
        gcs = storage.Client(project=project_id)
        bucket = gcs.bucket(bucket_name)
        if not bucket.exists():
            print(f"  • Notice: Bucket {bucket_name} not found or inaccessible; skipping GCS wipe.")
            return

        prefixes = ["checkin/", "photographers/", "events/"]
        total_blobs_deleted = 0
        for prefix in prefixes:
            blobs = list(bucket.list_blobs(prefix=prefix))
            for b in blobs:
                b.delete()
                total_blobs_deleted += 1
        print(f"  • Deleted {total_blobs_deleted} file(s) from gs://{bucket_name}")
    except Exception as e:
        print(f"  • Notice cleaning storage: {e}")


def reseed_demo_data(db):
    print("\n[3/3] Reseeding clean demo data...")
    now = datetime.now(timezone.utc).isoformat()

    # 1. Seed Super Admin & Users
    db.collection("admins").document("thomas_super_admin").set({
        "email": SUPER_ADMIN_EMAIL,
        "role": "super_admin",
        "createdAt": now
    }, merge=True)

    db.collection("users").document("thomas_super_admin").set({
        "uid": "thomas_super_admin",
        "email": SUPER_ADMIN_EMAIL,
        "displayName": "Thomas Leffler",
        "role": "super_admin",
        "assignedEvents": ["evt_summit_2026"],
        "inviteStatus": "active",
        "createdAt": now
    }, merge=True)

    db.collection("users").document("demo_photographer").set({
        "uid": "demo_photographer",
        "email": "photographer@lumina.event",
        "displayName": "Official Summit Photographer",
        "role": "photographer",
        "assignedEvents": ["evt_summit_2026"],
        "inviteStatus": "active",
        "createdAt": now
    }, merge=True)

    # 2. Seed Clean Sample Event
    event_id = "evt_summit_2026"
    event_payload = {
        "id": event_id,
        "ownerUid": "thomas_super_admin",
        "name": "Global Tech & AI Innovation Summit 2026",
        "date": "2026-10-15",
        "location": "Grand Horizon Convention Center & Virtual Hall",
        "createdAt": now,
        "ticketTypes": ["VIP All-Access", "General Admission", "Speaker & Press", "Student Pass"],
        "sessions": [
            "Keynote: The Future of Vision AI & Media",
            "Breakout A: Enterprise Cloud Architecture",
            "Breakout B: Real-Time Media Pipelines",
            "Workshop: Autonomous Photography Workflows"
        ],
        "customFields": [
            {"id": "company", "label": "Company / Organization", "type": "text", "required": True},
            {"id": "job_title", "label": "Job Title / Function", "type": "text", "required": False},
            {"id": "first_time", "label": "First time attending?", "type": "boolean", "required": False}
        ],
        "marketingChannels": [
            "Instagram",
            "Facebook",
            "LinkedIn",
            "X (Twitter)",
            "Event Website & Press Releases"
        ],
        "assignedPhotographers": [
            {"email": "photographer@lumina.event", "inviteStatus": "active"},
            {"email": "thomas_leffler@berkeley.edu", "inviteStatus": "active"}
        ],
        "photographerEmails": ["photographer@lumina.event", "thomas_leffler@berkeley.edu"]
    }
    db.collection("events").document(event_id).set(event_payload)

    # 3. Seed Sample Attendees
    attendees = [
        {
            "id": "att_elena_rostova_01",
            "eventId": event_id,
            "event_id": event_id,
            "fullName": "Dr. Elena Rostova",
            "email": "elena.rostova@ai-horizon.org",
            "ticketType": "VIP All-Access",
            "photoConsentGiven": True,
            "allowedMarketingChannels": ["Instagram", "LinkedIn"],
            "embeddingStatus": "pending",
            "checkedInAt": now
        },
        {
            "id": "att_sophia_martinez_02",
            "eventId": event_id,
            "event_id": event_id,
            "fullName": "Sophia Martinez",
            "email": "sophia.m@horizonmedia.io",
            "ticketType": "Speaker & Press",
            "photoConsentGiven": True,
            "allowedMarketingChannels": ["LinkedIn", "Facebook"],
            "embeddingStatus": "pending",
            "checkedInAt": now
        },
        {
            "id": "att_liam_patel_03",
            "eventId": event_id,
            "event_id": event_id,
            "fullName": "Liam Patel",
            "email": "liam.patel@novatech.co",
            "ticketType": "General Admission",
            "photoConsentGiven": False,  # Withheld consent -> privacy blurred
            "allowedMarketingChannels": [],
            "embeddingStatus": "pending",
            "checkedInAt": now
        }
    ]

    for a in attendees:
        # Write to root /attendees and subcollection
        db.collection("attendees").document(a["id"]).set(a)
        db.collection("events").document(event_id).collection("attendees").document(a["id"]).set(a)

    print(f"  • Seeded fresh event: '{event_payload['name']}' (ID: {event_id})")
    print(f"  • Seeded {len(attendees)} sample check-in attendee(s)")
    print(f"  • Seeded users and admin credentials for {SUPER_ADMIN_EMAIL}")


def main():
    args = parse_args()
    print("=" * 70)
    print("  DATABASE & DEMO RESET TOOL")
    print(f"  Project:   {args.project}")
    print(f"  Database:  {args.database}")
    print("=" * 70)

    if args.database and args.database != "(default)":
        db = firestore.Client(project=args.project, database=args.database)
    else:
        db = firestore.Client(project=args.project)

    wipe_firestore(db)

    if args.with_storage:
        wipe_storage_buckets(args.project, BUCKET_NAME)

    if not args.wipe_only:
        reseed_demo_data(db)
    else:
        print("\n[3/3] Reseeding skipped (--wipe-only was specified).")

    print("\n" + "=" * 70)
    print("  ✓ RESET COMPLETE! You now have a clean slate.")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    main()
