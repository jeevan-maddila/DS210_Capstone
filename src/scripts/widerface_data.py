"""WIDER FACE loading, validation, and a frozen grouped development split."""
import hashlib
import json
import warnings
from pathlib import Path

import cv2
import numpy as np
from scipy.io import loadmat
from sklearn.model_selection import StratifiedGroupKFold

from benchmark_lfw import ROOT, sha256

DATA = ROOT / "data/raw/widerface"
WORK = ROOT / "data/benchmarks/widerface"
MODEL = ROOT / "data/models/auraface/scrfd_10g_bnkps.onnx"


def text(cell):
    while isinstance(cell, np.ndarray):
        cell = cell.flat[0]
    return str(cell)


def crowd_bin(count):
    return "0" if count == 0 else "1" if count == 1 else "2-5" if count <= 5 else "6-20" if count <= 20 else "21+"


def load_truth(data=DATA):
    gt = data / "eval_tools/ground_truth"
    base = loadmat(gt / "wider_face_val.mat")
    subsets = {name: loadmat(gt / f"wider_{name}_val.mat")["gt_list"] for name in ("easy", "medium", "hard")}
    records = []
    for e, event_cell in enumerate(base["event_list"].flat):
        event = text(event_cell)
        for j, file_cell in enumerate(base["file_list"][e, 0].flat):
            stem = text(file_cell)
            boxes = np.asarray(base["face_bbx_list"][e, 0].flat[j], float).reshape(-1, 4)
            flags = {}
            for key in ("invalid", "occlusion", "blur", "pose"):
                flags[key] = np.asarray(base[f"{key}_label_list"][e, 0].flat[j]).reshape(-1).astype(int)
            if any(len(a) != len(boxes) for a in flags.values()):
                raise ValueError(f"Attribute count mismatch: {stem}")
            masks = {}
            for name, sub in subsets.items():
                indices = np.asarray(sub[e, 0].flat[j]).reshape(-1).astype(int) - 1
                if len(indices) and (indices.min() < 0 or indices.max() >= len(boxes)):
                    raise ValueError(f"Invalid difficulty indices: {stem}")
                mask = np.zeros(len(boxes), bool)
                mask[indices] = True
                masks[name] = mask
            valid = (flags["invalid"] == 0) & (boxes[:, 2] > 0) & (boxes[:, 3] > 0)
            records.append(dict(key=f"{event}/{stem}", event=event, boxes=boxes, flags=flags,
                                masks=masks, valid=valid, crowd=crowd_bin(int(valid.sum()))))
    return records


