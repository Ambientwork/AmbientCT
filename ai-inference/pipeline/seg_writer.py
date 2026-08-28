"""
pipeline/seg_writer.py — numpy mask → DICOM SEG bytes  (Phase 3b-2)

Converts a SegmentationResult (numpy uint8 masks per AnatomyClass) to
DICOM Part-10 segmentation files using pydicom-seg's MultiClassWriter.

One DICOM SEG is produced per anatomy class, each in its own series so
that OHIF / Cornerstone3D can toggle visibility per anatomy independently.

Critical geometry invariants
  - FrameOfReferenceUID is COPIED from source_volume exactly — without
    this the SEG will not overlay in OHIF / Cornerstone3D.
  - StudyInstanceUID is COPIED from source_volume (same study).
  - SeriesInstanceUID is freshly generated (own series per SEG).
  - ImagePositionPatient per frame is computed from source geometry so
    PlanePositionSequence aligns to the source axial stack.

PHI-safe logging:
  - Never log full UIDs; truncate to first 16 chars + "..."
  - Never log mask content or shape statistics that could encode PHI

pydicom-seg compatibility note:
  pydicom_seg 0.4.1 imports from pydicom._storage_sopclass_uids which was
  removed in pydicom 3.x. This module installs a compatibility shim at
  import time so tests and production both work with pydicom >= 3.0.

SNOMED-CT codes used:
  Category "85756007" — Tissue (anatomy)    [SNOMED-CT core]
  Category "91609006" — Mandible            [SNOMED-CT core]
  Category "21082005" — Maxillary sinus structure  [SNOMED-CT core]
  Category "38199008" — Tooth structure      [SNOMED-CT core]
  Type    "23690000"  — Mandibular canal     [SNOMED-CT core]
  Type    "91609006"  — Mandible             [SNOMED-CT core / anatomic structure]
  Type    "21082005"  — Maxillary sinus structure  [SNOMED-CT core]
  Type    "38199008"  — Tooth structure       [SNOMED-CT core]
"""

from __future__ import annotations

# ── pydicom 3.x compatibility shim for pydicom-seg 0.4.1 ──────────────────────
import sys as _sys
import types as _types

if "pydicom._storage_sopclass_uids" not in _sys.modules:
    import pydicom.uid as _pydicom_uid

    _shim = _types.ModuleType("pydicom._storage_sopclass_uids")
    _shim.SegmentationStorage = _pydicom_uid.SegmentationStorage  # type: ignore[attr-defined]
    _sys.modules["pydicom._storage_sopclass_uids"] = _shim
# ──────────────────────────────────────────────────────────────────────────────

import io
import logging
from dataclasses import dataclass
from typing import Literal

import numpy as np
import pydicom
import pydicom.uid
import pydicom_seg
import SimpleITK as sitk

from pipeline.dicom_loader import LoadedVolume
from pipeline.exceptions import AiInferenceError

log = logging.getLogger("ai-inference.seg_writer")

# ── Types ─────────────────────────────────────────────────────────────────────

AnatomyClass = Literal[
    "mandible",
    "maxilla",
    "tooth",
    "mandibular_canal",
    "maxillary_sinus",
]


# ── Exceptions ────────────────────────────────────────────────────────────────


class SegWriterError(AiInferenceError):
    """Raised when DICOM SEG serialisation fails."""


# ── SNOMED-CT code tables ─────────────────────────────────────────────────────
# Source: SNOMED-CT International Edition (sct2_Concept_Full)
# Codes verified against DICOM PS 3.16 Annex D (Segmentation Property Categories
# and Types) which references the SNOMED-CT coding scheme (coding scheme "SCT").

_SNOMED_CATEGORY: dict[str, dict[str, str]] = {
    # SegmentedPropertyCategoryCodeSequence per anatomy class
    "mandibular_canal": {
        "CodeValue": "85756007",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Tissue",
    },
    "mandible": {
        "CodeValue": "91609006",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Mandible",
    },
    "maxilla": {
        "CodeValue": "21082005",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Maxillary sinus structure",
    },
    "maxillary_sinus": {
        "CodeValue": "21082005",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Maxillary sinus structure",
    },
    "tooth": {
        "CodeValue": "38199008",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Tooth",
    },
}

