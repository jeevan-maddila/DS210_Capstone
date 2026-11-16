"""Resume all WIDER detection runs and evaluate the frozen development/holdout study."""
import argparse
import json
import subprocess
import sys

from benchmark_lfw import ROOT
from widerface_data import WORK,prepare


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evaluate-only",action="store_true",help="Require complete cached predictions at all three resolutions")
    args=parser.parse_args()
    prepare()
    plan=dict(baseline=dict(size=1024,threshold=.35),
              sizes=[640,1024,1280],thresholds=[.15,.25,.35,.45,.55],
              development_precision_target=.95,
              selection="Max development recall subject to precision >=0.95; tie by latency then precision then cutoff",
              if_infeasible="No passing recommendation. Highest development F1 compared on holdout as exploratory diagnosis only.",
              nms=.4,candidate_floor=.02,threads=4,
              holdout="Original grouped 643-image holdout; smoke-related groups excluded before final scoring; only candidate and baseline compared",
              ap="NumPy port of supplied MATLAB protocol, all validation; predictions exported for independent MATLAB evaluation")
    path=WORK/"experiment_plan.json"
    if path.exists() and json.loads(path.read_text())!=plan:
        previous=json.loads(path.read_text())
        original=dict(plan,holdout="Frozen grouped 643-image holdout; only selected and unchanged baseline evaluated")
        if previous!=original:
            raise ValueError("Experiment plan changed")
        # Preserve the original plan and document the QA-only holdout correction.
        (WORK/"experiment_plan_initial.json").write_text(json.dumps(previous,indent=2),encoding="utf-8")
    path.write_text(json.dumps(plan,indent=2),encoding="utf-8")
    scripts=ROOT/"src/scripts"
    if not args.evaluate_only:
        for size in plan["sizes"]:
            subprocess.run([sys.executable,str(scripts/"infer_widerface.py"),"--size",str(size)],cwd=ROOT,check=True)
    subprocess.run([sys.executable,str(scripts/"evaluate_widerface.py")],cwd=ROOT,check=True)


if __name__=="__main__":
    main()
