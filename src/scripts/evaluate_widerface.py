"""Evaluate cached SCRFD detections; select on development, report frozen holdout.

No cloud access or new detector inference. Standard-protocol AP uses a tested
NumPy port of supplied MATLAB scripts; predictions are also exported for MATLAB.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from benchmark_lfw import ROOT, sha256, write_csv
from widerface_data import WORK, DATA, MODEL, load_truth
from widerface_metrics import operating_record, summarize, official_protocol_ap, breakdown, overlap

OUTPUT = ROOT / "reports/widerface"
SIZES = (640,1024,1280)
THRESHOLDS = (.15,.25,.35,.45,.55)


def effective_split(manifest, smoke_keys):
    seen_groups={r["group"] for r in manifest["images"] if r["key"] in smoke_keys}
    split={r["key"]:("smoke_excluded" if r["split"]=="holdout" and r["group"] in seen_groups else r["split"])
           for r in manifest["images"]}
    audit=dict(original_holdout_images=manifest["holdout_images"],
               smoke_images_in_original_holdout=sum(r["split"]=="holdout" and r["key"] in smoke_keys for r in manifest["images"]),
               excluded_smoke_related_images=sum(s=="smoke_excluded" for s in split.values()),
               final_holdout_images=sum(s=="holdout" for s in split.values()),
               rule="Exclude originally held-out scene/dHash groups containing any smoke-inspected photo; development unchanged",
               reason="QA sample included original holdout photos. Correction made before candidate selection or final holdout scoring.")
    return split,audit


def choose_configuration(development_metrics, precision_target=.95):
    """Never accepts holdout results. No feasible candidate means no recommendation."""
    eligible=[r for r in development_metrics if r["precision"]>=precision_target]
    if not eligible:
        return None
    return max(eligible,key=lambda r:(r["recall"],-r["median_ms"],r["precision"],r["threshold"]))


def read_predictions(size,records):
    folder=WORK/"predictions"
    meta=json.loads((folder/f"{size}_metadata.json").read_text())
    if meta["model_sha256"]!=sha256(MODEL) or meta["manifest_sha256"]!=sha256(WORK/"dataset_manifest.json"):
        raise ValueError("Model/dataset differs from cached predictions")
    if meta["size"]!=size or meta["score_floor"]!=.02 or meta["nms"]!=.4 or meta["smoke_limit"]:
        raise ValueError("Unexpected prediction settings")
    preds={}
    for line in (folder/f"{size}.jsonl").read_text().splitlines():
        r=json.loads(line)
        if r["key"] in preds or r.get("error"):
            raise ValueError("Duplicate prediction or image failure")
        p=np.asarray(r["boxes"],float).reshape(-1,5)
        if not np.isfinite(p).all() or (len(p)>1 and np.any(np.diff(p[:,4])>0)):
            raise ValueError("Invalid or unsorted predictions")
        preds[r["key"]]=r
    if set(preds)!=set(r["key"] for r in records):
        raise ValueError(f"Incomplete size={size}: {len(preds)}/{len(records)} images")
    return preds,meta


def export_predictions(preds,name):
    folder=WORK/"official_predictions"/name
    for key,row in preds.items():
        path=folder/(key+".txt")
        path.parent.mkdir(parents=True,exist_ok=True)
        boxes=np.asarray(row["boxes"],float).reshape(-1,5)
        lines=[key+".jpg",str(len(boxes))]
        lines.extend(f"{b[0]:.8f} {b[1]:.8f} {b[2]-b[0]:.8f} {b[3]-b[1]:.8f} {b[4]:.10f}" for b in boxes)
        path.write_text("\n".join(lines)+"\n",encoding="utf-8")


def failure_audit(rows,threshold):
    output=[]
    for row in rows:
        rec=row["rec"]
        # Detailed per-image matched/missed/unmatched counts support overlay selection.
        accepted=row["scores"]>=threshold
        fp_mask=accepted&row["fp"]
        result=dict(key=row["key"],crowd=row["crowd"],eligible_faces=int(row["eligible"].sum()),
                    detected=int((accepted&row["tp"]).sum()),unmatched=int(fp_mask.sum()),
                    latency_ms=row["latency_ms"])
        result["missed"]=result["eligible_faces"]-result["detected"]
        if fp_mask.any():
            # Reconstruct original cached predictions, which are retained on the record.
            pred=row["pred"][fp_mask]
            ov=overlap(pred,rec["boxes"])
            maxima=ov.max(axis=1) if ov.shape[1] else np.zeros(len(pred))
            result["unmatched_iou_0_to_0p1"]=int((maxima<.1).sum())
            result["unmatched_iou_0p1_to_0p5"]=int(((maxima>=.1)&(maxima<.5)).sum())
            result["duplicate_or_other"]=int((maxima>=.5).sum())
        else:
            result.update(unmatched_iou_0_to_0p1=0,unmatched_iou_0p1_to_0p5=0,duplicate_or_other=0)
        output.append(result)
    return output


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=OUTPUT)
    parser.add_argument("--precision-target",type=float,default=.95)
    args=parser.parse_args()
    if not 0<args.precision_target<=1:
        parser.error("Precision target must be in (0,1]")
    args.output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((WORK/"dataset_manifest.json").read_text())
    records=load_truth()
    smoke_keys={json.loads(line)["key"] for line in (WORK/"smoke/1024.jsonl").read_text().splitlines()}
    split,qa_audit=effective_split(manifest,smoke_keys)
    write_csv(args.output/"split_manifest.csv",[dict(**r,evaluation_split=split[r["key"]]) for r in manifest["images"]])
    (args.output/"holdout_qa_exclusion.json").write_text(json.dumps(qa_audit,indent=2),encoding="utf-8")
    caches={};metadata={};raw={};grid=[]
    # Only DEVELOPMENT operating-point metrics are calculated until selection is saved.
    for size in SIZES:
        preds,meta=read_predictions(size,records)
        raw[size],metadata[size]=preds,meta
        rows=[]
        for rec in records:
            if split[rec["key"]]!="development":
                continue
            row=operating_record(rec,preds[rec["key"]])
            row["pred"]=np.asarray(preds[rec["key"]]["boxes"],float).reshape(-1,5)
            row["split"]=split[rec["key"]]
            rows.append(row)
        caches[size]=rows
        dev=[r for r in rows if r["split"]=="development"]
        for threshold in THRESHOLDS:
            grid.append(dict(size=size,threshold=threshold,**summarize(dev,threshold)))
        print(f"Development grid computed at size {size}",flush=True)
    write_csv(args.output/"development_grid.csv",grid)
    chosen=choose_configuration(grid,args.precision_target)
    selection=dict(precision_target=args.precision_target,baseline=dict(size=1024,threshold=.35),
                   sizes=SIZES,thresholds=THRESHOLDS,
                   selection_rule="Max development recall subject to precision target; ties by lower median latency, higher precision, higher threshold",
                   selected_configuration=dict(size=chosen["size"],threshold=chosen["threshold"]) if chosen else None,
                   target_met=chosen is not None,selection_data="development only",
                   holdout_audit=qa_audit,
                   dataset_manifest_sha256=sha256(WORK/"dataset_manifest.json"),model_sha256=sha256(MODEL),
                   statement="No deployment recommendation; evaluation configuration only")
    if chosen is None:
        # Predeclared fallback is for diagnosis, not an alternative passing recommendation.
        exploratory=max(grid,key=lambda r:(r["f1"],r["precision"],-r["median_ms"]))
        selection["exploratory_configuration"]=dict(size=exploratory["size"],threshold=exploratory["threshold"])
        selection["fallback_reason"]="No grid setting met precision target. Compare highest development F1 for diagnosis only."
        candidate=selection["exploratory_configuration"]
    else:
        candidate=selection["selected_configuration"]
    # Freeze before accessing holdout metrics.
    selection_path=args.output/"selection.json"
    serialized=json.dumps(selection,indent=2)
    if selection_path.exists() and json.loads(selection_path.read_text())!=selection:
        raise ValueError("Selection changed after freeze; use a new output folder and label it exploratory")
    selection_path.write_text(serialized,encoding="utf-8")
    configs=[("baseline",1024,.35),("selected" if chosen else "exploratory",candidate["size"],candidate["threshold"])]
    comparison=[];ap_rows=[];curves={};group_rows=[]
    for label,size,threshold in configs:
        rows=caches[size]
        if len(rows)<len(records):
            for rec in records:
                if split[rec["key"]]=="development":
                    continue
                row=operating_record(rec,raw[size][rec["key"]])
                row["pred"]=np.asarray(raw[size][rec["key"]]["boxes"],float).reshape(-1,5)
                row["split"]=split[rec["key"]]
                rows.append(row)
        hold=[r for r in rows if r["split"]=="holdout"]
        full=summarize(rows,threshold);held=summarize(hold,threshold)
        zero=[r for r in hold if not r["eligible"].any()]
        nonzero=[r for r in hold if r["eligible"].any()]
        result=dict(configuration=dict(size=size,threshold=threshold),full_validation=full,
                    holdout=held,holdout_excluding_zero_eligible_photos=summarize(nonzero,threshold),
                    zero_eligible_photos=dict(images=len(zero),unmatched_predictions=summarize(zero,threshold)["false_positives"]))
        (args.output/f"{label}_metrics.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
        comparison.append(dict(policy=label,size=size,threshold=threshold,**held))
        for crowd in ("0","1","2-5","6-20","21+"):
            sub=[r for r in hold if r["crowd"]==crowd]
            if sub:group_rows.append(dict(policy=label,crowd=crowd,**summarize(sub,threshold)))
        for attribute in ("size","occlusion","blur","pose"):
            write_csv(args.output/f"{label}_{attribute}_recall.csv",breakdown(hold,threshold,attribute))
        write_csv(args.output/f"{label}_holdout_images.csv",failure_audit(hold,threshold))
        for subset in ("easy","medium","hard"):
            metric,curve=official_protocol_ap(records,raw[size],subset)
            ap_rows.append(dict(policy=label,size=size,subset=subset,**metric))
            curves[f"{label}_{subset}"]=curve
            write_csv(args.output/f"{label}_{subset}_pr.csv",[dict(recall=float(r),precision=float(p)) for r,p in curve])
            print(f"{label} {subset} protocol-port AP={metric['ap']:.4f}",flush=True)
        export_predictions(raw[size],f"{label}_{size}")
    write_csv(args.output/"configuration_comparison.csv",comparison)
    write_csv(args.output/"crowd_count_metrics.csv",group_rows)
    write_csv(args.output/"full_validation_ap.csv",ap_rows)
    reproducibility=dict(created_utc=datetime.now(timezone.utc).isoformat(),
                         model_source=dict(repository="fal/AuraFace-v1",revision="af6d057",filename=MODEL.name,sha256=sha256(MODEL)),
                         manifest={k:v for k,v in manifest.items() if k!="images"},
                         prediction_metadata={str(k):v for k,v in metadata.items()},
                         evaluation_script_sha256=sha256(__file__),metrics_script_sha256=sha256(Path(__file__).with_name("widerface_metrics.py")),
                         predictions_sha256={str(s):sha256(WORK/f"predictions/{s}.jsonl") for s in SIZES},
                         failures=0,custom_gt="official Hard subset intersect invalid==0 and positive width/height",
                         ap_evaluator="NumPy port of supplied MATLAB: official masks, inclusive IoU 0.5, global score normalization, 1000 thresholds, VOC precision envelope",
                         ap_limit="Predictions truncated at raw score floor 0.02; not an independent official-server or MATLAB execution",
                         timing_limit="Cache timings at floor 0.02 shared across thresholds; exclude embeddings, redaction, cloud; no exact deployed-threshold latency claim")
    reproducibility["timing_caution"]="Single CPU passes at different times; host load and CPU speed varied. No controlled repeatability claim."
    reproducibility["box_convention"]="Floating detector boxes; application-specific integer clipping and downstream embedding checks are not included."
    reproducibility["holdout_qa_audit"]=qa_audit
    (args.output/"reproducibility.json").write_text(json.dumps(reproducibility,indent=2),encoding="utf-8")
    plots(args.output,grid,comparison,ap_rows,curves,group_rows)
    overlays(args.output,configs,caches,raw)
    report(args.output,selection,comparison,ap_rows,manifest)
    print(json.dumps(dict(selection=selection,holdout=comparison),indent=2),flush=True)
    print(f"Completed: {args.output}",flush=True)


def plots(output,grid,comparison,ap_rows,curves,groups):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.size":11,"axes.spines.top":False,"axes.spines.right":False})
    colors=["#64748b","#0f766e"]
    fig,axes=plt.subplots(1,3,figsize=(15,4.8))
    for j,subset in enumerate(("easy","medium","hard")):
        for color,row in zip(colors,comparison):
            label=row["policy"];curve=curves[f"{label}_{subset}"]
            ap=next(r["ap"] for r in ap_rows if r["policy"]==label and r["subset"]==subset)
            axes[j].plot(curve[:,0],curve[:,1],color=color,label=f"{label} AP {ap:.3f}")
        axes[j].set(title=subset.title(),xlabel="Recall",ylabel="Precision",xlim=(0,1),ylim=(0,1.02));axes[j].legend();axes[j].grid(alpha=.2)
    fig.suptitle("Full-validation detection PR: WIDER MATLAB-protocol port (score floor 0.02)")
    fig.tight_layout();fig.savefig(output/"precision_recall.png",dpi=170);plt.close(fig)
    fig,ax=plt.subplots(figsize=(8,5))
    for size,color in zip(SIZES,("#2563eb","#0f766e","#c2410c")):
        data=[r for r in grid if r["size"]==size]
        for j,r in enumerate(data):
            ax.scatter(r["median_ms"],100*r["recall"],color=color,label=str(size) if j==0 else None,
                       marker="o" if r["precision"]>=.95 else "x",s=65)
            ax.annotate(f"{r['threshold']:.2f}",(r["median_ms"],100*r["recall"]),xytext=(5,2),textcoords="offset points",fontsize=8)
    ax.set(xlabel="Median cached detector latency (ms; score floor 0.02)",ylabel="Development recall (%)",title="Circles meet 95% precision; crosses do not\nLabels are confidence cutoffs");ax.legend(title="Input size");ax.grid(alpha=.2)
    fig.tight_layout();fig.savefig(output/"recall_vs_latency.png",dpi=170);plt.close(fig)
    for attribute,filename,title in [("size","missed_faces_by_size.png","Holdout misses by original face height"),("occlusion","occlusion_recall.png","Holdout recall by occlusion (0 none, 1 partial, 2 heavy)")]:
        import csv
        data=[]
        for row in comparison:
            with (output/f"{row['policy']}_{attribute}_recall.csv").open() as stream:data.append(list(csv.DictReader(stream)))
        names=[r["group"] for r in data[0]]
        if attribute=="size":names=[n for n in ("<32 px","32-95 px",">=96 px") if n in names]
        fig,ax=plt.subplots(figsize=(9,5));x=np.arange(len(names))
        for i,(d,row,color) in enumerate(zip(data,comparison,colors)):
            lookup={r["group"]:r for r in d}
            vals=[int(lookup[n]["missed"]) if attribute=="size" else 100*float(lookup[n]["recall"]) for n in names]
            bars=ax.bar(x+(i-.5)*.36,vals,width=.36,color=color,label=row["policy"])
            ax.bar_label(bars,fmt="%.0f" if attribute=="size" else "%.1f",padding=3)
        ax.set(xticks=x,xticklabels=names,title=title,ylabel="Missed eligible faces" if attribute=="size" else "Recall (%)");ax.legend();ax.margins(y=.18)
        fig.tight_layout();fig.savefig(output/filename,dpi=170);plt.close(fig)
    fig,axes=plt.subplots(1,2,figsize=(12,5));names=["1","2-5","6-20","21+"];x=np.arange(4)
    for i,(row,color) in enumerate(zip(comparison,colors)):
        lookup={r["crowd"]:r for r in groups if r["policy"]==row["policy"]}
        for ax,key in zip(axes,("recall","complete_photo_rate")):
            vals=[100*lookup[n][key] if n in lookup else 0 for n in names]
            bars=ax.bar(x+(i-.5)*.36,vals,width=.36,color=color,label=row["policy"]);ax.bar_label(bars,fmt="%.1f",padding=3)
            ax.set(xticks=x,xticklabels=names,ylim=(0,110),xlabel="Valid annotated faces per photo",ylabel="Percent");ax.legend()
    axes[0].set_title("Holdout face recall");axes[1].set_title("Every eligible face found in a photo")
    fig.tight_layout();fig.savefig(output/"complete_photo_detection.png",dpi=170);plt.close(fig)


def overlays(output,configs,caches,raw):
    import cv2
    from PIL import Image,ImageDraw,ImageFont
    try:font=ImageFont.truetype("C:/Windows/Fonts/arial.ttf",20)
    except OSError:font=ImageFont.load_default()
    folder=output/"example_overlays";folder.mkdir(exist_ok=True)
    baseline=[r for r in caches[1024] if r["split"]=="holdout"]
    # Examples are illustrative diagnostics, not a hand-picked evaluation subset.
    picks=[]
    for crowd in ("1","2-5","6-20","21+"):
        pool=[r for r in baseline if r["crowd"]==crowd]
        if pool:picks.append(max(pool,key=lambda r:int(r["eligible"].sum())-int(((r["scores"]>=.35)&r["tp"]).sum())))
    for i,record in enumerate(picks):
        rgb=cv2.cvtColor(cv2.imread(str(DATA/"WIDER_val/images"/(record["key"]+".jpg"))),cv2.COLOR_BGR2RGB)
        image=Image.fromarray(rgb)
        panels=[]
        for label,size,threshold in configs:
            panel=image.copy();draw=ImageDraw.Draw(panel)
            for box,eligible in zip(record["rec"]["boxes"],record["eligible"]):
                if eligible:draw.rectangle((box[0],box[1],box[0]+box[2],box[1]+box[3]),outline="#22c55e",width=2)
            for b in raw[size][record["key"]]["boxes"]:
                if b[4]>=threshold:draw.rectangle(b[:4],outline="#ef4444",width=1)
            panel.thumbnail((1000,750));canvas=Image.new("RGB",(1000,800),"white");canvas.paste(panel,(0,45))
            d=ImageDraw.Draw(canvas);d.text((10,10),f"{label}: {size}, cutoff {threshold:.2f}; GT green, detections red",fill="black",font=font)
            panels.append(canvas)
        combined=Image.new("RGB",(2000,800),"white");combined.paste(panels[0],(0,0));combined.paste(panels[1],(1000,0))
        combined.save(folder/f"{i+1}_{record['crowd'].replace('+','plus')}.png")


def report(output,selection,comparison,ap_rows,manifest):
    lines=["# WIDER FACE group-photo detection benchmark","",
           f"Validated {manifest['photos']:,} photos. Final analysis: {manifest['development_images']:,} development / {selection['holdout_audit']['final_holdout_images']:,} untouched holdout / {selection['holdout_audit']['excluded_smoke_related_images']:,} smoke-related QA exclusions.","",
           "The original grouped split had 643 holdout photos. The 50-image smoke sample included 12 of them. Before candidate selection or final holdout scoring, we excluded all 353 held-out photos sharing a frozen scene/dHash group with the smoke sample, leaving 290 untouched holdout photos. Development membership and the precision target did not change. This reduces test coverage; the final holdout should not be treated as representative of all WIDER events.","",
           "This evaluates face detection, not identity recognition. The app's configuration is unchanged.","",
           f"Development selection: maximize recall with precision >= {selection['precision_target']:.0%}. Target met: **{selection['target_met']}**."]
    if not selection["target_met"]:lines += ["",selection["fallback_reason"],"The exploratory comparison below is not a passing recommendation."]
    lines += ["","## Frozen holdout comparison","","| Configuration | Input / cutoff | Recall | Precision | Missed faces | Unmatched detections | Complete photos | Median / p95 ms* |",
              "|---|---|---:|---:|---:|---:|---:|---:|"]
    for r in comparison:lines.append(f"| {r['policy']} | {r['size']} / {r['threshold']:.2f} | {r['recall']:.2%} | {r['precision']:.2%} | {r['false_negatives']} | {r['false_positives']} | {r['complete_photo_rate']:.2%} | {r['median_ms']:.1f} / {r['p95_ms']:.1f} |")
    before,after=comparison
    lines += ["",f"Holdout change: recall {(after['recall']-before['recall'])*100:+.2f} percentage points; "
              f"precision {(after['precision']-before['precision'])*100:+.2f} percentage points; "
              f"missed faces {after['false_negatives']-before['false_negatives']:+d}; "
              f"unmatched detections {after['false_positives']-before['false_positives']:+d}."]
    if after['recall']<before['recall']:
        lines += ["", "The precision-constrained choice misses MORE eligible faces than the original setting. "
                  "It is a precision/recall tradeoff, not an overall improvement or evidence of redaction readiness. "
                  "A privacy-focused product needs a separately specified miss tolerance and further validation."]
    lines += ["","*Timing includes JPEG decode and detection at a shared 0.02 candidate floor, before filtering scores to each cutoff. It excludes embeddings, cloud, redaction and startup. Confidence changes share cached timings, not newly measured production latency.","",
              "## Full-validation AP (protocol port)","","| Configuration | Easy AP | Medium AP | Hard AP |","|---|---:|---:|---:|"]
    for r in comparison:
        vals={a["subset"]:a["ap"] for a in ap_rows if a["policy"]==r["policy"]}
        lines.append(f"| {r['policy']} | {vals['easy']:.4f} | {vals['medium']:.4f} | {vals['hard']:.4f} |")
    lines += ["","AP uses official difficulty masks, inclusive IoU 0.5, global min/max score normalization, 1,000 thresholds and the VOC precision envelope, via a NumPy port tested against an independent scalar reference. This is not an official-server submission or a MATLAB execution. Predictions below raw confidence 0.02 are absent. AP is computed from low-floor ranked predictions, not only detections above the selected operating cutoff. Full-validation AP after tuning is descriptive; the holdout comparison is the selection-independent result.","",
              "## Operational scoring and limitations","",
              "- Custom metrics use continuous IoU >=0.5 against positive-area, invalid==0 annotations inside the official Hard mask. Other GT boxes are ignored; duplicate detections count as unmatched.",
              "- Crowd count uses all valid annotated faces; complete-photo rate only includes photos with eligible faces. It is not a guarantee that every real person was found.",
              "- Zero-size placeholder annotations occur. Metrics excluding zero-eligible photos are saved separately; predictions without a matching annotation are scored unmatched, not human-confirmed hallucinations.",
              f"- Original annotations contain {manifest['nonpositive_original_boxes']} nonpositive boxes and {len(manifest['txt_mat_coordinate_differences'])} TXT/MAT discrepancy. MAT coordinates/masks are authoritative for AP; invalid geometry is excluded from custom metrics.",
              "- Scene-prefix and dHash grouping reduce duplicate leakage but cannot establish identity-disjoint or fully independent event splits.",
              "- SCRFD is commonly benchmarked/trained on WIDER FACE; the exact pinned checkpoint's image-level training overlap has not been independently established.",
              "- Failed inference aborts the run rather than silently omitting difficult photos. All 3,226 predictions per resolution are required.",
              "- The LFW 0.234 recognition threshold and gallery margin are not used or tuned here.","",
              "## Files and reproduction","",
              "See docs/widerface_benchmark.md. development_grid.csv records all 15 candidates; selection.json freezes the rule and candidate before holdout scoring. configuration_comparison.csv and the per-image/crowd/size/occlusion tables support tracking. Dataset/model/prediction hashes and versions are in reproducibility.json. Official-format prediction text is under data/benchmarks/widerface/official_predictions/ for independent MATLAB reevaluation.",""]
    (output/"report.md").write_text("\n".join(lines),encoding="utf-8")


if __name__=="__main__":
    main()
