# LFW benchmark

Run from the repository root in PowerShell. Firebase, Google credentials, npm,
and training are not needed. The default inference model is the same AuraFace
recognition model used by the app, pinned to Hugging Face revision `af6d057`.
Only `glintr100.onnx` is downloaded (~261 MB); the prepared 112x112 crops do not
need the app's detector. A CPU full run can take several minutes.

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-benchmark.txt
& .venv/Scripts/python.exe src/scripts/benchmark_lfw.py --output data/benchmarks/my_run
```

The local LFW file is already at `data/raw/eval/lfw.bin`. The loader rejects
executable pickle object types and validates the image/pair count, label types,
and class balance per contiguous 600-pair fold. Its provenance is the bundled
Kaggle dataset referenced by `src/scripts/download_data.py`; do not re-run that
downloader to benchmark, since it replaces the existing data folder.

## Baseline and artifacts

The initial run is saved to `data/benchmarks/lfw_auraface_baseline/`.
The report, plot, fold metrics, and run metadata also have a shareable snapshot
under `reports/lfw_auraface_baseline/`, outside the ignored data folder. The
notebook has executed outputs, so the baseline is readable without rerunning inference.

- `report.md`: readable results and limitations.
- `run.json`: metrics, hashes, model revision, script hash, package versions,
  host details, inference options, failure count, and timing definitions.
- `pairs.csv`: one out-of-fold score, threshold, prediction, and correctness per pair.
- `folds.csv`: per-fold thresholds, confusion counts, and performance.
- `roc.csv` and `metrics.png`: descriptive ROC and score distributions.
- `embeddings.npz`: normalized image embeddings, kept locally under ignored `data/`.
- `inference.json`: inference metadata and failures; failures stop benchmark
  publication rather than silently removing difficult images.

The output directory must be new for each inference run. To regenerate metrics
and figures from the same cached embeddings without repeating inference:

```powershell
& .venv/Scripts/python.exe src/scripts/benchmark_lfw.py --output data/benchmarks/lfw_auraface_baseline --reuse-embeddings
```

Dataset and model hashes must match the cached run. Reuse retains original
timings; it does not measure a new inference performance result.

## Metrics to track

| Metric | Interpretation | Preferred direction |
|---|---|---|
| 10-fold accuracy mean | Threshold selected on 9 folds, scored on the held-out fold | Higher |
| Fold accuracy standard deviation | Variation across the ten test folds; not a confidence interval | Report alongside mean |
| False accepts and false rejects | Out-of-fold mistakes, separately counted | Lower |
| ROC AUC | Score separation, calculated descriptively on all pairs | Higher |
| TAR with training FAR target 1% | Accept rate on genuine held-out pairs at a train-calibrated threshold | Higher |
| Actual FAR at that operating point | Held-out impostor acceptance; may exceed the training target | Lower |
| Accuracy/FAR/FRR at fixed 0.55 | Recognition-only behavior at the app's default threshold | Compare error tradeoff |
| Median and p95 image latency | Decode + preprocess + inference + normalization, after warm-up | Lower |
| Image/embedding failures | No skipped failures in a completed benchmark | Zero |

Threshold candidates are cosine values -1 to 1.001 in steps of .001. Equal
accuracy ties select the highest threshold. For the 1% FAR target, the lowest
threshold satisfying training FAR <= .01 is used. Every test fold is evaluated
once; pair order is preserved. A 1% target is used because the file contains only
3,000 impostor pairs: it cannot strongly support very small FAR claims.

For a future run, use another output folder and compare `run.json` metrics to
the baseline. Keep the dataset hash, folds, normalization, augmentation, and
threshold selection procedure constant. Compare latency with the same CPU,
thread count (default 4), batch size (1), and scope. Record changed weights using
`--model path/to/model.onnx`; the actual model SHA-256 is authoritative even if
the file is named like AuraFace. `--fixed-threshold` changes the separate fixed
operating-point metric, not the cross-validated threshold selection.

Compare a later run and save the change in each tracked metric:

```powershell
& .venv/Scripts/python.exe src/scripts/compare_lfw.py data/benchmarks/lfw_auraface_baseline/run.json data/benchmarks/my_run/run.json --output data/benchmarks/my_run/comparison.csv
```

The comparison rejects mismatched dataset/protocol/preprocessing and omits
latency when recorded host or inference settings differ. It does not claim
statistical significance from a small change in accuracy.

## Tune the threshold without repeating inference

From the repository root in PowerShell:

```powershell
& .venv/Scripts/python.exe src/scripts/tune_lfw_threshold.py
```

This reuses the baseline embeddings and scores, verifies dataset and score
consistency, and saves results to `reports/lfw_threshold_tuning/`. No network,
Google login, or new model inference is required. The default maximizes genuine
acceptance subject to a **0.5% development false-accept budget**. This is an
experiment setting, not a production requirement. The report compares it with
maximizing accuracy and the original 0.55 threshold. The CV rows calibrate on
nine folds and score the held-out fold. Actual held-out FAR may exceed the budget.

To try a 1% development FAR budget or maximize accuracy instead:

```powershell
& .venv/Scripts/python.exe src/scripts/tune_lfw_threshold.py --target-far 0.01 --output reports/lfw_threshold_tuning_far1pct
& .venv/Scripts/python.exe src/scripts/tune_lfw_threshold.py --objective accuracy --output reports/lfw_threshold_tuning_accuracy
```

Each run saves `report.md`, `comparison.csv`, `threshold_sweep.csv`,
`threshold_tradeoff.png`, per-fold metrics, held-out pair decisions, and
`candidate.json`. The candidate threshold is fit on all 6,000 pairs for a future
experiment; its all-data score and the sweep are descriptive, not fresh held-out
estimates. The original LFW results have already been inspected, so these are
retrospective CV experiments. Do not select the best-looking report and describe
it as an untouched test. App defaults and baseline results are preserved.

## Visualize the tuning experiments

```powershell
& .venv/Scripts/python.exe src/scripts/visualize_lfw_benchmarks.py
```

This generates four PNG/SVG figures and the underlying CSV tables under
`reports/lfw_visualizations/`: policy comparison, a five-budget experiment
(0.1%, 0.25%, 0.5%, 1%, 2%), a descriptive threshold sweep, and fold-specific
thresholds. The results are also embedded in `notebooks/lfw_baseline.ipynb`.
These parameters change the decision rule, not the recognition weights or AUC.
See `reports/lfw_visualizations/README.md` for interpretation and metric tables.

## Limits and reporting

This is **recognition-only verification on a local LFW derivative**. Counts and
fold balance match the expected format, but official pair identities/order have
not been independently authenticated. Until then do not label it a verified
official-protocol reproduction. Folds can share identities; this is not a
strict identity-disjoint study. The pretrained model's overlap with LFW is unknown.

Input is RGB float32 NCHW, normalized as required by InsightFace's graph
inspection rule; this AuraFace graph expects `(pixel - 127.5) / 127.5`.
There is no horizontal-flip augmentation or second detection/alignment pass.
The app additionally uses gallery ranking, a runner-up margin, consent rules,
detection, and redaction: these are outside this pair-verification benchmark.
The app's published Cloud Run runtime also cannot be inferred from local CPU timing.

Sources:

- https://huggingface.co/fal/AuraFace-v1
- https://github.com/deepinsight/insightface/blob/master/python-package/insightface/model_zoo/arcface_onnx.py
- https://github.com/deepinsight/insightface/blob/master/recognition/arcface_torch/eval/verification.py
- https://people.cs.umass.edu/~elm/papers/Huang_eccv2008-lfw.pdf

Run evaluation checks without weights or network:

```powershell
& .venv/Scripts/python.exe -m unittest discover -s tests -p test_benchmark_lfw.py
```
