# Rules and deployment notes

The Firestore rules in this folder are a draft and have not been validated with Firebase emulators. Do not publish them to an active event without first testing the application's sign-in, photographer invitation, check-in, galleries, and event/photo queries against a disposable project and database.

The `firebase.json` file selects the application's named Firestore database. After authenticating with the Firebase CLI and confirming the project and database, the named rules can be deployed with:

```bash
firebase deploy --project mids-capstone-ajt --only firestore:ai-studio-a1858ef2-f062-409f-aaff-1218861a9484
```

Deploying the web service does not deploy Firestore or Storage rules. The draft rules prevent users from creating their own staff profile; existing profiles remain, and accepted photographer invitations can provision a profile on the server. General superuser invitations for managers have not yet been implemented. Validate the superuser login and all existing users before applying changes.

**Storage remains unresolved:** Firebase Storage rules can consult only the default Firestore database, while this app stores event memberships in a named database. The checked-in Storage rules now deny staff client reads and writes as a temporary fail-closed policy; this blocks normal staff photo uploads, previews, and downloads until the access flow is replaced. Do not treat the Firestore changes as a complete access-control solution. Event-aware Storage access requires an authorization design compatible with the named database (for example, a server-mediated flow or carefully maintained authorization data in the default database). Firebase download URLs are bearer links and require separate handling when revoking access.

The matching job now writes `thumbnailFocus` coordinates and source dimensions after successful processing, using existing face detections. The manager view calculates a focal crop for its 16:9 thumbnail, clamped at image edges; older photos without metadata stay centered. The photographer view displays the original upload without cropping. Deploy both the web service and the rebuilt matching job for focal thumbnails; existing photos require explicitly scoped reprocessing to gain the metadata. The matcher Dockerfile is included but has not been cloud-built during local verification. The embedding job still lacks its referenced Dockerfile. Do not execute reset or infrastructure scripts as part of this update.
