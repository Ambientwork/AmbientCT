"""
tests/test_dicom_loader.py — Unit tests for dicom_loader + quality_check  (Phase 3b-1)

All tests synthesise in-memory pydicom Datasets — no real DICOM files needed.
OrthancClient is monkey-patched with async stubs.

Test cases:
  test_load_volume_stacks_correctly
  test_inconsistent_series_uid_raises
  test_inconsistent_frame_of_reference_raises
  test_non_uniform_spacing_raises
  test_quality_check_flags_anisotropic
  test_quality_check_in_range
  test_quality_check_out_of_range_warns
  test_single_slice_volume_warning
"""

from __future__ import annotations

import io
from typing import Any
from unittest.mock import AsyncMock, patch

import numpy as np
import pydicom
import pydicom.uid
import pytest
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian

from pipeline.dicom_loader import (
    LoadedVolume,
    VolumeLoadError,
    load_volume_from_orthanc,
)
from pipeline.orthanc_client import (
    InstanceSummary,
    OrthancClient,
    SeriesSummary,
)
from pipeline.quality_check import QualityReport, check_volume_quality

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.loader.test"
SERIES_UID = "1.2.840.10008.5.1.4.1.1.2.loader.series"
FOR_UID = "1.2.840.10008.5.1.4.1.1.2.loader.for"


# ── Dataset synthesis helpers ─────────────────────────────────────────────────


def _make_instance(
    sop_uid: str,
    z_pos: float,
    rows: int = 5,
    cols: int = 5,
    series_uid: str = SERIES_UID,
    for_uid: str = FOR_UID,
    pixel_value: int = 0,
) -> bytes:
    """
    Synthesise a minimal DICOM dataset and return its bytes.

    The pixel_array is a (rows, cols) int16 array filled with pixel_value.
    """
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.file_meta.MediaStorageSOPInstanceUID = sop_uid
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.is_implicit_VR = False
    ds.is_little_endian = True

    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
    ds.SOPInstanceUID = sop_uid
    ds.StudyInstanceUID = STUDY_UID
    ds.SeriesInstanceUID = series_uid
    ds.FrameOfReferenceUID = for_uid
    ds.InstanceNumber = "1"

    ds.ImagePositionPatient = [0.0, 0.0, z_pos]
    ds.ImageOrientationPatient = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    ds.PixelSpacing = [0.4, 0.4]

    ds.Rows = rows
    ds.Columns = cols
    ds.BitsAllocated = 16
    ds.BitsStored = 16
    ds.HighBit = 15
    ds.PixelRepresentation = 1  # signed
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"

    pixel_data = np.full((rows, cols), pixel_value, dtype=np.int16)
    ds.PixelData = pixel_data.tobytes()

    buf = io.BytesIO()
    pydicom.dcmwrite(buf, ds)
    return buf.getvalue()


def _wrap_multipart(frame_bytes: bytes) -> bytes:
    """Wrap raw bytes in a minimal multipart/related envelope."""
    boundary = b"----TestBoundary"
    return (
        b"--" + boundary + b"\r\n"
        b"Content-Type: application/octet-stream\r\n\r\n" +
        frame_bytes +
        b"\r\n--" + boundary + b"--\r\n"
    )


# ── Fake OrthancClient builder ────────────────────────────────────────────────


