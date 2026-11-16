"""Recognition-only AuraFace LFW benchmark; run from the repository root."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import pickle
import platform
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from importlib.metadata import version

import numpy as np
from PIL import Image
from sklearn.metrics import roc_auc_score, roc_curve
from sklearn.model_selection import KFold

ROOT = Path(__file__).resolve().parents[2]
REVISION = "af6d057"
EXPECTED_LFW = "9b711dca71a47fc9f295a28514abe8cc4e457632a8d634264691398c99569593"


class DataOnlyUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        raise pickle.UnpicklingError(f"Unsupported serialized object: {module}.{name}")


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_lfw(path):
    with path.open("rb") as stream:
        images, labels = DataOnlyUnpickler(stream, encoding="bytes").load()
    if len(labels) != 6000 or len(images) != 12000:
        raise ValueError("Expected the complete 6,000-pair LFW file")
    if not all(type(label) is bool for label in labels):
        raise ValueError("Expected boolean pair labels")
    labels = np.asarray(labels, dtype=bool)
    # Expected standard View-2 block structure, not proof of official identities.
    if any(labels[start:start + 600].sum() != 300 for start in range(0, 6000, 600)):
        raise ValueError("Expected 300 positive and 300 negative pairs in each fold")
    return images, labels


def confusion(labels, predictions):
    tp = int(np.sum(labels & predictions))
    tn = int(np.sum(~labels & ~predictions))
    fp = int(np.sum(~labels & predictions))
    fn = int(np.sum(labels & ~predictions))
    return dict(tp=tp, tn=tn, fp=fp, fn=fn, accuracy=(tp + tn) / len(labels),
                true_accept_rate=tp / (tp + fn), false_accept_rate=fp / (fp + tn),
                false_reject_rate=fn / (tp + fn),
                precision=tp / (tp + fp) if tp + fp else 0.0,
                f1=2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else 0.0)


def evaluate(scores, labels, fixed_threshold):
    thresholds = np.linspace(-1.0, 1.001, 2002)
    predictions = np.zeros(len(labels), dtype=bool)
    low_far_predictions = np.zeros(len(labels), dtype=bool)
    folds, pair_folds, pair_thresholds = [], np.zeros(len(labels), int), np.zeros(len(labels))
    for fold, (train, test) in enumerate(KFold(10, shuffle=False).split(scores), 1):
        decisions = scores[train, None] >= thresholds[None, :]
        train_accuracy = (decisions == labels[train, None]).mean(axis=0)
        # Deterministic tie break: highest (most conservative) equal-accuracy threshold.
        best = np.flatnonzero(train_accuracy == train_accuracy.max())[-1]
        train_far = decisions[~labels[train]].mean(axis=0)
        low_far = np.flatnonzero(train_far <= 0.01)[0]
        threshold = float(thresholds[best])
        predictions[test] = scores[test] >= threshold
        low_far_predictions[test] = scores[test] >= thresholds[low_far]
        pair_folds[test], pair_thresholds[test] = fold, threshold
        folds.append(dict(fold=fold, threshold=threshold,
                          threshold_at_training_far_1pct=float(thresholds[low_far]),
                          **confusion(labels[test], predictions[test]),
                          low_far_test_tar=confusion(labels[test], low_far_predictions[test])["true_accept_rate"],
                          low_far_test_far=confusion(labels[test], low_far_predictions[test])["false_accept_rate"]))
    return dict(
        cross_validated=confusion(labels, predictions),
        fold_accuracy_mean=float(np.mean([f["accuracy"] for f in folds])),
        fold_accuracy_std=float(np.std([f["accuracy"] for f in folds])),
        roc_auc=float(roc_auc_score(labels, scores)),
        training_far_1pct_operating_point=confusion(labels, low_far_predictions),
        fixed_threshold=dict(threshold=fixed_threshold, **confusion(labels, scores >= fixed_threshold)),
    ), folds, predictions, pair_folds, pair_thresholds


def write_csv(path, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def embed(images, model, out, threads):
    import onnx
    import onnxruntime as ort
    graph = onnx.load(str(model))
    names = [node.name for node in graph.graph.node[:8]]
    internal_normalization = (any(n.startswith(("Sub", "_minus")) for n in names)
                              and any(n.startswith(("Mul", "_mul")) for n in names))
    mean, std = (0.0, 1.0) if internal_normalization else (127.5, 127.5)
    del graph
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    session = ort.InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
    input_info = session.get_inputs()[0]
    print(f"Model input: {input_info.shape}; normalization: (RGB - {mean}) / {std}", flush=True)
    if input_info.shape[2:] != [112, 112]:
        raise ValueError(f"Unexpected input shape: {input_info.shape}")
    for _ in range(3):
        session.run(None, {input_info.name: np.zeros((1, 3, 112, 112), np.float32)})
    embeddings, timings, failures = np.zeros((len(images), 512), np.float32), [], []
    started = time.perf_counter()
    for index, encoded in enumerate(images):
        start = time.perf_counter()
        try:
            with Image.open(io.BytesIO(encoded)) as image:
                if image.size != (112, 112):
                    raise ValueError(f"Unexpected crop dimensions: {image.size}")
                rgb = np.asarray(image.convert("RGB"), dtype=np.float32)
            tensor = np.ascontiguousarray(((rgb - mean) / std).transpose(2, 0, 1)[None])
            vector = session.run(None, {input_info.name: tensor})[0].reshape(-1)
            length = np.linalg.norm(vector)
            if vector.shape != (512,) or not np.isfinite(vector).all() or length <= 0:
                raise ValueError("Invalid embedding")
            embeddings[index] = vector / length
        except Exception as error:
            failures.append(dict(image_index=index, error=str(error)))
        timings.append((time.perf_counter() - start) * 1000)
        if (index + 1) % 200 == 0:
            print(f"Embedded {index + 1}/{len(images)} ({time.perf_counter() - started:.1f}s)", flush=True)
            np.savez_compressed(out / "embeddings_checkpoint.npz", embeddings=embeddings[:index + 1])
    np.savez_compressed(out / "embeddings.npz", embeddings=embeddings)
    metadata = dict(normalization=dict(mean=mean, std=std), rgb=True, horizontal_flip=False,
                    detector_used=False, threads=threads, batch_size=1,
                    warmup_runs=3, latency_scope="image decode + preprocessing + ONNX inference + normalization",
                    latency_median_ms=float(np.median(timings)), latency_p95_ms=float(np.percentile(timings, 95)),
                    images_per_second=len(images) / (time.perf_counter() - started), failures=failures)
    (out / "inference.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return embeddings, metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "data/raw/eval/lfw.bin")
    parser.add_argument("--model", type=Path, default=ROOT / "data/models/auraface/glintr100.onnx")
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--fixed-threshold", type=float, default=0.55,
                        help="App's default cosine threshold; verification only, no gallery margin")
    parser.add_argument("--smoke", action="store_true", help="Only 100 pairs; does not produce benchmark metrics")
    parser.add_argument("--reuse-embeddings", action="store_true", help="Re-evaluate same run without inference; validates hashes")
    args = parser.parse_args()
    if args.threads < 1 or not -1 <= args.fixed_threshold <= 1:
        parser.error("Use positive threads and a cosine threshold in [-1, 1]")
    out = args.output or ROOT / "data/benchmarks" / datetime.now(timezone.utc).strftime("lfw_%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=True)
    if (out / "run.json").exists() and not args.reuse_embeddings:
        parser.error("Output already contains a run; use a new output directory")
    images, labels = load_lfw(args.data)
    if args.smoke:
        # Balanced sample from the first fold. No accuracy claims for this subset.
        ids = np.r_[np.flatnonzero(labels[:600])[:50], np.flatnonzero(~labels[:600])[:50]]
        images = [images[2 * i + side] for i in ids for side in (0, 1)]
        labels = labels[ids]
    if not args.model.exists():
        from huggingface_hub import hf_hub_download
        hf_hub_download("fal/AuraFace-v1", "glintr100.onnx", revision=REVISION, local_dir=str(args.model.parent))
        if not args.model.exists():
            raise FileNotFoundError(args.model)
    dataset_hash, model_hash = sha256(args.data), sha256(args.model)
    if args.reuse_embeddings:
        old = json.loads((out / "run.json").read_text())
        if (old["dataset_sha256"], old["model_sha256"], old["smoke"]) != (dataset_hash, model_hash, args.smoke):
            raise ValueError("Cached run does not match requested dataset/model/mode")
        embeddings = np.load(out / "embeddings.npz")["embeddings"]
        inference = json.loads((out / "inference.json").read_text())
    else:
        embeddings, inference = embed(images, args.model, out, args.threads)
    if inference["failures"]:
        raise RuntimeError(f"{len(inference['failures'])} image failures; inspect inference.json. No incomplete accuracy reported.")
    if embeddings.shape != (2 * len(labels), 512):
        raise ValueError("Embedding cache shape mismatch")
    scores = np.clip(np.sum(embeddings[0::2] * embeddings[1::2], axis=1), -1, 1)
    try:
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        commit = None
    run = dict(created_utc=datetime.now(timezone.utc).isoformat(), smoke=args.smoke,
               model="fal/AuraFace-v1", requested_revision=REVISION,
               dataset_sha256=dataset_hash, dataset_matches_checked_copy=dataset_hash == EXPECTED_LFW,
               model_sha256=model_hash, script_sha256=sha256(__file__), git_commit=commit,
               python=platform.python_version(), platform=platform.platform(), processor=platform.processor(),
               packages={p: version(p) for p in ("numpy", "pillow", "onnx", "onnxruntime", "scikit-learn", "matplotlib")},
               pairs=len(labels), images=len(images), inference=inference,
               protocol="10 contiguous folds, no shuffle; cosine >= threshold; thresholds selected on other 9 folds",
               limitations=["Prepared crops; no detector/alignment benchmark", "Official pair identities/order not independently verified", "Pretraining overlap unknown", "Single pass; no horizontal flip augmentation", "Folds may share identities; not identity-disjoint evaluation"])
    if not args.smoke:
        metrics, folds, predictions, pair_folds, pair_thresholds = evaluate(scores, labels, args.fixed_threshold)
        run["metrics"] = metrics
        write_csv(out / "folds.csv", folds)
        write_csv(out / "pairs.csv", [dict(pair_index=i, fold=int(pair_folds[i]), same_person=bool(labels[i]),
                                          cosine=float(scores[i]), threshold=float(pair_thresholds[i]),
                                          predicted_same=bool(predictions[i]), correct=bool(predictions[i] == labels[i]))
                                      for i in range(len(labels))])
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fpr, tpr, thresholds = roc_curve(labels, scores)
        write_csv(out / "roc.csv", [dict(false_accept_rate=float(a), true_accept_rate=float(b), threshold=float(c))
                                    for a, b, c in zip(fpr, tpr, thresholds)])
        fig, axes = plt.subplots(1, 2, figsize=(11, 4))
        axes[0].plot(fpr, tpr)
        axes[0].set(xlabel="False accept rate", ylabel="True accept rate", title=f"LFW ROC (AUC {metrics['roc_auc']:.5f})")
        for value, label in [(False, "Different person"), (True, "Same person")]:
            axes[1].hist(scores[labels == value], bins=60, alpha=.6, label=label)
        axes[1].set(xlabel="Cosine similarity", ylabel="Pairs", title="Similarity distributions")
        axes[1].legend()
        fig.tight_layout()
        fig.savefig(out / "metrics.png", dpi=160)
        plt.close(fig)
        report = (f"# LFW AuraFace baseline\n\n"
                  f"Recognition only, {len(labels):,} pairs; CPU, one image at a time, no flip augmentation.\n\n"
                  f"| Metric | Result |\n|---|---:|\n"
                  f"| 10-fold accuracy | {metrics['fold_accuracy_mean']:.2%} |\n"
                  f"| Always predict different person (reference) | {np.mean(~labels):.2%} |\n"
                  f"| Fold accuracy standard deviation | {100 * metrics['fold_accuracy_std']:.3f} percentage points |\n"
                  f"| ROC AUC | {metrics['roc_auc']:.6f} |\n"
                  f"| False accepts / rejects | {metrics['cross_validated']['fp']} / {metrics['cross_validated']['fn']} |\n"
                  f"| TAR at training FAR target 1% | {metrics['training_far_1pct_operating_point']['true_accept_rate']:.2%} |\n"
                  f"| Actual held-out FAR at that operating point | {metrics['training_far_1pct_operating_point']['false_accept_rate']:.2%} |\n"
                  f"| Median / p95 image latency | {inference['latency_median_ms']:.1f} / {inference['latency_p95_ms']:.1f} ms |\n"
                  f"| Image failures | {len(inference['failures'])} |\n\n"
                  f"At the separately fixed cosine threshold {args.fixed_threshold:.3f}, accuracy is "
                  f"{metrics['fixed_threshold']['accuracy']:.2%}, false accept rate "
                  f"{metrics['fixed_threshold']['false_accept_rate']:.2%}, and false reject rate "
                  f"{metrics['fixed_threshold']['false_reject_rate']:.2%}. "
                  "Zero observed false accepts is not proof of zero population risk. "
                  "Do not deploy a threshold selected only from these LFW results.\n\n"
                  "Thresholds are selected on nine folds and evaluated on the remaining fold. "
                  "Fold standard deviation is not a confidence interval. ROC AUC is descriptive over all pairs. "
                  "The 1% training FAR target does not guarantee 1% held-out FAR. "
                  "Fixed-threshold results in run.json use a separately supplied threshold; they are not the CV score.\n\n"
                  "## Limits\n\n" + "\n".join(f"- {x}" for x in run["limitations"]) + "\n\n"
                  "Compare future runs on this same dataset hash and protocol. Compare latency only with the same hardware, "
                  "thread count and preprocessing. Do not claim event-photo or Google Cloud performance from this result.\n")
        (out / "report.md").write_text(report, encoding="utf-8")
        print(json.dumps(metrics, indent=2), flush=True)
    (out / "run.json").write_text(json.dumps(run, indent=2), encoding="utf-8")
    print(f"Results: {out}", flush=True)


if __name__ == "__main__":
    main()
