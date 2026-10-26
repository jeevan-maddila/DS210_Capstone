"""Checks for evaluation accounting and test-fold isolation (no model downloads)."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/scripts"))
from benchmark_lfw import confusion, evaluate


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.labels = np.tile(np.r_[np.ones(300, bool), np.zeros(300, bool)], 10)
        self.scores = np.where(self.labels, .8, .1)

    def test_perfect_separation_and_fold_coverage(self):
        metrics, folds, predictions, ids, _ = evaluate(self.scores, self.labels, .55)
        self.assertEqual(metrics["cross_validated"]["accuracy"], 1)
        self.assertEqual(metrics["roc_auc"], 1)
        self.assertEqual(len(folds), 10)
        np.testing.assert_array_equal(predictions, self.labels)
        np.testing.assert_array_equal(np.bincount(ids)[1:], np.repeat(600, 10))

    def test_held_out_scores_do_not_set_own_threshold(self):
        _, folds, *_ = evaluate(self.scores, self.labels, .55)
        changed = self.scores.copy()
        changed[:600] = -.9
        _, changed_folds, *_ = evaluate(changed, self.labels, .55)
        self.assertEqual(folds[0]["threshold"], changed_folds[0]["threshold"])
        self.assertEqual(folds[0]["threshold_at_training_far_1pct"],
                         changed_folds[0]["threshold_at_training_far_1pct"])

    def test_false_accept_and_reject_counting(self):
        counts = confusion(np.array([True, True, False, False]),
                           np.array([True, False, True, False]))
        self.assertEqual([counts[k] for k in ("tp", "tn", "fp", "fn")], [1, 1, 1, 1])
        self.assertEqual(counts["false_accept_rate"], .5)
        self.assertEqual(counts["false_reject_rate"], .5)


if __name__ == "__main__":
    unittest.main()
