import sys
import numpy as np
import pandas as pd
import sklearn
import cv2
from PIL import Image
import matplotlib

print("=== DS210 Environment Test ===")
print(f"Python:       {sys.version}")
print(f"NumPy:        {np.__version__}")
print(f"Pandas:       {pd.__version__}")
print(f"Scikit-learn: {sklearn.__version__}")
print(f"OpenCV:       {cv2.__version__}")
print(f"Pillow:       {Image.__version__}")
print(f"Matplotlib:   {matplotlib.__version__}")

# Simple NumPy test
numbers = np.array([1, 2, 3, 4, 5])
print(f"\nNumPy mean: {numbers.mean()}")

# Simple Pandas test
df = pd.DataFrame({
    "person": ["Alice", "Bob", "Charlie"],
    "consent": [True, False, True]
})

print("\nTest DataFrame:")
print(df)

print("\nEnvironment is working!")