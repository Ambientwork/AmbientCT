"""
tests/test_seg_writer.py — Unit tests for pipeline/seg_writer.py  (Phase 3b-2)

All tests use synthesised data: a fake LoadedVolume with known geometry and a
small binary mask.  No real Orthanc, no real model, no real DICOM files.

Tests:
  test_write_canal_seg_preserves_frame_of_reference_uid
  test_write_canal_seg_preserves_study_instance_uid
  test_write_canal_seg_creates_new_series_uid
  test_write_canal_seg_modality_is_seg
  test_write_canal_seg_correct_segment_count
  test_write_canal_seg_correct_per_frame_groups
  test_write_canal_seg_skip_empty_slices
  test_write_uses_snomed_codes_for_canal
  test_write_seg_round_trip                  — write → dcmread → key tags preserved
"""

from __future__ import annotations

# ── pydicom 3.x compatibility shim (must come before any pydicom_seg import) ──
import sys as _sys
import types as _types

if "pydicom._storage_sopclass_uids" not in _sys.modules:
    import pydicom.uid as _pydicom_uid

    _shim = _types.ModuleType("pydicom._storage_sopclass_uids")
    _shim.SegmentationStorage = _pydicom_uid.SegmentationStorage  # type: ignore[attr-defined]
    _sys.modules["pydicom._storage_sopclass_uids"] = _shim
# ──────────────────────────────────────────────────────────────────────────────

import io

import numpy as np
import pydicom
import pytest

from pipeline.dicom_loader import LoadedVolume
from pipeline.seg_writer import write_dicom_seg

# ── Constants ─────────────────────────────────────────────────────────────────

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.9999.STUDY"
SERIES_UID = "1.2.840.10008.5.1.4.1.1.2.9999.SERIES"
FOR_UID = "1.2.840.10008.5.1.4.1.1.2.9999.FOR"

# Axial isotropic volume: 8 slices × 32 rows × 32 cols
_N_SLICES = 8
_ROWS = 32
_COLS = 32

# Standard axial orientation: row = +X, col = +Y, normal = +Z
_DIRECTION = (
    1.0, 0.0, 0.0,   # row cosines (x, y, z)
    0.0, 1.0, 0.0,   # col cosines
    0.0, 0.0, 1.0,   # normal (z-axis)
)
_SPACING_MM = (1.0, 1.0, 1.0)   # (dz, dy, dx)
_ORIGIN_MM = (0.0, 0.0, 0.0)    # (z_patient, y_patient, x_patient)

MODEL_ID = "test-model"
MODEL_VERSION = "0.0.1"


# ── Fixtures ──────────────────────────────────────────────────────────────────


def _make_volume(
    n_slices: int = _N_SLICES,
    rows: int = _ROWS,
    cols: int = _COLS,
    for_uid: str = FOR_UID,
    study_uid: str = STUDY_UID,
    series_uid: str = SERIES_UID,
) -> LoadedVolume:
    """Return a synthetic LoadedVolume with the given geometry."""
    pixel_array = np.zeros((n_slices, rows, cols), dtype=np.int16)
    return LoadedVolume(
        pixel_array=pixel_array,
        spacing_mm=_SPACING_MM,
        origin_mm=_ORIGIN_MM,
        direction=_DIRECTION,
        study_instance_uid=study_uid,
        series_instance_uid=series_uid,
        frame_of_reference_uid=for_uid,
    )


def _make_canal_mask(
    n_slices: int = _N_SLICES,
    rows: int = _ROWS,
    cols: int = _COLS,
    active_slices: list[int] | None = None,
) -> np.ndarray:
    """
    Binary uint8 mask with foreground in a small rectangular region.
    active_slices: which z-indices have foreground (default: all except first and last).
    """
    mask = np.zeros((n_slices, rows, cols), dtype=np.uint8)
    if active_slices is None:
        active_slices = list(range(1, n_slices - 1))
    for z in active_slices:
        mask[z, 10:20, 10:20] = 1
    return mask


# ── Tests ─────────────────────────────────────────────────────────────────────


def test_write_canal_seg_preserves_frame_of_reference_uid() -> None:
    """FrameOfReferenceUID in written SEG must equal source_volume value exactly."""
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    assert len(results) == 1
    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert str(seg_ds.FrameOfReferenceUID) == FOR_UID


def test_write_canal_seg_preserves_study_instance_uid() -> None:
    """StudyInstanceUID in written SEG must equal source_volume value exactly."""
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert str(seg_ds.StudyInstanceUID) == STUDY_UID


def test_write_canal_seg_creates_new_series_uid() -> None:
    """SeriesInstanceUID must be freshly generated, NOT equal to source series UID."""
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert str(seg_ds.SeriesInstanceUID) != SERIES_UID
    # Also verify the dataclass field matches what's in the DICOM
    assert results[0].series_instance_uid == str(seg_ds.SeriesInstanceUID)


def test_write_canal_seg_modality_is_seg() -> None:
    """Modality tag in the written SEG must be 'SEG'."""
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert str(seg_ds.Modality) == "SEG"


def test_write_canal_seg_correct_segment_count() -> None:
    """For 1 anatomy class in input, the SEG must have exactly 1 SegmentSequence entry."""
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert len(seg_ds.SegmentSequence) == 1
    assert seg_ds.SegmentSequence[0].SegmentNumber == 1


def test_write_canal_seg_correct_per_frame_groups() -> None:
    """
    PerFrameFunctionalGroupsSequence must have one item per active (non-empty) slice.
    active_slices in _make_canal_mask defaults to slices 1..6 (6 slices for N=8).
    """
    active_slices = [1, 2, 3, 4, 5, 6]
    volume = _make_volume()
    mask = _make_canal_mask(active_slices=active_slices)

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert int(seg_ds.NumberOfFrames) == len(active_slices)
    assert len(seg_ds.PerFrameFunctionalGroupsSequence) == len(active_slices)


