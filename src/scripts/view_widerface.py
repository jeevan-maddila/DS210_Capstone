# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow==12.3.0"]
# ///
"""Browse full WIDER FACE photos without model inference.

    uv run src/scripts/view_widerface.py
    uv run src/scripts/view_widerface.py --examples
    uv run src/scripts/view_widerface.py --event 12

Arrow keys: previous/next. R: random. F: fit. 1: actual pixels.
Mouse wheel or +/-: zoom. Drag the photo to pan. Photos are never modified.
"""
from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMAGES = ROOT / "data/raw/widerface/WIDER_val/images"
EXAMPLES = ROOT / "reports/widerface/error_analysis/examples.json"


def select_images(args):
    folder = args.data.resolve()
    if not folder.is_dir():
        raise ValueError(f"Image directory not found: {folder}")
    notes = {}
    if args.examples:
        if not EXAMPLES.exists():
            raise ValueError(f"Saved error examples not found: {EXAMPLES}")
        records = json.loads(EXAMPLES.read_text(encoding="utf-8"))
        paths = []
        for row in records:
            path = (folder / (row["key"] + ".jpg")).resolve()
            if not path.is_relative_to(folder) or not path.is_file():
                raise ValueError(f"Missing or invalid example image: {path}")
            if path not in notes:
                paths.append(path)
            notes[path] = row
    else:
        paths = sorted(p.resolve() for p in folder.rglob("*.jpg"))
    if args.event:
        paths = [p for p in paths if p.parent.name == args.event or p.parent.name.startswith(args.event + "--")]
    if not paths:
        raise ValueError("No matching photos found. Check --data and --event.")
    if args.image:
        matches = [p for p in paths if p.name == args.image or p.relative_to(folder).as_posix() == args.image.replace('\\', '/')]
        if len(matches) != 1:
            raise ValueError("--image must match one filename or event/filename.jpg in this selection")
        first = matches[0]
        paths = [first] + [p for p in paths if p != first]
    elif not args.examples:
        random.Random(args.seed).shuffle(paths)
    if args.count:
        paths = paths[:args.count]
    return paths, notes


