# DS210_Capstone

### Scripts

## Data - download, filter & transform

**`download_data.py`** - Downloads the dataset from Kaggle via kagglehub, flattens into data/raw/{casia-webface,eval}/. If already downloaded, skips re-download unless --force. The training datasedt is in the casia folder while the eval contains the evaultion metrics


## Quickstart

### Data - download, filter & transform

```bash
uv run scripts/download_data.py
```

## LFW recognition benchmark

See [the benchmark guide](docs/lfw_benchmark.md) for the AuraFace CPU baseline,
metric definitions, reproducibility details, and comparisons between runs.
Open `notebooks/lfw_baseline.ipynb` to inspect saved results.

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-benchmark.txt
& .venv/Scripts/python.exe src/scripts/benchmark_lfw.py --output data/benchmarks/my_run
```

## WIDER FACE group-photo detection benchmark

### Download and install the dataset

Datasets and generated benchmark outputs stay local: `/data/` and `/reports/`
are excluded from Git. Each contributor downloads their own copy.

1. Open the [official WIDER FACE download page](https://mmlab.ie.cuhk.edu.hk/projects/WIDERFace/index.html).
   Download **WIDER Face Validation Images** (`WIDER_val.zip`) and the
   **Face annotations** archive (`wider_face_split.zip`). This benchmark uses
   the validation split; training and test images are not required.
2. Download the evaluation tools (`eval_tools.zip`) using the evaluation-code
   link on the official page. These include the Easy, Medium, and Hard MATLAB
   ground-truth files required by our Python evaluator; MATLAB is not needed.
3. Put the three ZIP archives in `data/raw/widerface/`, then extract them from
   the repository root in PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force data/raw/widerface | Out-Null
   Expand-Archive data/raw/widerface/WIDER_val.zip -DestinationPath data/raw/widerface
   Expand-Archive data/raw/widerface/wider_face_split.zip -DestinationPath data/raw/widerface
   Expand-Archive data/raw/widerface/eval_tools.zip -DestinationPath data/raw/widerface
   ```

   The extracted layout must be:

   ```text
   data/raw/widerface/
   ├── WIDER_val/images/<event>/<photo>.jpg
   ├── wider_face_split/wider_face_val_bbx_gt.txt
   └── eval_tools/ground_truth/
       ├── wider_face_val.mat
       ├── wider_easy_val.mat
       ├── wider_medium_val.mat
       └── wider_hard_val.mat
   ```

   Avoid an extra nested archive-name folder, such as `WIDER_val/WIDER_val/`.
4. Install the benchmark dependencies and validate the dataset:

   ```powershell
   uv sync
   uv pip install --python .venv/Scripts/python.exe -r requirements-widerface.txt
   & .venv/Scripts/python.exe src/scripts/widerface_data.py
   ```

   Validation checks the 3,226 photos and annotations and creates a local
   dataset manifest under `data/benchmarks/widerface/`.

### Run the benchmark

See [the WIDER FACE benchmark guide](docs/widerface_benchmark.md) for the
dataset layout, baseline, development tuning, grouped holdout and metric limits.
The complete workflow resumes cached predictions automatically:

```powershell
& .venv/Scripts/python.exe src/scripts/benchmark_widerface.py
```

Results are saved under `reports/widerface/` and can be inspected in
`notebooks/widerface_benchmark.ipynb`. This evaluates detection, not identity
recognition or full redaction correctness.
