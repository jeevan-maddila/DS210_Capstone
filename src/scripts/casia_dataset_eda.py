"""Exploratory data analysis helpers for the CASIA-WebFace RecordIO files.

The implementation reads the MXNet ``.idx``/``.rec`` format directly, so it
does not require the old MXNet Python package.
"""

from __future__ import annotations

import io
import struct
from pathlib import Path
from typing import Iterable

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image

#Got these values from chatgpt to help fix some errors of not every imaging matching with the label in chronological order.
_RECORD_MAGIC = 0xCED7230A
_IR_HEADER = struct.Struct("<IfQQ")


def load_metadata(root: str | Path) -> pd.DataFrame:
    root = Path(root)
    rows: list[tuple[int, int]] = []
    with (root / "train.rec").open("rb") as record_file:
        with (root / "train.idx").open("r", encoding="ascii") as index_file:
            for line in index_file:
                key_text, offset_text = line.split("\t", maxsplit=1)
                record_id = int(key_text)
                offset = int(offset_text)

                record_file.seek(offset)
                framing = record_file.read(8)
                if len(framing) != 8:
                    raise ValueError(f"Incomplete RecordIO header for record {record_id}")
                magic, _ = struct.unpack("<II", framing)
                if magic != _RECORD_MAGIC:
                    raise ValueError(f"Invalid RecordIO magic number for record {record_id}")

                packed_header = record_file.read(_IR_HEADER.size)
                flag, scalar_label, _, _ = _IR_HEADER.unpack(packed_header)
                if flag == 0:
                    rows.append((record_id, int(scalar_label)))

    return pd.DataFrame(rows, columns=["record_id", "label"]).astype(
        {"record_id": "int64", "label": "int32"}
    )


def dataset_summary(metadata: pd.DataFrame):
    class_sizes = metadata.groupby("label", sort=False).size()
    return pd.Series(
        {
            "images": len(metadata),
            "identities": metadata["label"].nunique(),
            "smallest_class": int(class_sizes.min()),
            "largest_class": int(class_sizes.max()),
            "mean_images_per_identity": float(class_sizes.mean()),
            "median_images_per_identity": float(class_sizes.median()),
        },
        name="CASIA-WebFace",
    )


def plot_class_distribution(metadata: pd.DataFrame, bins: int = 50):
    """Plot how many images are available for each identity."""
    class_sizes = metadata.groupby("label").size()
    fig, ax = plt.subplots(figsize=(9, 4.5))
    ax.hist(class_sizes, bins=bins, color="#3b82f6", edgecolor="white")
    ax.axvline(
        class_sizes.median(),
        color="#d82c2c",
        linestyle="--",
        label=f"Median = {class_sizes.median():.0f}",
    )
    ax.set(
        title="CASIA-WebFace class-size distribution",
        xlabel="Images per identity",
        ylabel="Number of identities",
    )
    ax.legend()
    fig.tight_layout()
    return fig, ax


def _find_offsets(index_path: Path, record_ids: Iterable[int]) -> dict[int, int]:
    wanted = set(int(record_id) for record_id in record_ids)
    offsets: dict[int, int] = {}
    with index_path.open("r", encoding="ascii") as index_file:
        for line in index_file:
            key_text, offset_text = line.split("\t", maxsplit=1)
            key = int(key_text)
            if key in wanted:
                offsets[key] = int(offset_text)
                if len(offsets) == len(wanted):
                    break

    missing = wanted.difference(offsets)
    if missing:
        preview = sorted(missing)[:5]
        raise KeyError(f"Record IDs not found in index: {preview}")
    return offsets