def prepare(data=DATA, work=WORK):
    work.mkdir(parents=True, exist_ok=True)
    target = work / "dataset_manifest.json"
    records = load_truth(data)
    files = [data / "wider_face_split/wider_face_val_bbx_gt.txt"] + sorted((data / "eval_tools/ground_truth").glob("*.mat"))
    annotation_hashes = {str(p.relative_to(data)): sha256(p) for p in files}
    if target.exists():
        cached = json.loads(target.read_text())
        if cached["annotation_sha256"] != annotation_hashes:
            raise ValueError("Annotations changed after split freeze")
        # Verify content even on resume: cached predictions must not be paired with changed photos.
        for row in cached["images"]:
            p = data / "WIDER_val/images" / (row["key"] + ".jpg")
            if sha256(p) != row["sha256"]:
                raise ValueError(f"Image changed: {p}")
        return records, cached
    if len(records) != 3226:
        raise ValueError(f"Expected 3226 validation photos, got {len(records)}")
    # Cross-check TXT box coordinates against the official MAT annotations.
    lines = iter((data / "wider_face_split/wider_face_val_bbx_gt.txt").read_text().splitlines())
    txt = {}
    for line in lines:
        if not line.endswith(".jpg"):
            continue
        count = int(next(lines))
        values = [list(map(float, next(lines).split())) for _ in range(count)]
        txt[line[:-4]] = np.array(values).reshape(-1, 10)[:, :4]
    images, dhashes, outside, differences = [], [], 0, []
    for i, rec in enumerate(records):
        path = data / "WIDER_val/images" / (rec["key"] + ".jpg")
        image = cv2.imread(str(path))
        if image is None:
            raise ValueError(f"Unreadable or missing photo: {path}")
        h, w = image.shape[:2]
        boxes = rec["boxes"]
        if rec["key"] not in txt or txt[rec["key"]].shape != boxes.shape:
            raise ValueError(f"TXT/MAT box count differs: {rec['key']}")
        if not np.array_equal(txt[rec["key"]], boxes):
            differences.append(dict(key=rec["key"], differing_boxes=int(np.any(txt[rec["key"]] != boxes, axis=1).sum())))
        outside += int(np.sum((boxes[:, 0] < 0) | (boxes[:, 1] < 0) | (boxes[:, 0] + boxes[:, 2] > w) | (boxes[:, 1] + boxes[:, 3] > h)))
        gray = cv2.resize(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY), (9, 8))
        bits = (gray[:, 1:] > gray[:, :-1]).reshape(-1)
        dhashes.append(int.from_bytes(np.packbits(bits).tobytes(), "big"))
        images.append(dict(key=rec["key"], event=rec["event"], crowd=rec["crowd"], width=w, height=h,
                           valid_faces=int(rec["valid"].sum()), eligible_faces=int((rec["valid"] & rec["masks"]["hard"]).sum()),
                           sha256=sha256(path)))
        if (i+1) % 500 == 0:
            print(f"Validated {i+1}/{len(records)} photos", flush=True)
    parent = list(range(len(records)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(a, b):
        parent[find(b)] = find(a)
    scene_ids = {}
    for i, row in enumerate(images):
        scene = row["key"].rsplit("_", 1)[0]
        if scene in scene_ids:
            union(i, scene_ids[scene])
        scene_ids[scene] = i
    near_pairs = 0
    for i, a in enumerate(dhashes):
        for j in range(i):
            if (a ^ dhashes[j]).bit_count() <= 4:
                union(i, j)
                near_pairs += 1
    groups = np.array([find(i) for i in range(len(records))])
    strata = np.array([r["event"] + "/" + r["crowd"] for r in images])
    def imbalance(test):
        return abs(len(test)/len(records)-.2) + sum(abs(np.mean(strata[test] == s)-np.mean(strata == s)) for s in np.unique(strata))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        options = list(StratifiedGroupKFold(5, shuffle=True, random_state=42).split(np.zeros(len(records)), strata, groups))
    dev, hold = min(options, key=lambda pair: imbalance(pair[1]))
    if set(groups[dev]) & set(groups[hold]):
        raise AssertionError("Group leakage")
    hold_set = set(map(int, hold))
    for i, row in enumerate(images):
        row.update(split="holdout" if i in hold_set else "development", group=int(groups[i]), dhash=f"{dhashes[i]:016x}")
    manifest = dict(images=images, annotation_sha256=annotation_hashes, photos=len(images),
                    annotated_faces=sum(len(r["boxes"]) for r in records), valid_faces=sum(int(r["valid"].sum()) for r in records),
                    eligible_faces=sum(r["eligible_faces"] for r in images),
                    original_boxes_outside_image=outside, txt_mat_coordinate_differences=differences,
                    nonpositive_original_boxes=sum(int(((r["boxes"][:,2]<=0)|(r["boxes"][:,3]<=0)).sum()) for r in records),
                    near_duplicate_pairs_grouped=near_pairs,
                    development_images=len(dev), holdout_images=len(hold), random_seed=42,
                    splitting="5-fold StratifiedGroupKFold by event/crowd; most balanced fold held out; scene prefix plus dHash distance <=4 grouped",
                    limitations=["Heuristic duplicate grouping cannot guarantee all related photos are grouped", "Detector pretrained-data overlap with validation photos is not independently established"])
    target.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({k:v for k,v in manifest.items() if k not in ("images", "annotation_sha256")}, indent=2), flush=True)
    return records, manifest


if __name__ == "__main__":
    prepare()
