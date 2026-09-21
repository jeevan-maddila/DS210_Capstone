from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import kagglehub


DATASET_SLUG = "debarghamitraroy/casia-webface"
DEFAULT_DEST = Path("data/raw/")
MARKER = ".download_complete"


def download_to(dest: Path, force: bool = False) -> Path:
    dest = dest.resolve()
    dest.mkdir(parents=True, exist_ok=True)

    marker_path = dest / MARKER
    if marker_path.exists() and not force:
        print(f"[skip] Already downloaded (marker exists): {marker_path}")
        return dest

    print(f"[download] {DATASET_SLUG}")
    src = Path(kagglehub.dataset_download(DATASET_SLUG)).resolve()
    print(f"[kagglehub] cache path: {src}")

    if dest.exists():
        for p in dest.iterdir():
            if p.is_dir():
                shutil.rmtree(p)
            else:
                p.unlink()

    for item in src.iterdir():
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target)
        else:
            shutil.copy2(item, target)

    marker_path.write_text(f"source={src}\nslug={DATASET_SLUG}\n", encoding="utf-8")
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", type=Path, default=DEFAULT_DEST, help="Destination folder in repo")
    ap.add_argument("--force", action="store_true", help="Redownload and overwrite dest")
    args = ap.parse_args()

    download_to(args.dest, force=args.force)

if __name__ == "__main__":
    main()