#Get general info from docs, but had chatGPT help me with getting the exact syntax.
def read_image(record_file, offset: int) -> tuple[Image.Image, int]:
    record_file.seek(offset)
    record_header = record_file.read(8)
    if len(record_header) != 8:
        raise ValueError(f"Incomplete RecordIO header at byte offset {offset}")

    magic, encoded_length = struct.unpack("<II", record_header)
    if magic != _RECORD_MAGIC:
        raise ValueError(f"Unexpected RecordIO magic number at byte offset {offset}")

    continuation_flag = encoded_length >> 29
    payload_length = encoded_length & ((1 << 29) - 1)
    if continuation_flag:
        raise ValueError("Fragmented RecordIO records are not supported")

    payload = record_file.read(payload_length)
    if len(payload) != payload_length:
        raise ValueError(f"Incomplete RecordIO payload at byte offset {offset}")

    flag, scalar_label, _, _ = _IR_HEADER.unpack_from(payload)
    image_start = _IR_HEADER.size
    if flag > 0:
        labels = np.frombuffer(payload, dtype="<f4", count=flag, offset=image_start)
        label = int(labels[0])
        image_start += flag * 4
    else:
        label = int(scalar_label)

    image = Image.open(io.BytesIO(payload[image_start:])).convert("RGB")
    return image, label

#Get general info from docs, but had chatGPT help me with getting the exact syntax.
def show_class_samples(
    root: str | Path,
    metadata: pd.DataFrame | None = None,
    *,
    labels: Iterable[int] | None = None,
    n_classes: int = 6,
    images_per_class: int = 4,
    seed: int = 42,
):
    """Display several images from selected or randomly sampled identities.

    Pass ``labels=[0, 1, 2]`` to inspect exact identities. When labels is None,
    identities with at least ``images_per_class`` images are sampled randomly.
    """
    root = Path(root)
    if metadata is None:
        metadata = load_metadata(root)

    rng = np.random.default_rng(seed)
    if labels is None:
        class_sizes = metadata.groupby("label").size()
        eligible = class_sizes[class_sizes >= images_per_class].index.to_numpy()
        if n_classes > len(eligible):
            raise ValueError(f"Requested {n_classes} classes, but only {len(eligible)} qualify")
        selected_labels = rng.choice(eligible, size=n_classes, replace=False).tolist()
    else:
        selected_labels = [int(label) for label in labels]
        if not selected_labels:
            raise ValueError("labels must contain at least one identity")

    selected_rows = []
    for label in selected_labels:
        class_rows = metadata.loc[metadata["label"] == label]
        if class_rows.empty:
            raise KeyError(f"Identity label {label} is not present")
        sample_size = min(images_per_class, len(class_rows))
        chosen = rng.choice(class_rows.index.to_numpy(), size=sample_size, replace=False)
        selected_rows.extend(class_rows.loc[chosen].to_dict("records"))

    offsets = _find_offsets(
        root / "train.idx", (row["record_id"] for row in selected_rows)
    )
    images: dict[int, tuple[Image.Image, int]] = {}
    with (root / "train.rec").open("rb") as record_file:
        for row in selected_rows:
            record_id = int(row["record_id"])
            images[record_id] = read_image(record_file, offsets[record_id])

    fig, axes = plt.subplots(
        len(selected_labels),
        images_per_class,
        figsize=(2.25 * images_per_class, 2.25 * len(selected_labels)),
        squeeze=False,
    )
    rows_by_label = {
        label: [row for row in selected_rows if int(row["label"]) == label]
        for label in selected_labels
    }
    for row_number, label in enumerate(selected_labels):
        rows = rows_by_label[label]
        for column_number in range(images_per_class):
            ax = axes[row_number, column_number]
            ax.axis("off")
            if column_number >= len(rows):
                continue
            row = rows[column_number]
            image, embedded_label = images[int(row["record_id"])]
            if embedded_label != label:
                raise ValueError(
                    f"Label mismatch for record {row['record_id']}: "
                    f"list={label}, record={embedded_label}"
                )
            ax.imshow(image)
            source_path = row.get("source_path")
            if source_path is not None and not pd.isna(source_path):
                sample_name = Path(str(source_path)).name
            else:
                sample_name = f"Record {row['record_id']}"
            ax.set_title(f"Label {label}\n{sample_name}")

    fig.suptitle("CASIA-WebFace sample identities", y=1.01, fontsize=14)
    fig.tight_layout()
    return fig, axes
