# WIDER FACE group-photo detection benchmark

This benchmark evaluates the app's pinned SCRFD detector on full photographs.
It does not evaluate identity recognition, enrollment, the LFW 0.234 similarity
threshold, gallery margins, consent decisions, or actual redaction coverage.
Firebase access is not required. Application defaults are not modified.

## Run or resume

From the repository root in PowerShell:

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-widerface.txt
& .venv/Scripts/python.exe src/scripts/benchmark_widerface.py
```

The downloaded files must remain under `data/raw/widerface/`:

```text
WIDER_val/images/<event>/<photo>.jpg
wider_face_split/wider_face_val_bbx_gt.txt
eval_tools/ground_truth/wider_face_val.mat
eval_tools/ground_truth/wider_easy_val.mat
eval_tools/ground_truth/wider_medium_val.mat
eval_tools/ground_truth/wider_hard_val.mat
```

The pinned model is `data/models/auraface/scrfd_10g_bnkps.onnx`, from AuraFace
revision `af6d057`. The group-photo matching job explicitly uses 1024 input;
the separate check-in embedder uses 640. Our baseline is the group-photo detector:
1024 input, confidence 0.35, NMS 0.4, CPU, four ORT threads, max_num=0.

Predictions are appended per image with a flush after each JSON line, separately
at input sizes 640, 1024 and 1280. A restart skips completed images after
checking model/data/configuration fingerprints. An interrupted malformed final
line is rejected for investigation. Do not delete the data folder to restart.

Each resolution processes 3,226 full images, so the first run can take tens of
minutes on CPU. No timing comparisons should be made while other heavy jobs
are running. Warm-up is excluded. Cached timings include JPEG decode, resize,
normalization, inference, decoding and NMS at candidate score floor 0.02. They
exclude startup, embedding extraction, redaction and cloud requests. All five
operating thresholds for a given resolution share the low-floor run: no new
latency measurement is claimed for confidence-only changes.

To regenerate evaluation/plots after all predictions exist, without inference:

```powershell
& .venv/Scripts/python.exe src/scripts/benchmark_widerface.py --evaluate-only
```

## Validation and split

`widerface_data.py` loads the original MATLAB annotations, cross-checks TXT box
counts/coordinates, reads all photos, records per-image SHA-256/dimensions,
checks label lengths/subset indices and records malformed geometry.

The downloaded annotations have 11 nonpositive boxes and one TXT/MAT coordinate
discrepancy. MAT coordinates are authoritative for AP; we retain those original
annotations without attempting silent corrections. Custom metrics exclude
nonpositive geometry and invalid annotations.

The original frozen split has 2,583 development and 643 holdout images, seed 42. It uses
event/crowd strata and grouped scene-name prefixes, plus 64-bit dHash Hamming
distance <=4. Related groups cannot cross the split. This heuristic reduces
leakage but cannot guarantee all near-duplicates or identities are separated.
The manifest and image hashes are under `data/benchmarks/widerface/`.

**QA holdout correction before final scoring:** the smoke sample included 12
original holdout photos. All 353 originally held-out photos in their scene/dHash
groups are excluded from final holdout scoring. The final untouched holdout has
290 photos; development remains 2,583 photos. The 353 exclusions still appear
in descriptive full-validation AP, not in the final holdout comparison. This
reduces holdout coverage. `holdout_qa_exclusion.json` documents the correction,
and `split_manifest.csv` includes both original and effective split columns.
The original inference manifest/cache fingerprints remain unchanged because
images, detector settings and prediction contents have not changed.

## Tuning procedure

The declared grid is sizes 640, 1024, 1280 crossed with confidence cutoffs
0.15, 0.25, 0.35, 0.45, 0.55: **15 configurations**. NMS stays at 0.4.
Weights, original photos, preprocessing and IoU requirements are fixed.

Choose maximum development recall subject to **precision >=95%**. Equal-recall
ties prefer lower measured median latency, then higher precision and cutoff.
If no configuration meets the precision target, report no passing recommendation;
the highest-development-F1 setting is compared as an explicitly exploratory
diagnostic. That fallback does not relax or claim to meet the target.

The selection is frozen in `selection.json` before computing holdout metrics.
The baseline and that one candidate are then evaluated on the same holdout.
Full-validation AP after tuning is descriptive, not a fresh final test. Do not
choose another setting after inspecting holdout and keep calling it untouched.

## Metrics and important conventions

Custom operating-point metrics use continuous-coordinate IoU >=0.5, confidence
order and one detection credit per eligible GT. A duplicate detection is
unmatched. Detections matching ignored GT are ignored. Eligibility is the official
Hard mask intersected with invalid==0 and positive width/height. This is explicitly
a custom operational subset, not the official Hard AP definition.

- Recall = matched eligible faces / eligible faces.
- Precision = matched eligible faces / (matched eligible faces + unmatched scored detections).
- Complete-photo detection = photos with every eligible face found / photos with at least one eligible face.
- Crowd groups use all valid annotated faces: 0, 1, 2-5, 6-20, 21+.
- Size groups use original-image GT face height: <32, 32-95, >=96 pixels.
- Occlusion, pose and blur breakdowns report GT recall, not arbitrary attributes
  assigned to false detections.

Some photos contain only [0,0,0,0] placeholder annotations. With no overlapping
annotation, all predictions on them are unmatched under the custom rule. Those
are not human-confirmed false faces. The report separately saves the number
of zero-eligible photos and sensitivity metrics excluding them. Near-miss IoU
0.1-0.5 detections may be real faces localized differently, not hallucinations.

### WIDER AP protocol

`widerface_metrics.py` is a NumPy port of the downloaded official MATLAB code:
`evaluation.m`, `boxoverlap.m`, `norm_score.m` and `plot/VOCap.m`. It uses
official per-difficulty masks, inclusive +1 box areas, IoU >=0.5, ignored-match
handling, global min/max confidence normalization, 1,000 score bins and the VOC
precision envelope. Scores below 0.02 were not retained, so recall tail is truncated.

We have **not run MATLAB or submitted to an official server**. Label the numbers
“WIDER MATLAB-protocol port AP,” not an independently certified official result.
Unit tests cover independent scalar IoU, duplicate/ignored matching, nontrivial
AP fixtures, absent detections, and precision-constrained selection.

Official-format text predictions are exported under
`data/benchmarks/widerface/official_predictions/<configuration>/<event>/<photo>.txt`.
For independent verification, point `pred_dir` in the supplied `wider_eval.m` at
that folder, keep `gt_dir` pointing at the supplied ground truth, and run the
official MATLAB evaluation environment separately.

## Outputs

To inspect specific mistakes without rerunning inference:

```powershell
& .venv/Scripts/python.exe src/scripts/analyze_widerface_errors.py
```

`reports/widerface/error_analysis/` contains four zoomed comparisons with exact
confidence scores and IoUs, missed-face categories, unmatched detections and
an interpretation report. This is post-hoc diagnosis of the existing holdout,
not new model selection or an independent test. A 640-input comparison for a
large missed portrait illustrates resolution sensitivity without changing the
chosen configuration or app settings.

`reports/widerface/` contains:

- `report.md`: main report, holdout results and caveats.
- `development_grid.csv`, `selection.json`: all tuning results and frozen choice.
- `baseline_metrics.json` and selected/exploratory metrics: full validation,
  holdout and zero-eligible-photo sensitivity counts.
- `configuration_comparison.csv`, `crowd_count_metrics.csv`, size/occlusion/
  blur/pose recall and per-image error tables.
- `full_validation_ap.csv`, PR curves, `precision_recall.png`.
- `recall_vs_latency.png`, `missed_faces_by_size.png`,
  `complete_photo_detection.png`, `occlusion_recall.png`.
- `example_overlays/`: side-by-side baseline/candidate diagnostic examples
  chosen from difficult holdout photos; these are illustrations, not a sample
  used to calculate the overall scores.
- `reproducibility.json`: model, dataset, prediction and source hashes,
  package versions, execution settings and timing scope.
- `smoke_report.md` and `smoke_contact_sheet.png`: earlier 50-image pipeline check,
  deliberately varied and not a final representative score.

Raw photos and predictions stay under the ignored `data/` directory. Do not
commit the full dataset or embeddings. Annotations provide face boxes, not
identity or consent labels. A further enrolled/unknown-person event-photo test
is needed for recognition/redaction claims.

```powershell
& .venv/Scripts/python.exe -m unittest discover -s tests -p test_widerface_metrics.py
```

Sources: the downloaded dataset evaluation code and readme, the
[WIDER FACE paper](https://www.cv-foundation.org/openaccess/content_cvpr_2016/papers/Yang_WIDER_FACE_A_CVPR_2016_paper.pdf),
and [SCRFD project](https://github.com/deepinsight/insightface/tree/master/detection/scrfd).
