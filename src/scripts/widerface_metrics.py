"""Detection accounting and a NumPy port of the supplied WIDER MATLAB protocol.

Protocol reference: data/raw/widerface/eval_tools/{evaluation,norm_score,boxoverlap}.m
This is a port, not an execution of MATLAB. AP preserves official masks and +1 IoU.
Custom operating-point accounting instead uses continuous box areas and valid hard faces.
"""
import numpy as np


def overlap(predictions, boxes, inclusive=False):
    pred = np.asarray(predictions, float).reshape(-1, 5)
    gt = np.asarray(boxes, float).reshape(-1, 4).copy()
    gt[:, 2:] += gt[:, :2]
    if not len(pred) or not len(gt):
        return np.zeros((len(pred), len(gt)))
    delta = 1.0 if inclusive else 0.0
    lo = np.maximum(pred[:, None, :2], gt[None, :, :2])
    hi = np.minimum(pred[:, None, 2:4], gt[None, :, 2:4])
    span = np.maximum(0, hi-lo+delta)
    intersection = span[:, :, 0]*span[:, :, 1]
    pa = np.maximum(0,pred[:,2]-pred[:,0]+delta)*np.maximum(0,pred[:,3]-pred[:,1]+delta)
    ga = np.maximum(0,gt[:,2]-gt[:,0]+delta)*np.maximum(0,gt[:,3]-gt[:,1]+delta)
    union = pa[:,None]+ga[None,:]-intersection
    return np.divide(intersection, union, out=np.zeros_like(intersection), where=union>0)


def match(predictions, boxes, eligible, inclusive=False):
    """Score-ordered, best-overlap assignment. Duplicate valid detections are false positives.

    Matches to ignored GT do not contribute TP or FP, following WIDER semantics.
    Returns prediction TP/FP flags and the GT index matched by each true positive.
    """
    pred = np.asarray(predictions,float).reshape(-1,5)
    eligible = np.asarray(eligible,bool)
    tp, fp = np.zeros(len(pred),bool), np.ones(len(pred),bool)
    matched_indices = np.full(len(pred),-1,int)
    claimed = np.zeros(len(boxes),bool)
    if not len(boxes) or not len(pred):
        return tp, fp, matched_indices
    ious = overlap(pred,boxes,inclusive)
    maxima, indices = ious.max(axis=1), ious.argmax(axis=1)
    for i,(score,j) in enumerate(zip(maxima,indices)):
        if score < .5:
            continue
        if not eligible[j]:
            fp[i] = False
        elif not claimed[j]:
            tp[i],fp[i],claimed[j],matched_indices[i] = True,False,True,j
    return tp,fp,matched_indices


def operating_record(rec, pred_row):
    predictions = np.asarray(pred_row["boxes"],float).reshape(-1,5)
    eligible = rec["valid"] & rec["masks"]["hard"]
    tp,fp,indices = match(predictions,rec["boxes"],eligible)
    return dict(scores=predictions[:,4],tp=tp,fp=fp,indices=indices,eligible=eligible,
                latency_ms=pred_row["latency_ms"],key=rec["key"],crowd=rec["crowd"],rec=rec)


def summarize(rows, threshold):
    totals = dict(images=len(rows), eligible_faces=0, true_positives=0,false_positives=0,
                  false_negatives=0,complete_photos=0,eligible_photos=0,ignored_predictions=0)
    for row in rows:
        accepted = row["scores"] >= threshold
        tp,fp = int(row["tp"][accepted].sum()),int(row["fp"][accepted].sum())
        n = int(row["eligible"].sum())
        totals["eligible_faces"] += n
        totals["true_positives"] += tp
        totals["false_positives"] += fp
        totals["false_negatives"] += n-tp
        totals["eligible_photos"] += int(n>0)
        totals["complete_photos"] += int(n>0 and tp==n)
        totals["ignored_predictions"] += int(accepted.sum())-tp-fp
    tp,fp,fn = (totals[k] for k in ("true_positives","false_positives","false_negatives"))
    totals.update(precision=tp/(tp+fp) if tp+fp else 0,recall=tp/(tp+fn) if tp+fn else 0,
                  f1=2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0,
                  complete_photo_rate=totals["complete_photos"]/totals["eligible_photos"] if totals["eligible_photos"] else 0,
                  false_positives_per_image=fp/len(rows) if rows else 0,
                  median_ms=float(np.median([r["latency_ms"] for r in rows])) if rows else 0,
                  p95_ms=float(np.percentile([r["latency_ms"] for r in rows],95)) if rows else 0)
    return totals