_SNOMED_TYPE: dict[str, dict[str, str]] = {
    # SegmentedPropertyTypeCodeSequence per anatomy class
    "mandibular_canal": {
        "CodeValue": "23690000",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Mandibular canal",
    },
    "mandible": {
        "CodeValue": "91609006",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Mandible",
    },
    "maxilla": {
        "CodeValue": "21082005",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Maxillary sinus structure",
    },
    "maxillary_sinus": {
        "CodeValue": "21082005",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Maxillary sinus structure",
    },
    "tooth": {
        "CodeValue": "38199008",
        "CodingSchemeDesignator": "SCT",
        "CodeMeaning": "Tooth",
    },
}

_ANATOMY_LABEL: dict[str, str] = {
    "mandibular_canal": "Mandibular Canal",
    "mandible": "Mandible",
    "maxilla": "Maxilla",
    "maxillary_sinus": "Maxillary Sinus",
    "tooth": "Tooth",
}


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class WrittenSegmentation:
    """A single class's DICOM SEG ready for upload."""

    anatomy_class: str  # AnatomyClass literal
    sop_instance_uid: str
    series_instance_uid: str  # freshly generated; each SEG is its own series
    dicom_bytes: bytes  # full DICOM Part-10 file ready for STOW-RS


# ── Internal helpers ──────────────────────────────────────────────────────────


def _safe_uid(uid: str) -> str:
    """PHI-safe UID truncation for logging."""
    return uid[:16] + "..." if len(uid) > 16 else uid


def _code_ds(code_dict: dict[str, str]) -> pydicom.Dataset:
    """Build a pydicom Dataset for a single-item code sequence entry."""
    ds = pydicom.Dataset()
    ds.CodeValue = code_dict["CodeValue"]
    ds.CodingSchemeDesignator = code_dict["CodingSchemeDesignator"]
    ds.CodeMeaning = code_dict["CodeMeaning"]
    return ds


def _build_template(
    anatomy_class: str,
    class_index: int,
    model_id: str,
    model_version: str,
    is_demo: bool = False,
) -> pydicom.Dataset:
    """
    Build the pydicom_seg template Dataset for one anatomy class.

    The template carries SegmentSequence + series-level metadata that
    pydicom_seg copies into the result. Series-level UIDs (SeriesInstanceUID,
    SOPInstanceUID) are overridden in _fix_uids() after the writer returns.

    is_demo (plan P1.3): when a demo/mock segmentation is deliberately
    persisted (AI_INFERENCE_PERSIST_DEMO_SEG=true, test stacks only), the
    resulting SEG must be unmistakably marked as synthetic INSIDE the DICOM
    file itself — a PACS browser showing a stored SEG has no other signal
    to distinguish it from a real result. SeriesDescription/ContentDescription
    get a distinctive suffix; SegmentAlgorithmName/ManufacturerModelName
    (set from model_id in _fix_uids_and_metadata) already carry the mock
    model id "ambientct-mock-v0" whenever the caller passes it through.
    """
    if anatomy_class not in _SNOMED_CATEGORY:
        raise SegWriterError(
            f"No SNOMED-CT codes configured for anatomy class '{anatomy_class}'"
        )

    template = pydicom.Dataset()

    label = _ANATOMY_LABEL.get(anatomy_class, anatomy_class)
    demo_suffix = " [DEMO DATA — Research Preview, Not for Diagnosis]" if is_demo else ""

    # Mandatory template fields read by writer_utils.copy_segmentation_template
    template.ClinicalTrialSeriesID = "Session1"
    template.ClinicalTrialTimePointID = "1"
    template.SeriesDescription = f"AmbientCT AI Segmentation — {label}{demo_suffix}"
    # SeriesNumber: large offset so SEG appears after CT series in ordered viewers
    template.SeriesNumber = str(9000 + class_index)
    template.ContentLabel = "SEGMENTATION"
    template.ContentDescription = f"AI segmentation: {label}{demo_suffix}"
    template.ContentCreatorName = "AmbientCT"
    template.BodyPartExamined = "JAW"

    # SegmentSequence — one segment per template (we produce one SEG per class)
    seg_entry = pydicom.Dataset()
    seg_entry.SegmentNumber = 1  # always 1 because one class per SEG file
    seg_entry.SegmentLabel = _ANATOMY_LABEL.get(anatomy_class, anatomy_class)
    seg_entry.SegmentAlgorithmType = "AUTOMATIC"
    seg_entry.SegmentAlgorithmName = f"AmbientCT-AI/{model_id}/{model_version}"

    # SNOMED-CT codes
    seg_entry.SegmentedPropertyCategoryCodeSequence = pydicom.Sequence(
        [_code_ds(_SNOMED_CATEGORY[anatomy_class])]
    )
    seg_entry.SegmentedPropertyTypeCodeSequence = pydicom.Sequence(
        [_code_ds(_SNOMED_TYPE[anatomy_class])]
    )

    template.SegmentSequence = pydicom.Sequence([seg_entry])
    return template


