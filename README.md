# DS210_Capstone

### Scripts

## Data - download, filter & transform

**`download_data.py`** - Downloads the dataset from Kaggle via kagglehub, flattens into data/raw/{casia-webface,eval}/. If already downloaded, skips re-download unless --force. The training datasedt is in the casia folder while the eval contains the evaultion metrics


## Quickstart

### Data - download, filter & transform

```bash
uv run scripts/download_data.py
```