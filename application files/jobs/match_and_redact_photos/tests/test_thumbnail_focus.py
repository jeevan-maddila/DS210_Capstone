"""Exercise the actual pure helper and job write path without model downloads."""
import ast
from datetime import datetime, timezone
import logging
import math
from pathlib import Path
from types import SimpleNamespace
import unittest

source = ast.parse((Path(__file__).resolve().parents[1] / "main.py").read_text())
functions = [node for node in source.body if isinstance(node, ast.FunctionDef)
             and node.name in ("thumbnail_focus", "process_photo")]
scope = dict(math=math, datetime=datetime, timezone=timezone, LOG=logging.getLogger("test"))
exec(compile(ast.Module(body=functions, type_ignores=[]), "matcher_thumbnail", "exec"), scope)
focus = scope["thumbnail_focus"]


class ThumbnailTests(unittest.TestCase):
    def test_single_face_and_dimensions(self):
        self.assertEqual(focus([{"bbox": (200, 100, 400, 300)}], 600, 900),
                         {"x": 0.5, "y": 200 / 900, "imageWidth": 600, "imageHeight": 900})

    def test_group_bounds_center(self):
        result = focus([{"bbox": (100, 50, 200, 150)}, {"bbox": (700, 100, 900, 200)}], 1000, 500)
        self.assertEqual(result["x"], 0.5)
        self.assertEqual(result["y"], 0.25)

    def test_invalid_and_empty_detections(self):
        self.assertIsNone(focus([], 100, 100))
        self.assertIsNone(focus([{"bbox": (math.nan, 0, 20, 20)}], 100, 100))
        self.assertIsNone(focus([{"bbox": (40, 20, 10, 30)}], 100, 100))
        self.assertIsNone(focus([{"bbox": (0, 0, 20, 20)}], 0, 100))

    def test_box_clamps_to_image_edges(self):
        self.assertEqual(focus([{"bbox": (-10, -10, 110, 110)}], 100, 100)["x"], 0.5)

    def test_real_processing_path_saves_focus_with_success_and_removes_it_on_failure(self):
        writes = []
        faces = [{"bbox": (200, 100, 400, 300), "embedding": None}]
        class Image:
            shape = (900, 600, 3)
            def copy(self):
                return self
        class Blob:
            def delete(self):
                pass
        delete = object()
        scope.update(read_from_sources=lambda *args: Image(), load_attendees=lambda *args, **kwargs: [],
                     match_face=lambda *args: (None, "unmatched", None), blur_face=lambda *args: None,
                     upload_cleared_image=lambda *args: "https://example.invalid/cleared.jpg",
                     update_existing=lambda db, refs, patch: writes.append(patch), MODEL_SIGNATURE="test-model",
                     firestore=SimpleNamespace(DELETE_FIELD=delete))
        row = {"event_id": "event", "photo_id": "photo", "sources": [], "docs": ["root", "mirror"]}
        bucket = SimpleNamespace(blob=lambda path: Blob())
        self.assertTrue(scope["process_photo"](None, bucket, SimpleNamespace(detect=lambda image: faces), row, {}))
        self.assertEqual(writes[-1]["thumbnailFocus"], focus(faces, 600, 900))
        self.assertFalse(scope["process_photo"](None, bucket, SimpleNamespace(detect=lambda image: []), row, {}))
        self.assertIs(writes[-1]["thumbnailFocus"], delete)


if __name__ == "__main__":
    unittest.main()
