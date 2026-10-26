"""Cache resumable single-scale SCRFD predictions, independent of Firebase."""
import argparse
import json
import platform
import time
from importlib.metadata import version

import cv2
import numpy as np
import onnxruntime as ort
from insightface.model_zoo import get_model

from benchmark_lfw import sha256
from widerface_data import DATA, WORK, MODEL, prepare


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--size", type=int, default=1024, choices=[640, 1024, 1280])
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--limit", type=int, default=0, help="Smoke only: seeded crowd-stratified 50 photo sample")
    p.add_argument("--score-floor", type=float, default=.02)
    args = p.parse_args()
    records, manifest = prepare()
    work = WORK / ("smoke" if args.limit else "predictions")
    work.mkdir(parents=True, exist_ok=True)
    meta_file = work / f"{args.size}_metadata.json"
    pred_file = work / f"{args.size}.jsonl"
    options = ort.SessionOptions()
    options.intra_op_num_threads = args.threads
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(MODEL), sess_options=options, providers=["CPUExecutionProvider"])
    detector = get_model(str(MODEL), session=session, providers=["CPUExecutionProvider"])
    # get_model may route/create its own session: explicitly bind this configured CPU session.
    detector.session = session
    detector.prepare(ctx_id=-1, input_size=(args.size, args.size), det_thresh=args.score_floor, nms_thresh=.4)
    actual_sizes = getattr(detector, "input_sizes", [(args.size, args.size)])
    if actual_sizes != [(args.size, args.size)]:
        raise ValueError(f"Unexpected detector input sizes: {actual_sizes}")
    meta = dict(size=args.size, threads=args.threads, score_floor=args.score_floor, nms=.4,
                model_sha256=sha256(MODEL), manifest_sha256=sha256(WORK / "dataset_manifest.json"),
                smoke_limit=args.limit, provider=session.get_providers(), python=platform.python_version(),
                processor=platform.processor(), platform=platform.platform(),
                versions={k:version(k) for k in ("insightface", "onnxruntime", "numpy", "opencv-python", "scipy")},
                latency_scope="JPEG decode + SCRFD resize/normalization/inference/box decode/NMS; no embeddings, no Firebase",
                timing_score_floor=args.score_floor, warmup_runs=3, script_sha256=sha256(__file__))
    if meta_file.exists():
        previous = json.loads(meta_file.read_text())
        if previous != meta:
            raise ValueError("Cache metadata differs; do not mix prediction configurations")
    else:
        meta_file.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    selected = records
    if args.limit:
        rng = np.random.default_rng(42)
        sampled = []
        for crowd in ("0", "1", "2-5", "6-20", "21+"):
            pool = [i for i,r in enumerate(records) if r["crowd"] == crowd]
            sampled.extend(rng.choice(pool, min(len(pool), max(1,args.limit//4)), replace=False).tolist())
        selected = [records[i] for i in sorted(sampled)[:args.limit]]
    seen = set()
    if pred_file.exists():
        # A final interrupted JSON line is not reused; reject rather than silently lose it.
        for line in pred_file.read_text().splitlines():
            row = json.loads(line)
            if row["key"] in seen:
                raise ValueError("Duplicate cached prediction")
            if row.get("error"):
                raise ValueError(f"Cached failure needs investigation: {row}")
            seen.add(row["key"])
    warm = np.zeros((600, 800, 3), np.uint8)
    for _ in range(3):
        detector.detect(warm, input_size=(args.size,args.size), max_num=0)
    started = time.perf_counter()
    with pred_file.open("a", encoding="utf-8") as stream:
        for index, rec in enumerate(selected):
            if rec["key"] in seen:
                continue
            start = time.perf_counter()
            image = cv2.imread(str(DATA / "WIDER_val/images" / (rec["key"] + ".jpg")))
            if image is None:
                raise ValueError(f"Unreadable photo: {rec['key']}")
            boxes, _ = detector.detect(image, input_size=(args.size,args.size), max_num=0)
            elapsed = (time.perf_counter()-start)*1000
            boxes = boxes[np.argsort(-boxes[:,4],kind="stable")]
            if not np.isfinite(boxes).all():
                raise ValueError("Nonfinite detections")
            row = dict(key=rec["key"], boxes=boxes.tolist(), latency_ms=elapsed)
            stream.write(json.dumps(row)+"\n")
            stream.flush()
            if (index+1)%50 == 0 or index+1 == len(selected):
                print(f"size={args.size} completed {index+1}/{len(selected)}; active elapsed={time.perf_counter()-started:.1f}s; last image={elapsed:.1f}ms",flush=True)
    print(f"Completed: {pred_file}",flush=True)


if __name__ == "__main__":
    main()
