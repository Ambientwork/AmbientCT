"""
pipeline/exceptions.py — Typed exception hierarchy for AmbientCT AI Inference.

All pipeline exceptions inherit from AiInferenceError so callers can catch
the full hierarchy with a single except clause when appropriate, while still
being able to discriminate on sub-types.

Hierarchy:
  AiInferenceError
  ├── OrthancError          (in pipeline/orthanc_client.py)
  │   ├── OrthancNotFound
  │   ├── OrthancAuthError
  │   └── OrthancNetworkError
  └── VolumeLoadError       (in pipeline/dicom_loader.py)
"""

from __future__ import annotations


class AiInferenceError(Exception):
    """Base class for all AmbientCT AI Inference pipeline errors."""
