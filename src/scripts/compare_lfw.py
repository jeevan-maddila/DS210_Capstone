"""Compare two completed recognition-only LFW benchmark runs."""
import argparse
import csv
import json
from pathlib import Path


def compare(baseline, candidate):
    for field in ("dataset_sha256", "protocol", "pairs", "smoke"):
        if baseline[field] != candidate[field]:
            raise ValueError(f"Incomparable runs: {field} differs")
    if baseline["smoke"]:
        raise ValueError("Smoke tests are not full benchmarks")
    for field in ("normalization", "rgb", "horizontal_flip", "detector_used"):
        if baseline["inference"][field] != candidate["inference"][field]:
            raise ValueError(f"Incomparable preprocessing: {field}")
    rows = []
    for label, keys in [
        ("CV accuracy", ("metrics", "fold_accuracy_mean")),
        ("ROC AUC", ("metrics", "roc_auc")),
        ("False accepts", ("metrics", "cross_validated", "fp")),
        ("False rejects", ("metrics", "cross_validated", "fn")),
        ("TAR at train FAR target 1%", ("metrics", "training_far_1pct_operating_point", "true_accept_rate")),
        ("Actual held-out FAR", ("metrics", "training_far_1pct_operating_point", "false_accept_rate")),
    ]:
        a, b = baseline, candidate
        for key in keys:
            a, b = a[key], b[key]
        rows.append(dict(metric=label, baseline=a, candidate=b, delta=b-a))
    same_timing_setup = all(baseline.get(k) == candidate.get(k) for k in ("platform", "processor"))
    same_timing_setup &= all(baseline["inference"][k] == candidate["inference"][k]
                             for k in ("threads", "batch_size", "latency_scope"))
    if same_timing_setup:
        for key in ("latency_median_ms", "latency_p95_ms"):
            a, b = baseline["inference"][key], candidate["inference"][key]
            rows.append(dict(metric=key, baseline=a, candidate=b, delta=b-a))
    return rows, same_timing_setup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path, help="Baseline run.json")
    parser.add_argument("candidate", type=Path, help="Candidate run.json")
    parser.add_argument("--output", type=Path, help="Optional comparison CSV")
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))
    rows, same_timing_setup = compare(baseline, candidate)
    print(f"{'Metric':32} {'Baseline':>12} {'Candidate':>12} {'Delta':>12}")
    for row in rows:
        print(f"{row['metric']:32} {row['baseline']:12.6f} {row['candidate']:12.6f} {row['delta']:+12.6f}")
    print("Rate deltas are fractions: +0.01 means +1 percentage point.")
    if not same_timing_setup:
        print("Timing configuration differs; latency comparison omitted.")
    else:
        print("Timing setup fields match; host load and unrecorded hardware differences can still affect latency.")
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)


if __name__ == "__main__":
    main()