def _make_fake_client(instances: list[tuple[str, bytes]]) -> OrthancClient:
    """
    Return a mock OrthancClient that serves the given (sop_uid, dicom_bytes) list.

    get_series_for_study → one series with len(instances) instances
    list_instances       → InstanceSummary list ordered by InstanceNumber
    fetch_instance_full  → multipart-wrapped FULL DICOM bytes for each sop_uid
    """
    sop_uids = [sop for sop, _ in instances]
    dicoms_by_uid = {sop: data for sop, data in instances}

    async def fake_get_series(study_uid: str) -> list[SeriesSummary]:
        return [
            SeriesSummary(
                series_instance_uid=SERIES_UID,
                modality="CT",
                series_number=1,
                num_instances=len(instances),
                description="CBCT",
            )
        ]

    async def fake_list_instances(
        study_uid: str, series_uid: str
    ) -> list[InstanceSummary]:
        return [
            InstanceSummary(sop_instance_uid=sop, instance_number=i + 1)
            for i, sop in enumerate(sop_uids)
        ]

    async def fake_fetch_full(
        study_uid: str,
        series_uid: str,
        instance_uid: str,
    ) -> bytes:
        raw = dicoms_by_uid[instance_uid]
        return _wrap_multipart(raw)

    client = object.__new__(OrthancClient)
    client._base = "http://test"
    client.get_series_for_study = fake_get_series
    client.list_instances = fake_list_instances
    client.fetch_instance_full = fake_fetch_full
    client.aclose = AsyncMock()
    return client


# ── Tests ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_load_volume_stacks_correctly() -> None:
    """
    3 slices at z=0, 1, 2 mm → pixel_array.shape == (3, 5, 5) and z-order correct.
    """
    instances = [
        ("sop.1", _make_instance("sop.1", z_pos=0.0, pixel_value=10)),
        ("sop.2", _make_instance("sop.2", z_pos=1.0, pixel_value=20)),
        ("sop.3", _make_instance("sop.3", z_pos=2.0, pixel_value=30)),
    ]
    client = _make_fake_client(instances)

    vol = await load_volume_from_orthanc(client, STUDY_UID)

    assert vol.pixel_array.shape == (3, 5, 5)
    assert vol.pixel_array.dtype == np.int16
    assert vol.series_instance_uid == SERIES_UID
    assert vol.frame_of_reference_uid == FOR_UID
    # First slice (smallest z) has pixel_value=10
    assert int(vol.pixel_array[0, 0, 0]) == 10
    # Last slice has pixel_value=30
    assert int(vol.pixel_array[2, 0, 0]) == 30
    # Spacing dZ = 1.0, dY = dX = 0.4
    assert abs(vol.spacing_mm[0] - 1.0) < 0.01
    assert abs(vol.spacing_mm[1] - 0.4) < 0.01
    assert abs(vol.spacing_mm[2] - 0.4) < 0.01


@pytest.mark.asyncio
async def test_load_volume_slices_sorted_by_z() -> None:
    """Slices fed in reverse z order are sorted ascending before stacking."""
    instances = [
        # Intentionally reversed
        ("sop.z3", _make_instance("sop.z3", z_pos=2.0, pixel_value=30)),
        ("sop.z1", _make_instance("sop.z1", z_pos=0.0, pixel_value=10)),
        ("sop.z2", _make_instance("sop.z2", z_pos=1.0, pixel_value=20)),
    ]
    client = _make_fake_client(instances)

    vol = await load_volume_from_orthanc(client, STUDY_UID)

    # After z-sort: [10, 20, 30]
    assert int(vol.pixel_array[0, 0, 0]) == 10
    assert int(vol.pixel_array[1, 0, 0]) == 20
    assert int(vol.pixel_array[2, 0, 0]) == 30


@pytest.mark.asyncio
async def test_inconsistent_series_uid_raises() -> None:
    """
    If instances carry different SeriesInstanceUIDs, VolumeLoadError is raised.
    """
    instances = [
        ("sop.a", _make_instance("sop.a", z_pos=0.0, series_uid="series.AAA")),
        ("sop.b", _make_instance("sop.b", z_pos=1.0, series_uid="series.BBB")),
    ]
    client = _make_fake_client(instances)

    with pytest.raises(VolumeLoadError, match="Inconsistent SeriesInstanceUID"):
        await load_volume_from_orthanc(client, STUDY_UID)


@pytest.mark.asyncio
async def test_inconsistent_frame_of_reference_raises() -> None:
    """
    If instances carry different FrameOfReferenceUIDs, VolumeLoadError is raised.
    """
    instances = [
        ("sop.c", _make_instance("sop.c", z_pos=0.0, for_uid="for.111")),
        ("sop.d", _make_instance("sop.d", z_pos=1.0, for_uid="for.222")),
    ]
    client = _make_fake_client(instances)

    with pytest.raises(VolumeLoadError, match="Inconsistent FrameOfReferenceUID"):
        await load_volume_from_orthanc(client, STUDY_UID)