def test_write_canal_seg_skip_empty_slices() -> None:
    """
    Slices with all-zero mask must NOT appear in PerFrameFunctionalGroupsSequence.

    We create a mask with foreground only in slices 2 and 5 (out of 8).
    The written SEG must contain exactly 2 frames.
    """
    volume = _make_volume()
    mask = _make_canal_mask(active_slices=[2, 5])

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert int(seg_ds.NumberOfFrames) == 2
    assert len(seg_ds.PerFrameFunctionalGroupsSequence) == 2


def test_write_uses_snomed_codes_for_canal() -> None:
    """
    SegmentedPropertyTypeCodeSequence for mandibular_canal must use
    SNOMED-CT code "23690000" (Mandibular canal).
    """
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    seg_entry = seg_ds.SegmentSequence[0]

    type_seq = seg_entry.SegmentedPropertyTypeCodeSequence
    assert len(type_seq) == 1
    assert str(type_seq[0].CodeValue) == "23690000"
    assert str(type_seq[0].CodingSchemeDesignator) == "SCT"


def test_write_seg_round_trip() -> None:
    """
    Write SEG → dcmread → verify all key tags are preserved.

    This ensures the serialised DICOM Part-10 bytes are well-formed and
    that all geometry/provenance tags survive the round-trip.
    """
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    assert len(results) == 1
    seg_bytes = results[0].dicom_bytes

    # Round-trip: read back from bytes
    seg_ds = pydicom.dcmread(io.BytesIO(seg_bytes))

    # All critical tags must survive the round-trip
    assert str(seg_ds.FrameOfReferenceUID) == FOR_UID, "FrameOfReferenceUID lost"
    assert str(seg_ds.StudyInstanceUID) == STUDY_UID, "StudyInstanceUID lost"
    assert str(seg_ds.Modality) == "SEG", "Modality lost"
    assert len(seg_ds.SegmentSequence) == 1, "SegmentSequence lost"
    assert int(seg_ds.NumberOfFrames) > 0, "NumberOfFrames lost or zero"
    assert len(seg_ds.PerFrameFunctionalGroupsSequence) > 0, "PerFrameFunctionalGroupsSequence lost"

    # SOPInstanceUID on dataclass matches what's in the DICOM file
    assert results[0].sop_instance_uid == str(seg_ds.SOPInstanceUID)
    assert results[0].series_instance_uid == str(seg_ds.SeriesInstanceUID)

    # DerivationCodeSequence must be present with DCM code 113076
    assert hasattr(seg_ds, "DerivationCodeSequence"), "DerivationCodeSequence missing"
    assert str(seg_ds.DerivationCodeSequence[0].CodeValue) == "113076"

    # SoftwareVersions provenance
    assert "AmbientCT AI Assist 0.2" in str(seg_ds.SoftwareVersions)


def test_write_multiple_classes_produces_separate_segs() -> None:
    """Two anatomy classes → two WrittenSegmentation objects, each a separate series."""
    volume = _make_volume()
    mandible_mask = _make_canal_mask(active_slices=[0, 1, 2, 3])
    canal_mask = _make_canal_mask(active_slices=[2, 3, 4, 5])

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={
            "mandible": mandible_mask,
            "mandibular_canal": canal_mask,
        },
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    assert len(results) == 2
    uids = {r.series_instance_uid for r in results}
    assert len(uids) == 2, "Each class should have its own SeriesInstanceUID"


def test_write_all_zero_mask_is_skipped() -> None:
    """An entirely-zero mask produces no WrittenSegmentation (pydicom-seg skips it)."""
    volume = _make_volume()
    zero_mask = np.zeros((_N_SLICES, _ROWS, _COLS), dtype=np.uint8)

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": zero_mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    assert results == [], "All-zero mask must produce no output"


# ── is_demo marking (plan P1.3) ─────────────────────────────────────────────


def test_write_default_is_not_marked_as_demo() -> None:
    """is_demo defaults to False: no demo suffix in SeriesDescription."""
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id=MODEL_ID,
        model_version=MODEL_VERSION,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))
    assert "DEMO" not in str(seg_ds.SeriesDescription)


def test_write_is_demo_marks_series_description_and_model_name() -> None:
    """is_demo=True (only reachable via AI_INFERENCE_PERSIST_DEMO_SEG=true)
    must mark the SEG file itself as synthetic: a distinctive
    SeriesDescription AND the mock model id in
    ManufacturerModelName/SegmentAlgorithmName — a PACS browser must never
    be able to mistake a persisted demo SEG for a real result.
    """
    volume = _make_volume()
    mask = _make_canal_mask()

    results = write_dicom_seg(
        source_volume=volume,
        masks_by_class={"mandibular_canal": mask},
        model_id="ambientct-mock-v0",
        model_version="0.0.0-3b-2-demo",
        is_demo=True,
    )

    seg_ds = pydicom.dcmread(io.BytesIO(results[0].dicom_bytes))

    assert "DEMO" in str(seg_ds.SeriesDescription)
    assert "Not for Diagnosis" in str(seg_ds.SeriesDescription)
    assert "DEMO" in str(seg_ds.ContentDescription)
    assert "ambientct-mock-v0" in str(seg_ds.ManufacturerModelName)

    seg_entry = seg_ds.SegmentSequence[0]
    assert "ambientct-mock-v0" in str(seg_entry.SegmentAlgorithmName)
