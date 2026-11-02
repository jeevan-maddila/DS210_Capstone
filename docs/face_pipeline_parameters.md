# Two pipeline settings, shared across photo types

| Stage | Display name | Question | Experiment result |
|---|---|---|---|
| Detection | Face-detection confidence cutoff | Is this predicted box a face? | WIDER baseline 0.35; precision-constrained candidate 0.55 at input 1280 |
| Recognition | Recognition similarity threshold (cosine) | Does this detected face match an enrolled person? | LFW development candidate 0.234; CV metrics use fold-specific thresholds |

These are not different settings chosen based on the number of people in a
photo. Every photo passes through detection; every detected face can then pass
through recognition. The product can apply the same pair of settings to both
single-person and group photos.

The group-photo matching job currently uses detector confidence 0.35, input
1024, recognition cosine threshold 0.55, and runner-up margin 0.05. The two
possible 0.55 values control different stages; numeric equality is incidental.

Illustrative example: a region has detection score 0.80 and passes a 0.35
detection cutoff. Its face embedding has cosine similarity 0.30 to Alice's
enrollment image, passing an illustrative 0.234 recognition threshold, subject
to the app's runner-up margin and consent checks. The two scores answer different
questions; neither is a calibrated probability.

Use one shared operating configuration across photo types, but calibrate each
parameter for its own error tradeoff. Development event photos should mix single
and multiple faces, enrolled and unknown people, gallery sizes, face sizes,
lighting and poses. Freeze detection confidence, recognition similarity, input
size and gallery margin, then evaluate on new photos/sessions. Report overall
results and results by photo type.

LFW cropped verification does not evaluate detection or group-gallery matching.
WIDER detection does not evaluate identities. These experiments therefore do not
validate a complete product configuration. WIDER's precision-constrained candidate
misses more faces than the baseline. Application defaults are unchanged.

CSV/JSON field names are retained for compatibility; a field named `threshold`
means the parameter for that benchmark stage. Display labels distinguish them.