@pytest.mark.asyncio
async def test_non_uniform_spacing_raises() -> None:
    """
    Slices with highly variable Z-spacing (variance > 0.01 mm²) raise VolumeLoadError.
    """
    instances = [
        ("sop.s1", _make_instance("sop.s1", z_pos=0.0)),
        ("sop.s2", _make_instance("sop.s2", z_pos=1.0)),
        ("sop.s3", _make_instance("sop.s3", z_pos=5.0)),   # gap jumps to 4 mm
        ("sop.s4", _make_instance("sop.s4", z_pos=6.0)),
    ]
    client = _make_fake_client(instances)

    with pytest.raises(VolumeLoadError, match="non-uniform slice spacing"):
        await load_volume_from_orthanc(client, STUDY_UID)


# ── QualityReport tests ───────────────────────────────────────────────────────


def _make_volume(
    shape: tuple[int, int, int] = (10, 5, 5),
    spacing: tuple[float, float, float] = (0.4, 0.4, 0.4),
    dtype: type = np.int16,
    fill: int = 0,
) -> LoadedVolume:
    arr = np.full(shape, fill, dtype=dtype)
    return LoadedVolume(
        pixel_array=arr,
        spacing_mm=spacing,
        origin_mm=(0.0, 0.0, 0.0),
        direction=(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        study_instance_uid=STUDY_UID,
        series_instance_uid=SERIES_UID,
        frame_of_reference_uid=FOR_UID,
    )


def test_quality_check_isotropic_volume() -> None:
    """Isotropic volume (0.4 mm³) → isotropic=True, no spacing warning."""
    vol = _make_volume(spacing=(0.4, 0.4, 0.4))
    report = check_volume_quality(vol)
    assert report.isotropic is True
    assert report.in_expected_range is True
    spacing_warnings = [w for w in report.warnings if "Anisotropic" in w or "spacing" in w.lower()]
    assert len(spacing_warnings) == 0


def test_quality_check_flags_anisotropic() -> None:
    """Volume with widely different spacing components → isotropic=False + warning."""
    vol = _make_volume(spacing=(0.4, 0.4, 2.5))
    report = check_volume_quality(vol)
    assert report.isotropic is False
    aniso_warnings = [w for w in report.warnings if "Anisotropic" in w]
    assert len(aniso_warnings) >= 1


def test_quality_check_in_range() -> None:
    """Volume with typical CBCT range (fill=500) → in_expected_range=True."""
    vol = _make_volume(fill=500)
    report = check_volume_quality(vol)
    assert report.in_expected_range is True
    range_warnings = [w for w in report.warnings if "Pixel value range" in w]
    assert len(range_warnings) == 0


def test_quality_check_out_of_range_warns() -> None:
    """Volume with extreme values (fill=8000) → in_expected_range=False + warning."""
    vol = _make_volume(fill=8000)
    report = check_volume_quality(vol)
    assert report.in_expected_range is False
    range_warnings = [w for w in report.warnings if "Pixel value range" in w]
    assert len(range_warnings) >= 1


def test_quality_check_voxel_count() -> None:
    """QualityReport.voxel_count matches actual array size."""
    vol = _make_volume(shape=(10, 64, 64))
    report = check_volume_quality(vol)
    assert report.voxel_count == 10 * 64 * 64


def test_quality_check_dtype_name() -> None:
    """QualityReport.dtype_name reflects actual numpy dtype."""
    vol = _make_volume(dtype=np.int16)
    report = check_volume_quality(vol)
    assert report.dtype_name == "int16"


def test_quality_check_few_slices_warns() -> None:
    """Very few slices (< 10) produce a warning."""
    vol = _make_volume(shape=(3, 5, 5))
    report = check_volume_quality(vol)
    slice_warnings = [w for w in report.warnings if "few slices" in w.lower()]
    assert len(slice_warnings) >= 1
