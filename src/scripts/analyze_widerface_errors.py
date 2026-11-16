"""Inspect frozen holdout errors; descriptive diagnostics, not further tuning."""
import csv
import json
from pathlib import Path

import cv2
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

from benchmark_lfw import ROOT,write_csv
from widerface_data import DATA,WORK,load_truth
from widerface_metrics import operating_record,overlap


def diagnose(row,gt_index,threshold):
    matched=np.flatnonzero(row['tp'] & (row['indices']==gt_index))
    if len(matched):
        k=int(matched[0]);score=float(row['scores'][k])
        return ('detected' if score>=threshold else 'confidence_filtered'),score,k
    candidates=row['overlap'][:,gt_index]
    if len(candidates):
        best=int(candidates.argmax());iou=float(candidates[best])
        if iou>=.5:return 'assignment_or_ignored_competition',float(row['scores'][best]),best
        if iou>=.1:return 'poor_box_alignment',float(row['scores'][best]),best
    return 'no_overlapping_cached_candidate',None,None


def main():
    output=ROOT/'reports/widerface/error_analysis';output.mkdir(parents=True,exist_ok=True)
    results=ROOT/'reports/widerface'
    with (results/'split_manifest.csv').open() as f:
        held={r['key'] for r in csv.DictReader(f) if r['evaluation_split']=='holdout'}
    truth={r['key']:r for r in load_truth() if r['key'] in held}
    rows={}
    for size in (640,1024,1280):
        rows[size]={}
        with (WORK/f'predictions/{size}.jsonl').open() as f:
            for line in f:
                pred=json.loads(line)
                if pred['key'] not in held:continue
                rec=truth[pred['key']];row=operating_record(rec,pred)
                row['pred']=np.asarray(pred['boxes'],float).reshape(-1,5)
                row['overlap']=overlap(row['pred'],rec['boxes'])
                rows[size][pred['key']]=row
    missed=[];unmatched=[]
    for size,threshold in ((1024,.35),(1280,.55)):
        for key,row in rows[size].items():
            rec=truth[key]
            for j in np.flatnonzero(row['eligible']):
                reason,score,k=diagnose(row,int(j),threshold)
                if reason=='detected':continue
                box=rec['boxes'][j]
                missed.append(dict(size=size,threshold=threshold,key=key,gt_index=int(j),reason=reason,
                                   candidate_score=score,face_width=float(box[2]),face_height=float(box[3]),
                                   blur=int(rec['flags']['blur'][j]),occlusion=int(rec['flags']['occlusion'][j]),
                                   best_cached_iou=float(row['overlap'][:,j].max()) if len(row['pred']) else 0))
            for k in np.flatnonzero((row['scores']>=threshold)&row['fp']):
                ious=row['overlap'][k];j=int(ious.argmax())
                value=float(ious[j])
                unmatched.append(dict(size=size,threshold=threshold,key=key,pred_index=int(k),
                                      score=float(row['scores'][k]),nearest_gt_index=j,iou=value,
                                      category='near_annotation_but_iou_below_0.5' if .1<=value<.5 else
                                      'duplicate_or_assignment' if value>=.5 else 'no_nearby_annotation'))
    write_csv(output/'missed_faces.csv',missed);write_csv(output/'unmatched_detections.csv',unmatched)
    counts=[]
    for size in (1024,1280):
        for reason in sorted({r['reason'] for r in missed}):
            counts.append(dict(size=size,reason=reason,count=sum(r['size']==size and r['reason']==reason for r in missed)))
    write_csv(output/'failure_categories.csv',counts)
    # Concrete examples chosen from holdout errors, not used for a new configuration choice.
    filtered=[r for r in missed if r['size']==1280 and r['reason']=='confidence_filtered'
              and r['candidate_score']>=.35 and diagnose(rows[1024][r['key']],r['gt_index'],.35)[0]=='detected']
    group_filtered=[r for r in filtered if r['key'].startswith('12--Group/') and r['face_height']<=200]
    threshold_example=max(group_filtered or filtered,key=lambda r:r['face_height'])
    small=[r for r in missed if r['size']==1280 and r['face_height']<20 and r['reason']=='no_overlapping_cached_candidate']
    small_example=max(small,key=lambda r:r['face_height'])
    large=[r for r in missed if r['size']==1024 and r['face_height']>=96 and r['reason']=='no_overlapping_cached_candidate'
           and diagnose(rows[1280][r['key']],r['gt_index'],.55)[0]!='detected']
    large_example=max(large,key=lambda r:r['face_height'])
    near=[r for r in unmatched if r['size']==1024 and .4<=r['iou']<.5
          and rows[1024][r['key']]['eligible'][r['nearest_gt_index']]
          and diagnose(rows[1280][r['key']],r['nearest_gt_index'],.55)[0]=='detected']
    alignment_example=max(near,key=lambda r:r['iou'])
    examples=[dict(kind='Threshold rejects a real face',**threshold_example),
              dict(kind='Small face: no overlapping retained candidate',**small_example),
              dict(kind='Large face: detected at 640, missed at larger inputs',**large_example),
              dict(kind='A face box that fails the overlap requirement',**alignment_example)]
    export=[]
    for number,example in enumerate(examples,1):
        key=example['key'];j=example.get('gt_index',example.get('nearest_gt_index'))
        rec=truth[key];box=rec['boxes'][j]
        image=cv2.cvtColor(cv2.imread(str(DATA/'WIDER_val/images'/(key+'.jpg'))),cv2.COLOR_BGR2RGB)
        h,w=image.shape[:2]
        # Include contextual area but keep the target face legible. Clip crop to photo edges.
        pad=max(30,float(max(box[2:]))*.7)
        x1=max(0,int(box[0]-pad));y1=max(0,int(box[1]-pad))
        x2=min(w,int(box[0]+box[2]+pad));y2=min(h,int(box[1]+box[3]+pad))
        fig,axes=plt.subplots(1,3,figsize=(14,5))
        notes=[]
        panels=[(640,.35),(1024,.35),(1280,.55)] if number==3 else [(1024,.35),(1280,.35),(1280,.55)]
        for ax,(size,threshold) in zip(axes,panels):
            row=rows[size][key]
            reason,score,k=diagnose(row,j,threshold)
            ax.imshow(image[y1:y2,x1:x2]);ax.axis('off')
            ax.add_patch(Rectangle((box[0]-x1,box[1]-y1),box[2],box[3],fill=False,edgecolor='#22c55e',linewidth=2.5))
            # Nearest candidate box is shown even if rejected; text states exact score/status.
            if k is None and len(row['pred']):
                candidate=int(row['overlap'][:,j].argmax())
                if row['overlap'][candidate,j]>=.1:k=candidate;score=float(row['scores'][k])
            if k is not None:
                pred=row['pred'][k]
                ax.add_patch(Rectangle((pred[0]-x1,pred[1]-y1),pred[2]-pred[0],pred[3]-pred[1],fill=False,
                                       edgecolor='#ef4444',linewidth=2,linestyle='-' if score>=threshold else '--'))
                detail=f"score {score:.3f}, IoU {row['overlap'][k,j]:.3f}\n{reason.replace('_',' ')}"
            else:detail=reason.replace('_',' ')
            ax.set_title(f"Input {size}, cutoff {threshold:.2f}\n{detail}",fontsize=10)
            notes.append(dict(size=size,threshold=threshold,reason=reason,score=score,
                              iou=float(row['overlap'][k,j]) if k is not None else None))
        # Matplotlib patches outside axes must not expand the selected crop's view.
        for ax in axes:ax.set_xlim(0,x2-x1);ax.set_ylim(y2-y1,0)
        fig.suptitle(f"{number}. {example['kind']}",fontsize=16,weight='bold')
        fig.text(.5,.01,f"Target GT: green · nearest candidate: red (dashed if below cutoff) · original face {box[2]:.0f}×{box[3]:.0f} px\n{key}",ha='center',fontsize=9)
        fig.tight_layout(rect=(0,.08,1,.9))
        filename=f"{number:02d}_example.png";fig.savefig(output/filename,dpi=170);plt.close(fig)
        export.append(dict(number=number,kind=example['kind'],key=key,gt_index=j,
                           box_xywh=box.tolist(),blur=int(rec['flags']['blur'][j]),
                           occlusion=int(rec['flags']['occlusion'][j]),panels=notes,figure=filename))
    (output/'examples.json').write_text(json.dumps(export,indent=2),encoding='utf-8')
    lines=['# WIDER FACE error inspection','',
           'Descriptive review of the existing holdout results; no model or threshold is changed and these examples are not a new evaluation set.','',
           '| Input / cutoff | Confidence-filtered misses | Poor alignment | No overlapping cached candidate | Assignment/ignored competition |',
           '|---|---:|---:|---:|---:|']
    for size,threshold in [(1024,.35),(1280,.55)]:
        c={r['reason']:r['count'] for r in counts if r['size']==size}
        lines.append(f"| {size} / {threshold} | {c.get('confidence_filtered',0)} | {c.get('poor_box_alignment',0)} | {c.get('no_overlapping_cached_candidate',0)} | {c.get('assignment_or_ignored_competition',0)} |")
    lines+=['','A confidence-filtered miss is proven by an otherwise matchable cached detection below the cutoff. Poor alignment means a candidate overlaps the annotation by IoU 0.1–0.5. No overlapping cached candidate means none reaches IoU 0.1 at the saved 0.02 floor; it does not distinguish absent model response, lower scores, or NMS suppression.','',
            'The 1280/0.35 panel isolates the effect of raising confidence to 0.55 at the same resolution. This diagnostic operating point was not selected using new holdout metrics.','',
            'Small size, blur and occlusion are observable image/annotation properties, not proven internal causes. See examples.json for exact scores, IoUs and annotation flags. The large portrait is detected at input 640 (score 0.666, IoU 0.916), but not at 1024 or 1280. This is direct evidence of resolution-sensitive detector behavior for that photo; the exact internal mechanism is not established. It is a post-hoc diagnostic, not a newly validated multi-scale policy.','']
    for e in export:lines += [f"## {e['number']}. {e['kind']}",'',f"![Example]({e['figure']})",'']
    (output/'report.md').write_text('\n'.join(lines),encoding='utf-8')
    print(json.dumps(dict(categories=counts,examples=export),indent=2))


if __name__=='__main__':main()