def show_viewer(paths, notes):
    import tkinter as tk
    from tkinter import ttk, messagebox
    from PIL import ImageTk

    class Viewer:
        def __init__(self):
            self.root = tk.Tk()
            self.root.title("WIDER FACE — full photo viewer")
            self.root.geometry("1200x850")
            self.index = 0
            self.original = None
            self.photo = None
            self.zoom = 1.0
            self.fit_mode = True
            self.resize_job = None
            toolbar = ttk.Frame(self.root, padding=8)
            toolbar.pack(fill="x")
            for label, callback in [("← Previous", lambda: self.move(-1)), ("Next →", lambda: self.move(1)),
                                    ("Random", self.random_image), ("Fit whole photo", self.fit),
                                    ("100% pixels", self.actual), ("−", lambda: self.change_zoom(.8)),
                                    ("+", lambda: self.change_zoom(1.25))]:
                ttk.Button(toolbar, text=label, command=callback).pack(side="left", padx=3)
            self.highlight = tk.BooleanVar(value=False)
            if notes:
                ttk.Checkbutton(toolbar, text="Mark example face", variable=self.highlight, command=self.draw).pack(side="left", padx=8)
            self.caption = tk.StringVar()
            ttk.Label(self.root, textvariable=self.caption, padding=(10, 4), wraplength=1150).pack(fill="x")
            frame = ttk.Frame(self.root)
            frame.pack(fill="both", expand=True)
            frame.rowconfigure(0, weight=1)
            frame.columnconfigure(0, weight=1)
            self.canvas = tk.Canvas(frame, background="#18212f", highlightthickness=0)
            self.canvas.grid(row=0, column=0, sticky="nsew")
            horizontal = ttk.Scrollbar(frame, orient="horizontal", command=self.canvas.xview)
            vertical = ttk.Scrollbar(frame, orient="vertical", command=self.canvas.yview)
            horizontal.grid(row=1, column=0, sticky="ew")
            vertical.grid(row=0, column=1, sticky="ns")
            self.canvas.configure(xscrollcommand=horizontal.set, yscrollcommand=vertical.set)
            ttk.Label(self.root, text="← / → browse  •  R random  •  F fit  •  1 actual pixels  •  wheel / +/- zoom  •  drag to pan", padding=8).pack(fill="x")
            for key in ("<Right>", "<n>"):
                self.root.bind(key, lambda event: self.move(1))
            for key in ("<Left>", "<p>"):
                self.root.bind(key, lambda event: self.move(-1))
            self.root.bind("<r>", lambda event: self.random_image())
            self.root.bind("<f>", lambda event: self.fit())
            self.root.bind("<1>", lambda event: self.actual())
            self.root.bind("<plus>", lambda event: self.change_zoom(1.25))
            self.root.bind("<equal>", lambda event: self.change_zoom(1.25))
            self.root.bind("<minus>", lambda event: self.change_zoom(.8))
            self.canvas.bind("<MouseWheel>", lambda event: self.change_zoom(1.15 if event.delta > 0 else 1 / 1.15))
            self.canvas.bind("<ButtonPress-1>", lambda event: self.canvas.scan_mark(event.x, event.y))
            self.canvas.bind("<B1-Motion>", lambda event: self.canvas.scan_dragto(event.x, event.y, gain=1))
            self.canvas.bind("<Configure>", self.on_resize)
            self.root.after(100, self.load)
            self.root.mainloop()

        def move(self, step):
            self.index = (self.index + step) % len(paths)
            self.load()

        def random_image(self):
            others = [i for i in range(len(paths)) if i != self.index]
            if others:
                self.index = random.choice(others)
            self.load()

        def load(self):
            try:
                with Image.open(paths[self.index]) as source:
                    self.original = source.convert("RGB")
            except (OSError, Image.DecompressionBombError) as error:
                self.original = None
                self.canvas.delete("all")
                messagebox.showerror("Cannot open photo", f"{paths[self.index]}\n\n{error}")
                return
            self.fit_mode = True
            self.canvas.xview_moveto(0)
            self.canvas.yview_moveto(0)
            self.draw()

        def on_resize(self, event):
            if not self.fit_mode:
                return
            if self.resize_job:
                self.root.after_cancel(self.resize_job)
            self.resize_job = self.root.after(80, self.draw)

        def fit(self):
            self.fit_mode = True
            self.draw()

        def actual(self):
            self.fit_mode = False
            self.zoom = 1
            self.draw()

        def change_zoom(self, factor):
            if self.original is None:
                return
            self.fit_mode = False
            # Bound rendered memory, without modifying the original image on disk.
            maximum = max(1.0, min(8.0, math.sqrt(30_000_000 / (self.original.width * self.original.height))))
            self.zoom = min(maximum, max(.05, self.zoom * factor))
            self.draw()

        def draw(self):
            self.resize_job = None
            if self.original is None:
                return
            width, height = self.original.size
            cw, ch = max(1, self.canvas.winfo_width()), max(1, self.canvas.winfo_height())
            if self.fit_mode:
                self.zoom = min(cw / width, ch / height)
            size = (max(1, round(width * self.zoom)), max(1, round(height * self.zoom)))
            image = self.original.resize(size, Image.Resampling.LANCZOS)
            note = notes.get(paths[self.index])
            if note and self.highlight.get():
                x, y, w, h = note["box_xywh"]
                ImageDraw.Draw(image).rectangle((x*self.zoom, y*self.zoom, (x+w)*self.zoom, (y+h)*self.zoom), outline="#22c55e", width=3)
            self.photo = ImageTk.PhotoImage(image)
            self.canvas.delete("all")
            self.canvas.create_image(max(0, (cw-size[0])//2), max(0, (ch-size[1])//2), anchor="nw", image=self.photo)
            self.canvas.configure(scrollregion=(0, 0, max(cw, size[0]), max(ch, size[1])))
            extra = f"\nFailure example {note['number']}: {note['kind']}" if note else ""
            self.caption.set(f"Photo {self.index+1}/{len(paths)}  |  {width} × {height} pixels  |  Zoom {self.zoom:.0%}\n{paths[self.index]}{extra}")

    Viewer()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DEFAULT_IMAGES, help="Folder containing event subfolders")
    parser.add_argument("--examples", action="store_true", help="Browse the four full photos used in the error analysis")
    parser.add_argument("--event", help="Event number or folder, e.g. 12 or 12--Group")
    parser.add_argument("--image", help="Start on an exact filename or event/filename.jpg")
    parser.add_argument("--count", type=int, default=100, help="Maximum photos; 0 includes all (default 100)")
    parser.add_argument("--seed", type=int, default=42, help="Reproducible initial shuffle")
    parser.add_argument("--list", action="store_true", help="Print selected paths without opening the viewer")
    args = parser.parse_args()
    if args.count < 0:
        parser.error("--count must be zero or positive")
    try:
        paths, notes = select_images(args)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if args.list:
        for path in paths:
            print(path)
        return
    try:
        show_viewer(paths, notes)
    except ImportError as error:
        parser.exit(1, f"GUI dependency unavailable: {error}. Use a Python installation with tkinter, or --list to print paths.\n")


if __name__ == "__main__":
    main()