def _build_source_datasets(source_volume: LoadedVolume) -> list[pydicom.Dataset]:
    """
    Synthesise minimal per-slice pydicom Datasets for the source CT series.

    pydicom_seg's MultiClassWriter needs at minimum:
      - ImagePositionPatient  (to map each slice to the SimpleITK z-index)
      - FrameOfReferenceUID   (copied into the SEG via import_hierarchy)
      - StudyInstanceUID      (same)
      - SeriesInstanceUID     (goes into ReferencedSeriesSequence)
      - SOPInstanceUID        (per-frame reference)
      - SOPClassUID           (CT Image Storage = 1.2.840.10008.5.1.4.1.1.2)

    We reconstruct slice positions from origin_mm + index * spacing_mm[0].
    The direction normal vector (elements 6-8) gives the z-step direction.
    """
    origin = source_volume.origin_mm       # (z, y, x) in patient coords
    spacing = source_volume.spacing_mm     # (dz, dy, dx)
    direction = source_volume.direction    # 9-tuple: row, col, normal

    # The z-direction unit vector is the slice normal (elements [6], [7], [8])
    # expressed in patient coordinates (x, y, z order for ImagePositionPatient).
    normal_x = direction[6]
    normal_y = direction[7]
    normal_z = direction[8]

    # origin_mm is stored as (z_patient, y_patient, x_patient)
    # ImagePositionPatient is (x, y, z) in DICOM convention
    origin_x = origin[2]
    origin_y = origin[1]
    origin_z = origin[0]

    dz = spacing[0]  # slice thickness / step

    num_slices = source_volume.pixel_array.shape[0]

    # ImageOrientationPatient: first 6 elements of direction (row + col cosines)
    # stored as (Xx, Xy, Xz, Yx, Yy, Yz) — patient x/y/z for row/col directions
    iop = [
        f"{direction[0]:e}",
        f"{direction[1]:e}",
        f"{direction[2]:e}",
        f"{direction[3]:e}",
        f"{direction[4]:e}",
        f"{direction[5]:e}",
    ]

    source_datasets: list[pydicom.Dataset] = []
    for idx in range(num_slices):
        ds = pydicom.Dataset()
        ds.file_meta = pydicom.dataset.FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = pydicom.uid.ExplicitVRLittleEndian
        ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"  # CT

        ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"  # CT Image Storage
        ds.SOPInstanceUID = pydicom.uid.generate_uid()
        ds.StudyInstanceUID = source_volume.study_instance_uid
        ds.SeriesInstanceUID = source_volume.series_instance_uid
        ds.FrameOfReferenceUID = source_volume.frame_of_reference_uid
        ds.Modality = "CT"

        # Compute the patient-space origin of this slice
        pos_x = origin_x + idx * dz * normal_x
        pos_y = origin_y + idx * dz * normal_y
        pos_z = origin_z + idx * dz * normal_z
        ds.ImagePositionPatient = [f"{pos_x:e}", f"{pos_y:e}", f"{pos_z:e}"]
        ds.ImageOrientationPatient = iop

        rows, cols = source_volume.pixel_array.shape[1], source_volume.pixel_array.shape[2]
        ds.Rows = rows
        ds.Columns = cols
        ds.PixelSpacing = [f"{spacing[1]:e}", f"{spacing[2]:e}"]
        ds.SliceThickness = f"{spacing[0]:e}"

        source_datasets.append(ds)

    return source_datasets


