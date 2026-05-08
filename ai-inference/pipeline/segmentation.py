"""Mock segmentation pipeline for Phase 3a.

In Phase 3b this module will load DentalSegmentator weights and run
nnU-Net inference. For now, it returns deterministic demo metadata.

Phase 3b integration plan:
- Load nnU-Net model from /models volume mount
- Accept normalised numpy volume as input
- Return DICOM SEG metadata + confidence scores
- Push DICOM SEG to Orthanc via DICOMweb STOW-RS
"""


def run_mock_segmentation(study_instance_uid: str) -> list[dict]:
    """Return mock anatomy segmentation metadata. No image processing."""
    # study_instance_uid is accepted for API compatibility with Phase 3b
    _ = study_instance_uid
    return [
        {"anatomyClass": "mandible", "confidence": 0.92, "uncertainty": "low"},
        {"anatomyClass": "mandibular_canal", "confidence": 0.78, "uncertainty": "medium"},
    ]
