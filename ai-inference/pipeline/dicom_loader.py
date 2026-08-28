"""
pipeline/dicom_loader.py — DICOM series → 3-D NumPy volume  (Phase 3b-1)

Fetches a CBCT series from Orthanc via DICOMweb WADO-RS, parses each instance
with pydicom, sorts slices by ImagePositionPatient Z-coordinate, and stacks
them into a (Z, Y, X) int16 ndarray.

PHI-safe logging:
  - StudyInstanceUID / SeriesInstanceUID / FrameOfReferenceUID → first 16 chars + "..."
  - PatientName / PatientBirthDate / PatientSex → NEVER logged
  - Volume shape, dtype, spacing → OK to log (no PHI)

Usage:
    async with OrthancClient(url, user, pw) as client:
        vol = await load_volume_from_orthanc(client, study_uid)
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pydicom

from pipeline.exceptions import AiInferenceError
from pipeline.orthanc_client import OrthancClient

log = logging.getLogger("ai-inference.dicom_loader")


# ── Exceptions ────────────────────────────────────────────────────────────────


class VolumeLoadError(AiInferenceError):
    """
    Raised when the DICOM series cannot be assembled into a valid 3-D volume.

    Examples: inconsistent SeriesInstanceUID, non-uniform slice spacing,
    wrong dtype, missing mandatory tags.
    """


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class LoadedVolume:
    """
    In-memory 3-D CBCT volume reconstructed from a DICOM series.

    Attributes
    ----------
    pixel_array:
        Signed 16-bit voxel data, shape (Z, Y, X).
    spacing_mm:
        Voxel spacing (dZ, dY, dX) in millimetres.
    origin_mm:
        Patient-coordinate origin of the *first* slice (Z_first, Y, X) in mm.
    direction:
        9-tuple derived from ImageOrientationPatient (row_cosines + col_cosines
        + the computed normal).  Stored for SEG alignment in Phase 3b-2.
    study_instance_uid:
        DICOM StudyInstanceUID — used as the job key.
    series_instance_uid:
        DICOM SeriesInstanceUID of the loaded series.
    frame_of_reference_uid:
        FrameOfReferenceUID — required for DICOM SEG overlay alignment (3b-2).
    source_sop_instance_uids:
        Per-slice SOPInstanceUID of the ORIGINAL source instances, in the
        same ascending-Z order as ``pixel_array``'s first axis (index i here
        corresponds to ``pixel_array[i]``). Required by seg_writer.py to
        build DICOM SEG per-frame source-instance references (plan P4.1/
        P4.2) that point at the real instances stored in Orthanc — a SEG
        referencing fabricated UIDs would not resolve in any PACS/viewer.
        Defaults to an empty tuple for callers (tests, other pipeline
        stages) that never write a DICOM SEG from this volume; seg_writer
        raises SegWriterError if it is empty or mis-sized when a SEG write
        is actually attempted.
    patient_id, patient_name, patient_birth_date, patient_sex:
        Copied verbatim from the source series (study-level demographics,
        identical across all instances of one series) so a derived DICOM
        SEG can carry the same Patient module as its source (plan P4.2).
        A SEG missing PatientID is not a cosmetic gap: Orthanc keys a
        study's identity on (PatientID, StudyInstanceUID) together, so a
        SEG with an empty PatientID silently lands in a SECOND, separate
        Orthanc "study" resource sharing the same StudyInstanceUID —
        breaking QIDO (duplicate study rows) and any PACS/viewer that
        expects one patient per study. Never logged (PHI) — see module
        docstring.
    """

    pixel_array: np.ndarray
    spacing_mm: tuple[float, float, float]
    origin_mm: tuple[float, float, float]
    direction: tuple[float, ...]
    study_instance_uid: str
    series_instance_uid: str
    frame_of_reference_uid: str
    source_sop_instance_uids: tuple[str, ...] = field(default_factory=tuple)
    patient_id: str = ""
    patient_name: str = ""
    patient_birth_date: str = ""
    patient_sex: str = ""


# ── Internal helpers ──────────────────────────────────────────────────────────


def _safe_uid(uid: str) -> str:
    """PHI-safe UID representation for log messages."""
    return uid[:16] + "..." if len(uid) > 16 else uid


def _ds_float(ds: "pydicom.Dataset", keyword: str) -> float | None:
    """Return a float attribute from a pydicom Dataset, or None if absent.

    Note: ``Dataset.get(keyword)`` returns the value directly (not a
    DataElement) — no ``.value`` attribute access needed.
    """
    val = ds.get(keyword)
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _ds_str(ds: "pydicom.Dataset", keyword: str, fallback: str = "") -> str:
    val = ds.get(keyword)
    if val is None:
        return fallback
    if isinstance(val, bytes):
        return val.decode("latin-1", errors="replace").strip()
    return str(val).strip()


def _parse_image_position(ds: "pydicom.Dataset") -> tuple[float, float, float] | None:
    """Return (x, y, z) from ImagePositionPatient, or None if absent."""
    val = ds.get("ImagePositionPatient")
    if val is None:
        return None
    try:
        vals = [float(v) for v in val]
        if len(vals) >= 3:
            return (vals[0], vals[1], vals[2])
    except (TypeError, ValueError):
        pass
    return None


def _parse_pixel_spacing(ds: "pydicom.Dataset") -> tuple[float, float] | None:
    """Return (row_spacing, col_spacing) from PixelSpacing, or None."""
    val = ds.get("PixelSpacing")
    if val is None:
        return None
    try:
        vals = [float(v) for v in val]
        if len(vals) >= 2:
            return (vals[0], vals[1])
    except (TypeError, ValueError):
        pass
    return None


def _parse_orientation(ds: "pydicom.Dataset") -> tuple[float, ...] | None:
    """
    Return the 9-component direction cosines from ImageOrientationPatient.

    DICOM provides 6 values (row + column direction cosines).  We compute the
    slice normal via cross product to yield a full 9-tuple matching the
    convention used by SimpleITK / ITK (row, col, normal).
    """
    val = ds.get("ImageOrientationPatient")
    if val is None:
        return None
    try:
        vals = [float(v) for v in val]
    except (TypeError, ValueError):
        return None

    if len(vals) < 6:
        return None

    row = np.array(vals[:3])
    col = np.array(vals[3:6])
    normal = np.cross(row, col)
    return tuple(float(v) for v in [*row, *col, *normal])


def _multipart_to_bytes(multipart_body: bytes) -> bytes:
    """
    Extract the first part payload from a WADO-RS multipart/related response.

    Orthanc's DICOMweb plugin wraps each frame in multipart/related with a
    MIME boundary.  We locate the boundary from the first ``--`` delimiter,
    skip the part headers, and return the raw payload bytes.
    """
    # Find the first boundary line
    idx = multipart_body.find(b"--")
    if idx == -1:
        # No boundary — assume bare pixel data (some Orthanc configurations)
        return multipart_body

    # Skip the boundary line itself
    end_of_boundary = multipart_body.find(b"\r\n", idx)
    if end_of_boundary == -1:
        return multipart_body

    # Skip part headers (blank line separates headers from body)
    header_end = multipart_body.find(b"\r\n\r\n", end_of_boundary)
    if header_end == -1:
        return multipart_body

    body_start = header_end + 4

    # Find end boundary (next -- prefix after body_start)
    next_boundary = multipart_body.find(b"\r\n--", body_start)
    if next_boundary == -1:
        return multipart_body[body_start:]

    return multipart_body[body_start:next_boundary]


# ── Public API ────────────────────────────────────────────────────────────────


async def load_volume_from_orthanc(
    client: OrthancClient,
    study_instance_uid: str,
) -> LoadedVolume:
    """
    Fetch and reconstruct a 3-D CBCT volume from Orthanc.

    Series selection: the series with the most instances is chosen (CBCT
    studies typically contain a single CT series; this heuristic is defensive
    against localiser scout images which have far fewer slices).

    Slice ordering: ascending ImagePositionPatient Z-coordinate (axial).

    Spacing: PixelSpacing gives dY and dX; dZ is the median gap between
    consecutive ImagePositionPatient Z values.

    Validation before return (raises VolumeLoadError on failure):
      - All instances share the same SeriesInstanceUID
      - All instances share the same FrameOfReferenceUID
      - Slice-spacing variance < 0.01 mm²  (uniform stack)
      - pixel_array.dtype is integer (safety check; CBCT is int16)

    Parameters
    ----------
    client:
        Authenticated OrthancClient instance.
    study_instance_uid:
        DICOM StudyInstanceUID for the study to load.

    Returns
    -------
    LoadedVolume
        Fully assembled 3-D volume with metadata.
    """
    safe_study = _safe_uid(study_instance_uid)
    log.info("Loading volume for study %s", safe_study)

    # ── Step 1: pick the series with the most instances ───────────────────────
    all_series = await client.get_series_for_study(study_instance_uid)
    if not all_series:
        raise VolumeLoadError(
            f"Study {safe_study} has no series in Orthanc"
        )

    # Prefer CT modality; fall back to the most-instance series regardless
    ct_series = [s for s in all_series if s.modality.upper() == "CT"]
    candidate_series = ct_series if ct_series else all_series
    selected = max(candidate_series, key=lambda s: s.num_instances)

    series_uid = selected.series_instance_uid
    safe_series = _safe_uid(series_uid)
    log.info(
        "Study %s: selected series %s (%d instances, modality=%s)",
        safe_study,
        safe_series,
        selected.num_instances,
        selected.modality,
    )

    # ── Step 2: enumerate SOP Instance UIDs via QIDO ─────────────────────────
    # We use list_instances (lightweight QIDO) instead of fetching
    # series-level metadata, since each instance's full DICOM with all tags
    # is fetched individually via WADO-RS in step 3.
    instance_summaries = await client.list_instances(
        study_instance_uid, series_uid
    )
    if not instance_summaries:
        raise VolumeLoadError(
            f"Series {safe_series} has no instances"
        )

    sop_uids = [s.sop_instance_uid for s in instance_summaries]

    log.info(
        "Series %s: fetching %d instances",
        safe_series,
        len(sop_uids),
    )

    # ── Step 3: fetch each FULL DICOM instance and parse with pydicom ────────
    # WADO-RS instance retrieve returns a multipart/related body with the
    # complete DICOM Part-10 file (headers + pixel data). pydicom.dcmread
    # then exposes ImagePositionPatient, PixelSpacing, FrameOfReferenceUID,
    # etc. directly on the Dataset.
    @dataclass
    class _Slice:
        z: float
        ds: "pydicom.Dataset"

    slices: list[_Slice] = []
    seen_series_uids: set[str] = set()
    seen_for_uids: set[str] = set()

    for sop_uid in sop_uids:
        raw_dicom = await client.fetch_instance_full(
            study_instance_uid, series_uid, sop_uid
        )
        dicom_bytes = _multipart_to_bytes(raw_dicom)

        try:
            ds = pydicom.dcmread(io.BytesIO(dicom_bytes), force=True)
        except Exception as exc:  # noqa: BLE001
            raise VolumeLoadError(
                f"pydicom failed to parse instance {_safe_uid(sop_uid)}: {exc}"
            ) from exc

        # Collect consistency tags
        s_uid = _ds_str(ds, "SeriesInstanceUID")
        if s_uid:
            seen_series_uids.add(s_uid)

        for_uid = _ds_str(ds, "FrameOfReferenceUID")
        if for_uid:
            seen_for_uids.add(for_uid)

        pos = _parse_image_position(ds)
        if pos is None:
            # Cannot sort without position — skip instance with a warning
            log.warning(
                "Instance %s has no ImagePositionPatient — skipped",
                _safe_uid(sop_uid),
            )
            continue

        slices.append(_Slice(z=pos[2], ds=ds))

    if len(slices) == 0:
        raise VolumeLoadError(
            f"Series {safe_series}: no valid slices with ImagePositionPatient"
        )

    # ── Step 4: consistency checks ────────────────────────────────────────────

    # SeriesInstanceUID consistency
    if len(seen_series_uids) > 1:
        raise VolumeLoadError(
            f"Inconsistent SeriesInstanceUID in series {safe_series}: "
            f"found {len(seen_series_uids)} distinct values"
        )

    # FrameOfReferenceUID consistency
    if len(seen_for_uids) > 1:
        raise VolumeLoadError(
            f"Inconsistent FrameOfReferenceUID in series {safe_series}: "
            f"found {len(seen_for_uids)} distinct values"
        )

    frame_of_reference_uid = next(iter(seen_for_uids), "")
    if not frame_of_reference_uid:
        log.warning(
            "Series %s: FrameOfReferenceUID absent — SEG alignment will fail in 3b-2",
            safe_series,
        )

    # ── Step 5: sort slices by Z ascending ───────────────────────────────────
    slices.sort(key=lambda s: s.z)

    # Real per-slice SOPInstanceUID, same order as the sorted stack. Needed
    # by seg_writer.py to reference the actual source instances (plan P4.1/
    # P4.2) instead of fabricating new ones.
    source_sop_instance_uids = tuple(
        _ds_str(sl.ds, "SOPInstanceUID") for sl in slices
    )

    # ── Step 6: slice-spacing uniformity check ────────────────────────────────
    z_positions = [s.z for s in slices]
    if len(z_positions) >= 2:
        diffs = np.diff(z_positions)
        spacing_z = float(np.median(diffs))
        spacing_variance = float(np.var(diffs))

        if abs(spacing_z) < 1e-6:
            raise VolumeLoadError(
                f"Series {safe_series}: zero or near-zero slice spacing "
                f"({spacing_z:.6f} mm) — likely duplicate instances"
            )
        if spacing_variance > 0.01:
            raise VolumeLoadError(
                f"Series {safe_series}: non-uniform slice spacing "
                f"(variance={spacing_variance:.4f} mm²) — "
                "volume stack is inconsistent"
            )
    else:
        spacing_z = 1.0  # single-slice fallback (will warn in quality check)

    # ── Step 7: extract spacing and orientation from first slice ──────────────
    first_ds = slices[0].ds

    # Patient module — study-level demographics, identical across all
    # instances of one series. Copied through so a derived DICOM SEG can
    # carry the same Patient module as its source (plan P4.2). PHI: never
    # logged, never included in any exception message below.
    patient_id = _ds_str(first_ds, "PatientID")
    patient_name = _ds_str(first_ds, "PatientName")
    patient_birth_date = _ds_str(first_ds, "PatientBirthDate")
    patient_sex = _ds_str(first_ds, "PatientSex")

    pix_spacing = _parse_pixel_spacing(first_ds)
    if pix_spacing is None:
        log.warning(
            "Series %s: PixelSpacing absent — defaulting to 1.0 mm",
            safe_series,
        )
        spacing_y, spacing_x = 1.0, 1.0
    else:
        spacing_y, spacing_x = pix_spacing[0], pix_spacing[1]

    spacing_mm: tuple[float, float, float] = (
        abs(spacing_z),
        float(spacing_y),
        float(spacing_x),
    )

    first_pos = _parse_image_position(first_ds)
    origin_mm: tuple[float, float, float] = (
        (float(first_pos[2]), float(first_pos[1]), float(first_pos[0]))
        if first_pos
        else (0.0, 0.0, 0.0)
    )

    direction = _parse_orientation(first_ds) or (
        1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0
    )

    # ── Step 8: stack pixel arrays ────────────────────────────────────────────
    arrays: list[np.ndarray] = []
    for sl in slices:
        try:
            px = sl.ds.pixel_array
        except Exception as exc:  # noqa: BLE001
            raise VolumeLoadError(
                f"Failed to decode pixel data: {exc}"
            ) from exc
        arrays.append(px)

    volume = np.stack(arrays, axis=0)  # (Z, Y, X)

    # dtype validation
    if not np.issubdtype(volume.dtype, np.integer):
        raise VolumeLoadError(
            f"Series {safe_series}: pixel_array dtype {volume.dtype} is not "
            "integer — expected int16 for CBCT"
        )

    log.info(
        "Volume loaded: study=%s series=%s shape=%s dtype=%s spacing_mm=%s",
        safe_study,
        safe_series,
        volume.shape,
        volume.dtype,
        spacing_mm,
    )

    return LoadedVolume(
        pixel_array=volume,
        spacing_mm=spacing_mm,
        origin_mm=origin_mm,
        direction=direction,
        study_instance_uid=study_instance_uid,
        series_instance_uid=series_uid,
        frame_of_reference_uid=frame_of_reference_uid,
        source_sop_instance_uids=source_sop_instance_uids,
        patient_id=patient_id,
        patient_name=patient_name,
        patient_birth_date=patient_birth_date,
        patient_sex=patient_sex,
    )
