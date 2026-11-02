"""Standalone crop -> Gemini -> feathered composite experiment.

Run with the repository .venv Python. --prepare-only makes crops/masks without API calls.
Coordinates are manually selected on the blurred input, not detected or inferred identities.
"""
import argparse
import json
from pathlib import Path
import subprocess
import uuid

import numpy as np
from PIL import Image, ImageDraw


APP = Path(__file__).resolve().parents[1]
ROOT = APP.parent


def run(input_path, regions_path, prepare_only=False, model="gemini-2.5-flash-image"):
    image = Image.open(input_path).convert("RGB")
    regions = json.loads(Path(regions_path).read_text())
    if list(image.size) != regions["imageSize"]:
        raise ValueError("Region coordinates do not match the input size. Update the regions JSON.")
    output = ROOT / "reports" / "face-crops" / uuid.uuid4().hex[:12]
    output.mkdir(parents=True)
    image.save(output / "input.png")
    composite = image.copy()
    preview = image.copy()
    combined_mask = np.zeros((image.height, image.width), dtype=bool)
    manifest = {"model": model, "prepareOnly": prepare_only, "faces": []}
    for index, region in enumerate(regions["faces"]):
        x1, y1, x2, y2 = region["box"]
        if not (0 <= x1 < x2 <= image.width and 0 <= y1 < y2 <= image.height):
            raise ValueError("Invalid face box")
        # Square context crop with the head in its center. Upscale for generation.
        side = min(image.width, image.height, round(max(x2-x1, y2-y1) * 2.0))
        left = max(0, min(image.width-side, round((x1+x2-side)/2)))
        top = max(0, min(image.height-side, round((y1+y2-side)/2)))
        crop_box = (left, top, left+side, top+side)
        crop_path = output / f"face-{index}-input.png"
        image.crop(crop_box).resize((768, 768), Image.Resampling.LANCZOS).save(crop_path)
        # Compact-support feather: alpha is exactly zero outside the ellipse.
        yy, xx = np.mgrid[:image.height, :image.width]
        radius = np.sqrt(((xx-(x1+x2)/2)/((x2-x1)/2))**2
                         + ((yy-(y1+y2)/2)/((y2-y1)/2))**2)
        alpha = np.clip((1-radius)/0.12, 0, 1)
        mask = Image.fromarray(np.uint8(alpha*255))
        mask.save(output / f"face-{index}-mask.png")
        combined_mask |= np.asarray(mask) > 0
        ImageDraw.Draw(preview).ellipse(region["box"], outline="red", width=3)
        entry = {"name": region["name"], "box": region["box"], "cropBox": crop_box}
        manifest["faces"].append(entry)
        if prepare_only:
            continue
        # Use the same existing SDK script and key loading. No shell interpolation.
        result = subprocess.run([
            "node", str(APP / "node_modules" / "tsx" / "dist" / "cli.mjs"),
            str(APP / "scripts" / "test-face-replacement.ts"), str(crop_path),
            str(output / f"face-{index}-generation"), model,
        ], cwd=APP, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError(f"Face {index} generation failed: {result.stderr.strip()}")
        generated = list((output / f"face-{index}-generation").glob("*/ai-replacement.*"))
        if len(generated) != 1:
            raise RuntimeError("Expected exactly one generated face image")
        patch = Image.open(generated[0]).convert("RGB")
        if abs(patch.width / patch.height - 1) > 0.05:
            raise RuntimeError("Generated crop is not square; cannot safely map it back")
        patch = patch.resize((side, side), Image.Resampling.LANCZOS)
        # Geometry can still drift within the crop; review before accepting.
        canvas = composite.copy()
        canvas.paste(patch, (left, top))
        composite = Image.composite(canvas, composite, mask)
        entry["generated"] = str(generated[0])
    preview.save(output / "regions-preview.png")
    if not prepare_only:
        before, after = np.asarray(image), np.asarray(composite)
        if np.any(before[~combined_mask] != after[~combined_mask]):
            raise RuntimeError("Pixels outside the masks changed")
        composite.save(output / "replacement.png")
        comparison = Image.new("RGB", (image.width*2, image.height))
        comparison.paste(image, (0, 0))
        comparison.paste(composite, (image.width, 0))
        comparison.save(output / "comparison.png")
        manifest["outsideMaskPixelsUnchanged"] = True
    (output / "experiment.json").write_text(json.dumps(manifest, indent=2))
    print(f"Saved experiment: {output}")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--regions", type=Path, default=Path(__file__).with_name("sample-face-regions.json"))
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--model", default="gemini-2.5-flash-image")
    args = parser.parse_args()
    run(args.input, args.regions, args.prepare_only, args.model)
