import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/scripts"))
from tune_lfw_threshold import select_threshold, cross_validate


class ThresholdTests(unittest.TestCase):
    def test_budget_constrains_false_accepts(self):
        labels = np.array([True, True, False, False])
        scores = np.array([.8, .4, .5, .1])
        threshold = select_threshold(scores, labels, "far", 0)
        self.assertGreater(threshold, .5)
        self.assertEqual(int((scores[labels] >= threshold).sum()), 1)

    def test_relaxed_budget_accepts_more_genuine_pairs(self):
        labels = np.array([True, True, False, False])
        scores = np.array([.8, .4, .5, .1])
        threshold = select_threshold(scores, labels, "far", .5)
        self.assertEqual(int((scores[labels] >= threshold).sum()), 2)
        self.assertEqual(int((scores[~labels] >= threshold).sum()), 1)

    def test_held_out_fold_does_not_choose_own_threshold(self):
        labels = np.tile([True, False], 100)
        scores = np.where(labels, .8, .1)
        _, folds, *_ = cross_validate(scores, labels, "far", .005)
        scores[:20] = -.5
        _, changed, *_ = cross_validate(scores, labels, "far", .005)
        self.assertEqual(folds[0]['threshold'], changed[0]['threshold'])

    def test_invalid_input(self):
        with self.assertRaises(ValueError):
            select_threshold(np.array([.5]), np.array([True]))
        with self.assertRaises(ValueError):
            select_threshold(np.array([.5,.1]), np.array([True,False]), target_far=-1)


if __name__ == "__main__":
    unittest.main()