def _numpy_to_sitk(
    mask: np.ndarray,
    source_volume: LoadedVolume,
) -> sitk.Image:
    """
    Convert a (Z, Y, X) uint8 binary mask to a SimpleITK Image with correct
    patient-space geometry so pydicom_seg produces correct PlanePositionSequence.

    SimpleITK convention:
      - SetOrigin: (x, y, z) in patient coordinates — maps to the *first* voxel
      - SetSpacing: (sx, sy, sz)
      - SetDirection: 3x3 row-major (Xx Xy Xz  Yx Yy Yz  Zx Zy Zz)
        where X=row, Y=col, Z=normal

    Our LoadedVolume stores:
      - origin_mm = (z_patient, y_patient, x_patient)
      - spacing_mm = (dz, dy, dx)
      - direction = 9-tuple (row_x, row_y, row_z, col_x, col_y, col_z, norm_x, norm_y, norm_z)
    """
    origin = source_volume.origin_mm
    spacing = source_volume.spacing_mm
    direction = source_volume.direction

    # sitk origin is (x, y, z)
    sitk_origin = (float(origin[2]), float(origin[1]), float(origin[0]))
    # sitk spacing is (sx, sy, sz)
    sitk_spacing = (float(spacing[2]), float(spacing[1]), float(spacing[0]))
    # sitk direction is row-major 3x3: row(x,y,z), col(x,y,z), norm(x,y,z)
    sitk_direction = tuple(float(v) for v in direction)

    # numpy mask is (Z, Y, X) — GetArrayFromImage uses (z, y, x) so we pass as-is
    mask_uint8 = mask.astype(np.uint8)
    sitk_img = sitk.GetImageFromArray(mask_uint8)
    sitk_img.SetOrigin(sitk_origin)
    sitk_img.SetSpacing(sitk_spacing)
    sitk_img.SetDirection(sitk_direction)
    return sitk_img


def _fix_uids_and_metadata(
    seg_ds: pydicom.Dataset,
    source_volume: LoadedVolume,
    class_index: int,
    model_id: str,
    model_version: str,
) -> tuple[str, str]:
    """
    Override UIDs and provenance fields in the written SEG Dataset.

    Returns (sop_instance_uid, series_instance_uid) — both freshly generated.

    This is called AFTER MultiClassWriter.write() because the writer
    initialises its own UIDs internally and we need to override them.
    """
    # Fresh UIDs: each SEG is its own series (separate from source CT)
    new_sop_uid = pydicom.uid.generate_uid()
    new_series_uid = pydicom.uid.generate_uid()

    seg_ds.SOPInstanceUID = new_sop_uid
    seg_ds.SeriesInstanceUID = new_series_uid
    seg_ds.file_meta.MediaStorageSOPInstanceUID = new_sop_uid

    # StudyInstanceUID must equal source (SEG lives in same study)
    seg_ds.StudyInstanceUID = source_volume.study_instance_uid

    # FrameOfReferenceUID MUST equal source — critical for OHIF overlay alignment
    seg_ds.FrameOfReferenceUID = source_volume.frame_of_reference_uid

    # SeriesNumber: large offset ensures SEG appears after CT in ordered viewers
    seg_ds.SeriesNumber = 9000 + class_index

    # ReferencedSeriesSequence → points to source CT series
    ref_series = pydicom.Dataset()
    ref_series.SeriesInstanceUID = source_volume.series_instance_uid
    seg_ds.ReferencedSeriesSequence = pydicom.Sequence([ref_series])

    # DerivationCodeSequence: "113076 | Segmentation" (DCM coding scheme)
    deriv_code = pydicom.Dataset()
    deriv_code.CodeValue = "113076"
    deriv_code.CodingSchemeDesignator = "DCM"
    deriv_code.CodeMeaning = "Segmentation"
    seg_ds.DerivationCodeSequence = pydicom.Sequence([deriv_code])

    # Contributing equipment / provenance
    seg_ds.SoftwareVersions = "AmbientCT AI Assist 0.2"
    seg_ds.Manufacturer = "AmbientCT"
    seg_ds.ManufacturerModelName = f"AmbientCT-AI/{model_id}"
    seg_ds.DeviceSerialNumber = "0"

    return new_sop_uid, new_series_uid


def _dataset_to_bytes(ds: pydicom.Dataset) -> bytes:
    """Serialise a pydicom Dataset to DICOM Part-10 bytes."""
    buf = io.BytesIO()
    pydicom.dcmwrite(buf, ds)
    return buf.getvalue()


