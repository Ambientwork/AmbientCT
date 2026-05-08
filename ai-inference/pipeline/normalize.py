"""Volume normalisation pipeline module — Phase 3b placeholder.

Phase 3b will implement:
  - HU-range clipping to a configurable window (e.g. [-1000, 3000])
  - Voxel-spacing resampling to the isotropic target resolution required by
    DentalSegmentator / nnU-Net (typically 0.4 mm isotropic)
  - Orientation standardisation (RAS → LPS or model-specific convention)
  - Output: normalised NumPy ndarray (float32) + affine matrix

Dependencies (Phase 3b):
  - SimpleITK for resampling and orientation
  - numpy for array manipulation

No implementation in Phase 3a — the mock pipeline bypasses this stage.
"""
