"""Tune LFW verification thresholds from saved baseline scores, without inference."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.model_selection import KFold

from benchmark_lfw import ROOT, confusion, load_lfw, sha256, write_csv


def select_threshold(scores, labels, objective="far", target_far=.005):
    """Fit on development pairs only; deterministic conservative tie breaks."""
    scores, labels = np.asarray(scores), np.asarray(labels, dtype=bool)
    if not 0 <= target_far <= 1 or objective not in ("far", "accuracy"):
        raise ValueError("Invalid objective or FAR target")
    if not len(scores) or not labels.any() or labels.all() or not np.isfinite(scores).all():
        raise ValueError("Need finite scores and both positive and negative pairs")
    thresholds = np.linspace(-1, 1.001, 2002)
    decisions = scores[:, None] >= thresholds
    if objective == "accuracy":
        values = (decisions == labels[:, None]).mean(axis=0)
        best = np.flatnonzero(values == values.max())[-1]
    else:
        far = decisions[~labels].mean(axis=0)
        tar = decisions[labels].mean(axis=0)
        eligible = far <= target_far
        # Maximize genuine acceptance within the training FAR limit; prefer the
        # highest threshold when genuine acceptance ties.
        best = np.flatnonzero(eligible & (tar == tar[eligible].max()))[-1]
    return float(thresholds[best])


def cross_validate(scores, labels, objective, target_far):
    predictions = np.zeros(len(labels), dtype=bool)
    thresholds = np.zeros(len(labels))
    fold_ids = np.zeros(len(labels), dtype=int)
    folds = []
    for fold, (train, test) in enumerate(KFold(10, shuffle=False).split(scores), 1):
        threshold = select_threshold(scores[train], labels[train], objective, target_far)
        predictions[test] = scores[test] >= threshold
        thresholds[test], fold_ids[test] = threshold, fold
        folds.append(dict(fold=fold, threshold=threshold,
                          **confusion(labels[test], predictions[test])))
    return confusion(labels, predictions), folds, predictions, thresholds, fold_ids


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=ROOT / "data/benchmarks/lfw_auraface_baseline")
    parser.add_argument("--data", type=Path, default=ROOT / "data/raw/eval/lfw.bin")
    parser.add_argument("--output", type=Path, default=ROOT / "reports/lfw_threshold_tuning")
    parser.add_argument("--objective", choices=("far", "accuracy"), default="far")
    parser.add_argument("--target-far", type=float, default=.005,
                        help="Development false-accept budget, default 0.005 = 0.5%%")
    parser.add_argument("--baseline-threshold", type=float, default=.55)
    args = parser.parse_args()
    if not 0 <= args.target_far <= 1 or not -1 <= args.baseline_threshold <= 1:
        parser.error("FAR must be in [0,1] and baseline cosine threshold in [-1,1]")
    if args.output.resolve() == args.baseline.resolve():
        parser.error("Use a separate output directory to preserve the baseline")
    source = json.loads((args.baseline / "run.json").read_text(encoding="utf-8"))
    _, labels = load_lfw(args.data)
    if source["smoke"] or source["dataset_sha256"] != sha256(args.data) or source["inference"]["failures"]:
        raise ValueError("Need a completed baseline for this exact dataset")
    import csv
    with (args.baseline / "pairs.csv").open(newline="", encoding="utf-8") as stream:
        pairs = list(csv.DictReader(stream))
    if len(pairs) != len(labels) or [int(p["pair_index"]) for p in pairs] != list(range(len(labels))):
        raise ValueError("Incomplete or reordered pair scores")
    if [p["same_person"] for p in pairs] != [str(bool(label)) for label in labels]:
        raise ValueError("Cached labels differ from dataset labels")
    scores = np.array([float(p["cosine"]) for p in pairs])
    if not np.isfinite(scores).all() or (np.abs(scores) > 1).any():
        raise ValueError("Invalid cosine scores")
    embeddings = np.load(args.baseline / "embeddings.npz")["embeddings"]
    if embeddings.shape != (12000, 512) or not np.isfinite(embeddings).all():
        raise ValueError("Invalid embedding cache")
    expected = np.clip((embeddings[::2] * embeddings[1::2]).sum(axis=1), -1, 1)
    if not np.allclose(scores, expected, atol=1e-7, rtol=0):
        raise ValueError("Pair scores differ from saved embeddings")
    args.output.mkdir(parents=True, exist_ok=True)
    comparisons = [dict(policy=f"Fixed {args.baseline_threshold:.3f}",
                        **confusion(labels, scores >= args.baseline_threshold))]
    selected_result = None
    for objective, title in [("accuracy", "CV maximize accuracy"), ("far", "CV maximize genuine acceptance under FAR budget")]:
        metrics, folds, predictions, thresholds, ids = cross_validate(scores, labels, objective, args.target_far)
        comparisons.append(dict(policy=title, **metrics))
        write_csv(args.output / f"{objective}_folds.csv", folds)
        if objective == args.objective:
            selected_result = metrics
            write_csv(args.output / "selected_pairs.csv", [dict(pair_index=i, fold=int(ids[i]),
                      same_person=bool(labels[i]), cosine=float(scores[i]), threshold=float(thresholds[i]),
                      predicted_same=bool(predictions[i])) for i in range(len(labels))])
    write_csv(args.output / "comparison.csv", comparisons)
    sweep = [dict(threshold=float(t), **confusion(labels, scores >= t)) for t in np.linspace(0, 1, 1001)]
    write_csv(args.output / "threshold_sweep.csv", sweep)
    candidate = select_threshold(scores, labels, args.objective, args.target_far)
    config = dict(created_utc=datetime.now(timezone.utc).isoformat(), objective=args.objective,
                  target_training_far=args.target_far, candidate_cosine_threshold=candidate,
                  candidate_status="LFW development candidate; not validated for event deployment",
                  candidate_fit_scope="All 6000 pairs; its in-sample performance is not an independent test",
                  candidate_in_sample_metrics=confusion(labels, scores >= candidate),
                  cross_validated_policy_metrics=selected_result,
                  baseline_threshold=args.baseline_threshold,
                  dataset_sha256=source["dataset_sha256"], model_sha256=source["model_sha256"],
                  source_run_sha256=sha256(args.baseline / "run.json"),
                  source_pairs_sha256=sha256(args.baseline / "pairs.csv"), script_sha256=sha256(__file__),
                  caveats=["Retrospective analysis of already inspected LFW results; not a fresh test set",
                           "Training FAR budget does not guarantee held-out FAR",
                           "Local derivative pair identities/order not independently authenticated",
                           "Pair verification does not evaluate gallery ranking or runner-up margin"])
    (args.output / "candidate.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(9, 5))
    for key, label in [("true_accept_rate", "Genuine acceptance"), ("false_accept_rate", "False acceptance"), ("accuracy", "Accuracy")]:
        ax.plot([r["threshold"] for r in sweep], [100*r[key] for r in sweep], label=label)
    ax.axvline(args.baseline_threshold, color="gray", linestyle="--", label="Current 0.55" if args.baseline_threshold == .55 else "Baseline")
    ax.axvline(candidate, color="black", linestyle=":", label=f"Development candidate {candidate:.3f}")
    ax.set(xlabel="Cosine threshold (accept if score >= threshold)", ylabel="Percent",
           title="LFW threshold sweep — descriptive on all pairs", ylim=(-2, 102))
    ax.legend()
    fig.tight_layout()
    fig.savefig(args.output / "threshold_tradeoff.png", dpi=160)
    plt.close(fig)
    lines = ["# LFW threshold tuning", "", f"Selected objective: `{args.objective}`; development FAR budget: {args.target_far:.2%}.", "",
             "| Policy | Accuracy | Genuine acceptance | False acceptance | False rejects | False accepts |",
             "|---|---:|---:|---:|---:|---:|"]
    for row in comparisons:
        lines.append(f"| {row['policy']} | {row['accuracy']:.2%} | {row['true_accept_rate']:.2%} | {row['false_accept_rate']:.2%} | {row['fn']} | {row['fp']} |")
    lines += ["", f"Single development candidate: **{candidate:.3f}**. Fit using all pairs; validate it on new event data before deployment.", "",
              "CV rows select thresholds on nine folds and score the remaining fold; they use different thresholds per fold. "
              "The single all-data candidate and sweep are development results, not held-out estimates. "
              "This changes the decision rule, not model weights; AUC and inference speed are unchanged.", "", *config["caveats"], "",
              "The app's default remains unchanged. `candidate.json` records the candidate; no gallery margin is tuned by pair data."]
    (args.output / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:12]))
    print(f"Results: {args.output}")


if __name__ == "__main__":
    main()