def voc_ap(recall, precision):
    r = np.r_[0, recall, 1]
    p = np.r_[0, precision, 0]
    p = np.maximum.accumulate(p[::-1])[::-1]
    changes = np.flatnonzero(r[1:] != r[:-1])+1
    return float(np.sum((r[changes]-r[changes-1])*p[changes]))


def official_protocol_ap(records,predictions,subset):
    """MATLAB-protocol AP: global min/max normalization, 1000 thresholds, official masks.

    Original degenerate negative-width GT is retained in the AP denominator.
    It has zero IoU; custom metrics exclude it. Predictions must be sorted.
    """
    nonempty = [np.asarray(predictions[r["key"]]["boxes"],float).reshape(-1,5) for r in records]
    available = [p[:,4] for p in nonempty if len(p)]
    if not available:
        return dict(ap=0.0,gt_faces=sum(int(r["masks"][subset].sum()) for r in records)),np.zeros((1000,2))
    minimum,maximum = min(float(p.min()) for p in available),max(float(p.max()) for p in available)
    thresholds = 1-np.arange(1,1001)/1000
    proposals, recalled = np.zeros(1000),np.zeros(1000)
    total_faces = 0
    for rec,pred in zip(records,nonempty):
        total_faces += int(rec["masks"][subset].sum())
        if not len(pred) or not len(rec["boxes"]):
            continue
        tp,fp,_ = match(pred,rec["boxes"],rec["masks"][subset],inclusive=True)
        scores = (pred[:,4]-minimum)/(maximum-minimum) if maximum>minimum else np.ones(len(pred))
        positions = np.searchsorted(-scores,-thresholds,side="right")-1
        valid = positions>=0
        proposals[valid] += np.cumsum(tp|fp)[positions[valid]]
        recalled[valid] += np.cumsum(tp)[positions[valid]]
    precision = np.divide(recalled,proposals,out=np.zeros_like(recalled),where=proposals>0)
    recall = recalled/total_faces if total_faces else np.zeros(1000)
    return dict(ap=voc_ap(recall,precision),gt_faces=total_faces,
                global_score_min=minimum,global_score_max=maximum),np.column_stack([recall,precision])


def breakdown(rows, threshold, attribute):
    """GT-based recall only. False detections cannot be assigned a true face attribute."""
    result = {}
    for row in rows:
        rec=row["rec"]
        hits=np.zeros(len(rec["boxes"]),bool)
        selected=(row["scores"]>=threshold)&row["tp"]
        hits[row["indices"][selected]]=True
        if attribute=="size":
            heights=rec["boxes"][:,3]
            groups=np.where(heights<32,"<32 px",np.where(heights<96,"32-95 px",">=96 px"))
        else:
            groups=np.array([str(v) for v in rec["flags"][attribute]])
        for name in np.unique(groups[row["eligible"]]):
            mask=(groups==name)&row["eligible"]
            counts=result.setdefault(str(name),dict(faces=0,detected=0))
            counts["faces"]+=int(mask.sum());counts["detected"]+=int((mask&hits).sum())
    return [dict(group=name,**v,missed=v["faces"]-v["detected"],recall=v["detected"]/v["faces"]) for name,v in sorted(result.items())]