# ── Public API ────────────────────────────────────────────────────────────────


def write_dicom_seg(
    *,
    source_volume: LoadedVolume,
    masks_by_class: dict[str, np.ndarray],
    model_id: str,
    model_version: str,
    is_demo: bool = False,
) -> list[WrittenSegmentation]:
    """
    Convert numpy binary masks to DICOM SEG Part-10 bytes.

    One DICOM SEG is produced per anatomy class in masks_by_class.
    The caller (orthanc_writer) uploads each to Orthanc via STOW-RS.

    Parameters
    ----------
    source_volume:
        The LoadedVolume from dicom_loader; provides geometry + UIDs.
    masks_by_class:
        dict mapping AnatomyClass string to a binary uint8 ndarray with
        shape (Z, Y, X) — same shape as source_volume.pixel_array.
        Non-zero voxels are treated as foreground.
    model_id, model_version:
        Written into SegmentAlgorithmName for provenance. Pass the mock
        model id ("ambientct-mock-v0") when is_demo=True so the SEG file
        itself carries that provenance, not just the API response.
    is_demo:
        Plan P1.3: marks the SEG as synthetic INSIDE the DICOM file
        (distinctive SeriesDescription/ContentDescription) so it can never
        be mistaken for a real result once stored in Orthanc. Only ever
        True when a demo result is deliberately persisted
        (AI_INFERENCE_PERSIST_DEMO_SEG=true) — the default demo path does
        not call this function at all.

    Returns
    -------
    list[WrittenSegmentation]
        One entry per class in masks_by_class.

    Raises
    ------
    SegWriterError
        On geometry mismatch, missing SNOMED codes, or pydicom-seg failure.
    """
    if not source_volume.frame_of_reference_uid:
        raise SegWriterError(
            "source_volume has no FrameOfReferenceUID — "
            "SEG overlay will be misaligned; aborting"
        )

    volume_shape = source_volume.pixel_array.shape
    log.info(
        "Building DICOM SEG for %d class(es), volume shape=%s",
        len(masks_by_class),
        volume_shape,
    )

    # Build minimal source DICOM datasets once (shared across all classes)
    source_datasets = _build_source_datasets(source_volume)

    results: list[WrittenSegmentation] = []

    for class_index, (anatomy_class, mask) in enumerate(masks_by_class.items()):
        # Validate mask shape
        if mask.shape != volume_shape:
            raise SegWriterError(
                f"Mask for '{anatomy_class}' has shape {mask.shape} but "
                f"volume shape is {volume_shape}"
            )

        if not np.any(mask):
            log.warning(
                "Mask for anatomy class '%s' is entirely zero — skipping",
                anatomy_class,
            )
            continue

        log.info("Encoding SEG for class '%s' (index %d)", anatomy_class, class_index)

        try:
            template = _build_template(
                anatomy_class=anatomy_class,
                class_index=class_index,
                model_id=model_id,
                model_version=model_version,
                is_demo=is_demo,
            )

            # Convert numpy mask to SimpleITK with correct patient geometry
            sitk_mask = _numpy_to_sitk(mask, source_volume)

            writer = pydicom_seg.MultiClassWriter(
                template=template,
                inplane_cropping=False,
                skip_empty_slices=True,
                skip_missing_segment=True,
            )
            seg_ds = writer.write(sitk_mask, source_datasets)

        except (ValueError, RuntimeError, KeyError) as exc:
            raise SegWriterError(
                f"pydicom-seg failed for class '{anatomy_class}': {exc}"
            ) from exc

        # Override UIDs and provenance metadata
        sop_uid, series_uid = _fix_uids_and_metadata(
            seg_ds=seg_ds,
            source_volume=source_volume,
            class_index=class_index,
            model_id=model_id,
            model_version=model_version,
        )

        dicom_bytes = _dataset_to_bytes(seg_ds)
        log.info(
            "SEG for class '%s' encoded: %d bytes, series=%.16s...",
            anatomy_class,
            len(dicom_bytes),
            series_uid,
        )

        results.append(
            WrittenSegmentation(
                anatomy_class=anatomy_class,
                sop_instance_uid=sop_uid,
                series_instance_uid=series_uid,
                dicom_bytes=dicom_bytes,
            )
        )

    return results
