"""Generate LFW tuning comparison figures from the saved baseline scores."""
import argparse
import csv
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from benchmark_lfw import ROOT, confusion, write_csv, sha256
from tune_lfw_threshold import cross_validate, select_threshold

COLORS = ["#64748b", "#2563eb", "#0f766e", "#c2410c"]
LABELS = ["Original\n0.55", "Tune for\naccuracy", "FAR budget\n0.5%", "FAR budget\n1%"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, default=ROOT / "data/benchmarks/lfw_auraface_baseline")
    parser.add_argument("--output", type=Path, default=ROOT / "reports/lfw_visualizations")
    args = parser.parse_args()
    run = json.loads((args.baseline / "run.json").read_text(encoding="utf-8"))
    with (args.baseline / "pairs.csv").open(encoding="utf-8", newline="") as f:
        pairs = list(csv.DictReader(f))
    if run["smoke"] or run["inference"]["failures"] or len(pairs) != 6000:
        raise ValueError("A complete, failure-free baseline is required")
    if [int(p["pair_index"]) for p in pairs] != list(range(6000)):
        raise ValueError("Pair ordering differs from the expected baseline")
    if any(p["same_person"] not in ("True", "False") for p in pairs):
        raise ValueError("Invalid pair labels")
    scores = np.array([float(p["cosine"]) for p in pairs])
    labels = np.array([p["same_person"] == "True" for p in pairs])
    if not np.isfinite(scores).all() or np.any(np.abs(scores) > 1):
        raise ValueError("Invalid cosine scores")
    if any(labels[i:i+600].sum() != 300 for i in range(0, 6000, 600)):
        raise ValueError("Unexpected fold balance")
    args.output.mkdir(parents=True, exist_ok=True)
    rows = [dict(policy="Original fixed 0.55", **confusion(labels, scores >= .55))]
    fold_sets, candidates = [], []
    for objective, budget, title in [("accuracy", .005, "CV accuracy"),
                                     ("far", .005, "CV FAR budget 0.5%"),
                                     ("far", .01, "CV FAR budget 1%")]:
        metrics, folds, *_ = cross_validate(scores, labels, objective, budget)
        rows.append(dict(policy=title, **metrics))
        fold_sets.append(folds)
        candidates.append(select_threshold(scores, labels, objective, budget))
    write_csv(args.output / "policy_metrics.csv", rows)
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11,
                         "axes.spines.top": False, "axes.spines.right": False,
                         "axes.titleweight": "bold", "axes.titlepad": 14,
                         "figure.facecolor": "white", "axes.facecolor": "white"})
    x = np.arange(4)
    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    panels = [(axes[0, 0], "true_accept_rate", "A  Genuine pairs accepted", "Acceptance (%)"),
              (axes[0, 1], "false_accept_rate", "B  Different-person pairs accepted", "False acceptance (%)")]
    for ax, key, title, ylabel in panels:
        values = [100 * r[key] for r in rows]
        ax.bar(x, values, color=COLORS, width=.6)
        for i, value in enumerate(values):
            ax.text(i, value + (1.2 if key == "true_accept_rate" else .025), f"{value:.2f}%", ha="center", weight="bold")
        ax.set(xticks=x, xticklabels=LABELS, ylabel=ylabel, title=title,
               ylim=(0, 108 if key == "true_accept_rate" else 1.0))
        ax.grid(axis="y", alpha=.18)
        ax.set_axisbelow(True)
    ax = axes[1, 0]
    for i, row in enumerate(rows):
        for delta, key, marker, color in [(-.12, "fn", "o", "#be123c"), (.12, "fp", "s", "#7c3aed")]:
            # symlog admits the original zero without substituting a fake count.
            value = row[key]
            ax.scatter(i + delta, value, marker=marker, color=color, s=65,
                       label=("False rejects" if key == "fn" else "False accepts") if i == 0 else None)
            ax.annotate(str(value), (i + delta, value), xytext=(0, 9), textcoords="offset points", ha="center")
    ax.set_yscale("symlog", linthresh=1)
    ax.set(xticks=x, xticklabels=LABELS, ylabel="Errors (symmetric log scale)",
           title="C  Mistakes out of 6,000 pairs", ylim=(-.3, 3500))
    ax.set_yticks([0, 1, 10, 100, 1000], labels=["0", "1", "10", "100", "1,000"])
    ax.legend(loc="upper right", fontsize=10)
    ax.grid(axis="y", alpha=.18)
    ax = axes[1, 1]
    accuracy = [100*r["accuracy"] for r in rows]
    ax.scatter(accuracy, x, c=COLORS, s=90)
    for i, value in enumerate(accuracy):
        ax.annotate(f"{value:.2f}%", (value, i), xytext=(7, 0), textcoords="offset points", va="center")
    ax.set(yticks=x, yticklabels=LABELS, xlabel="Accuracy (%) — zoomed axis",
           title="D  Overall verification accuracy", xlim=(80, 102))
    ax.invert_yaxis()
    ax.grid(axis="x", alpha=.18)
    fig.suptitle("LFW: what changes when we tune the decision threshold?", fontsize=19, weight="bold", y=.985)
    fig.text(.5, .012, "6,000 pairs · same AuraFace weights · tuned policies use 10-fold CV · original is fixed\n"
             "Retrospective local LFW analysis; prepared crops, not event-gallery performance. Zero observed errors does not imply zero risk.",
             ha="center", fontsize=10, color="#475569")
    fig.tight_layout(rect=(0, .055, 1, .955), h_pad=2.5, w_pad=3)
    save(fig, args.output, "01_policy_comparison")

    frontier = []
    for budget in [.001, .0025, .005, .01, .02]:
        metrics, folds, *_ = cross_validate(scores, labels, "far", budget)
        frontier.append(dict(training_far_budget=budget, candidate_threshold=select_threshold(scores, labels, "far", budget),
                             threshold_min=min(f["threshold"] for f in folds),
                             threshold_max=max(f["threshold"] for f in folds), **metrics))
    write_csv(args.output / "far_budget_metrics.csv", frontier)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.5))
    budgets = [100*r["training_far_budget"] for r in frontier]
    axes[0].plot(budgets, [100*r["true_accept_rate"] for r in frontier], "o-", color="#0f766e")
    for r in frontier:
        axes[0].annotate(f"{r['true_accept_rate']:.2%}", (100*r["training_far_budget"], 100*r["true_accept_rate"]),
                         xytext=(0, 10), textcoords="offset points", ha="center", fontsize=9)
    axes[0].set(xlabel="Development FAR budget (%)", ylabel="Held-out genuine acceptance (%)",
                title="Higher budget accepts more genuine pairs", ylim=(96, 100))
    axes[1].plot(budgets, [100*r["false_accept_rate"] for r in frontier], "o-", color="#c2410c", label="Actual held-out FAR")
    axes[1].plot(budgets, budgets, "--", color="#64748b", label="Training budget reference")
    axes[1].set(xlabel="Development FAR budget (%)", ylabel="Held-out false acceptance (%)",
                title="Test FAR can differ from the budget", ylim=(0, 2.5))
    axes[1].legend()
    for ax in axes:
        ax.grid(alpha=.2)
    fig.suptitle("Hyperparameter experiment: the false-accept budget", fontsize=16, weight="bold")
    fig.text(.5, .015, "Each point is a separate retrospective 10-fold CV policy; selecting the best point still requires new validation.", ha="center", fontsize=9)
    fig.tight_layout(rect=(0, .05, 1, .92))
    save(fig, args.output, "02_far_budget_tradeoff")

    grid = np.linspace(.1, .65, 551)
    sweep = [dict(threshold=float(t), **confusion(labels, scores >= t)) for t in grid]
    write_csv(args.output / "descriptive_threshold_sweep.csv", sweep)
    fig, axes = plt.subplots(1, 2, figsize=(13, 5.5))
    axes[0].plot(grid, [100*r["true_accept_rate"] for r in sweep], color="#2563eb", label="Genuine acceptance")
    axes[0].plot(grid, [100*r["accuracy"] for r in sweep], color="#0f766e", label="Accuracy")
    axes[1].plot(grid, [100*r["false_accept_rate"] for r in sweep], color="#c2410c", label="False acceptance")
    for ax in axes:
        for t, color, label in [(.55, COLORS[0], "Original 0.550"),
                                 (candidates[1], COLORS[2], f"0.5% budget candidate {candidates[1]:.3f}"),
                                 (candidates[2], COLORS[3], f"1% budget candidate {candidates[2]:.3f}")]:
            ax.axvline(t, color=color, linestyle="--", alpha=.7, label=label)
        ax.set(xlabel="Cosine threshold", ylabel="Percent", xlim=(.1, .65))
        ax.legend(fontsize=8, loc="lower left" if ax is axes[0] else "upper right")
        ax.grid(alpha=.2)
    axes[0].set(title="Genuine acceptance and accuracy", ylim=(40, 102))
    axes[1].set(title="False accepts (zoomed to 0–3%)", ylim=(0, 3))
    fig.suptitle("Threshold sweep: descriptive results on all pairs", fontsize=16, weight="bold")
    fig.text(.5, .015, "Candidate thresholds are fit on all 6,000 pairs. Curves are in-sample descriptions, not held-out candidate scores.", ha="center", fontsize=9)
    fig.tight_layout(rect=(0, .05, 1, .92))
    save(fig, args.output, "03_threshold_sweep")

    fig, ax = plt.subplots(figsize=(11, 5.5))
    fold_rows = []
    for folds, color, title in zip(fold_sets, COLORS[1:], ["Maximize accuracy", "FAR budget 0.5%", "FAR budget 1%"]):
        ax.plot(range(1, 11), [f["threshold"] for f in folds], "o-", color=color, label=title)
        fold_rows.extend(dict(policy=title, **f) for f in folds)
    ax.axhline(.55, linestyle="--", color=COLORS[0], label="Original 0.55")
    ax.set(xlabel="Held-out fold", ylabel="Threshold fitted on the other nine folds",
           title="Thresholds vary with the objective and development pairs", xticks=range(1, 11), ylim=(.17, .59))
    ax.legend(loc="center right")
    ax.grid(alpha=.2)
    fig.text(.5, .015, "A CV policy uses ten fitted thresholds; its pooled score is not a test score for one all-data candidate.", ha="center", fontsize=9)
    fig.tight_layout(rect=(0, .045, 1, 1))
    save(fig, args.output, "04_fold_thresholds")
    write_csv(args.output / "fold_metrics.csv", fold_rows)
    manifest = dict(dataset_sha256=run["dataset_sha256"], model_sha256=run["model_sha256"],
                    source_pairs_sha256=sha256(args.baseline / "pairs.csv"), script_sha256=sha256(__file__),
                    parameters_varied=["cosine threshold", "selection objective", "training FAR budget"],
                    unchanged=["model weights", "embeddings", "pair ordering", "preprocessing"],
                    caveats=run["limitations"] + ["Retrospective CV; not a new untouched test set"])
    (args.output / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    lines = ["# LFW benchmark visuals", "", "Run from the repository root:", "", "```powershell",
             "& .venv/Scripts/python.exe src/scripts/visualize_lfw_benchmarks.py", "```", "",
             "The figures reuse saved scores and do not rerun model inference. PNG files are ready for slides; SVG files are scalable.", "",
             "1. **01_policy_comparison:** original threshold vs accuracy tuning vs 0.5% and 1% FAR budgets.",
             "2. **02_far_budget_tradeoff:** genuine and false acceptance as the training FAR budget changes.",
             "3. **03_threshold_sweep:** descriptive all-pair curves; these are not held-out scores for the candidate thresholds.",
             "4. **04_fold_thresholds:** threshold selected by each objective for each held-out fold.", "",
             "The original threshold is fixed; tuned-policy metrics use nine-fold calibration and one-fold evaluation. "
             "This is retrospective LFW analysis. Model weights and AUC are unchanged by threshold tuning. "
             "No app configuration was changed. The gallery runner-up margin is not evaluated by LFW pairs.", "",
             "| Policy | Accuracy | Genuine acceptance | False acceptance | False rejects | False accepts |",
             "|---|---:|---:|---:|---:|---:|"]
    for r in rows:
        lines.append(f"| {r['policy']} | {r['accuracy']:.2%} | {r['true_accept_rate']:.2%} | {r['false_accept_rate']:.2%} | {r['fn']} | {r['fp']} |")
    lines += ["", "Rates are calculated separately over 3,000 genuine and 3,000 different-person pairs. "
              "Original zero false accepts is an observed count, not a zero-risk guarantee. "
              "Changing training FAR budgets is exploratory; use new event data to validate a final choice.", ""]
    (args.output / "README.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[-9:]))
    print(f"Saved four PNG/SVG figures and metric tables to {args.output}")


def save(fig, output, name):
    for extension in ("png", "svg"):
        fig.savefig(output / f"{name}.{extension}", dpi=180)
    plt.close(fig)


if __name__ == "__main__":
    main()
