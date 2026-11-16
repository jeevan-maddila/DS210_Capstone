import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src/scripts"))
from widerface_metrics import overlap,match,voc_ap,official_protocol_ap
from evaluate_widerface import choose_configuration,effective_split


class DetectionTests(unittest.TestCase):
    def test_smoke_related_holdout_groups_excluded_without_changing_development(self):
        manifest=dict(holdout_images=3,images=[dict(key='dev',group=1,split='development'),
                      dict(key='smoke',group=2,split='holdout'),dict(key='related',group=2,split='holdout'),
                      dict(key='untouched',group=3,split='holdout')])
        split,audit=effective_split(manifest,{'smoke','dev'})
        self.assertEqual(split,dict(dev='development',smoke='smoke_excluded',related='smoke_excluded',untouched='holdout'))
        self.assertEqual(audit['final_holdout_images'],1)
        self.assertEqual(audit['excluded_smoke_related_images'],2)

    def test_duplicate_and_ignored_predictions(self):
        gt=np.array([[0,0,10,10],[20,20,10,10]],float)
        pred=np.array([[0,0,10,10,.9],[0,0,10,10,.8],[20,20,30,30,.7],[40,40,50,50,.6]])
        tp,fp,idx=match(pred,gt,np.array([True,False]))
        np.testing.assert_array_equal(tp,[True,False,False,False])
        np.testing.assert_array_equal(fp,[False,True,False,True])
        np.testing.assert_array_equal(idx,[0,-1,-1,-1])

    def test_iou_against_independent_scalar_reference(self):
        rng=np.random.default_rng(42)
        boxes=rng.uniform(0,30,(20,4));boxes[:,2:]+=1
        pred=rng.uniform(0,30,(15,5));pred[:,2:4]+=pred[:,:2]+1
        for inclusive in (False,True):
            actual=overlap(pred,boxes,inclusive)
            for i,a in enumerate(pred):
                for j,g in enumerate(boxes):
                    d=int(inclusive)
                    width=max(0,min(a[2],g[0]+g[2])-max(a[0],g[0])+d)
                    height=max(0,min(a[3],g[1]+g[3])-max(a[1],g[1])+d)
                    inter=width*height
                    expected=inter/((a[2]-a[0]+d)*(a[3]-a[1]+d)+(g[2]+d)*(g[3]+d)-inter)
                    self.assertAlmostEqual(actual[i,j],expected)

    def test_protocol_ap_false_detection_before_two_true_detections(self):
        rec=dict(key="a",boxes=np.array([[0,0,10,10],[30,30,10,10]]),masks={"easy":np.array([True,True])})
        pred={"a":dict(boxes=[[60,60,70,70,.99],[0,0,10,10,.9],[30,30,40,40,.8]])}
        metric,_=official_protocol_ap([rec],pred,"easy")
        self.assertAlmostEqual(metric["ap"],2/3)

    def test_protocol_ignored_detection_does_not_hurt_ap(self):
        rec=dict(key="a",boxes=np.array([[0,0,10,10],[30,30,10,10]]),masks={"hard":np.array([False,True])})
        pred={"a":dict(boxes=[[0,0,10,10,.9],[30,30,40,40,.8]])}
        metric,_=official_protocol_ap([rec],pred,"hard")
        self.assertAlmostEqual(metric["ap"],1)

    def test_no_detection_is_zero_ap(self):
        rec=dict(key="a",boxes=np.array([[0,0,10,10]]),masks={"hard":np.array([True])})
        metric,_=official_protocol_ap([rec],{"a":dict(boxes=[])},"hard")
        self.assertEqual(metric["ap"],0)

    def test_ap_matches_independent_literal_protocol_reference(self):
        # Deliberately scalar: no calls to production overlap/match/voc_ap.
        gt=np.array([[0,0,10,10],[30,30,10,10],[60,60,10,10]],float)
        predictions=np.array([[0,0,10,10,.99],[85,85,95,95,.95],
                              [30,30,40,40,.9],[0,0,10,10,.85],[60,60,70,70,.8]])
        eligible=np.array([True,False,True])
        recalled=set();proposals=[];recalls=[]
        for pred in predictions:
            ious=[]
            for box in gt:
                w=min(box[0]+box[2],pred[2])-max(box[0],pred[0])+1
                h=min(box[1]+box[3],pred[3])-max(box[1],pred[1])+1
                inter=max(w,0)*max(h,0)
                a=(box[2]+1)*(box[3]+1)
                b=(pred[2]-pred[0]+1)*(pred[3]-pred[1]+1)
                ious.append(inter/(a+b-inter))
            j=int(np.argmax(ious));proposal=1
            if ious[j]>=.5:
                if not eligible[j]:proposal=0
                else:recalled.add(j)
            proposals.append(proposal);recalls.append(len(recalled))
        normalized=(predictions[:,4]-.8)/(.99-.8)
        precision=[];recall=[]
        for t in range(1,1001):
            accepted=[i for i,s in enumerate(normalized) if s>=1-t/1000]
            if not accepted:precision.append(0);recall.append(0);continue
            k=accepted[-1];count=sum(proposals[:k+1])
            precision.append(recalls[k]/count if count else 0)
            recall.append(recalls[k]/int(eligible.sum()))
        rr=[0]+recall+[1];pp=[0]+precision+[0]
        for i in range(len(pp)-2,-1,-1):pp[i]=max(pp[i],pp[i+1])
        expected=sum((rr[i]-rr[i-1])*pp[i] for i in range(1,len(rr)) if rr[i]!=rr[i-1])
        rec=dict(key="a",boxes=gt,masks={"hard":eligible})
        actual,curve=official_protocol_ap([rec],{"a":dict(boxes=predictions.tolist())},"hard")
        self.assertAlmostEqual(actual["ap"],expected)
        np.testing.assert_allclose(curve,np.column_stack([recall,precision]))

    def test_selection_precision_constraint_and_no_feasible_candidate(self):
        rows=[dict(size=640,threshold=.35,precision=.94,recall=.99,median_ms=50),
              dict(size=1024,threshold=.45,precision=.96,recall=.8,median_ms=100)]
        self.assertEqual(choose_configuration(rows)["size"],1024)
        self.assertIsNone(choose_configuration(rows,.99))


if __name__=="__main__":
    unittest.main()
