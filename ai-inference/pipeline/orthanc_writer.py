"""
pipeline/orthanc_writer.py — Orchestrator: write DICOM SEG + upload to Orthanc  (Phase 3b-2)

Takes a list of WrittenSegmentation (from seg_writer.write_dicom_seg) and
POSTs each to Orthanc via STOW-RS.  Per-SEG failures are caught, logged
(PHI-safe), and reflected in UploadedSegmentation.success / error_message.
A top-level connection failure (OrthancNetworkError) is re-raised immediately.

PHI-safe logging:
  - Never log full UIDs
  - error_message contains only class names / exception type names, no PHI
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from pipeline.exceptions import AiInferenceError
from pipeline.orthanc_client import (
    OrthancClient,
    OrthancNetworkError,
    StowRsRejected,
)
from pipeline.seg_writer import WrittenSegmentation

log = logging.getLogger("ai-inference.orthanc_writer")


# ── Exceptions ────────────────────────────────────────────────────────────────


class OrthanWriterError(AiInferenceError):
    """Raised for unrecoverable orchestration failures in orthanc_writer."""


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class UploadedSegmentation:
    """Result of uploading one WrittenSegmentation to Orthanc via STOW-RS."""

    anatomy_class: str  # AnatomyClass literal
    sop_instance_uid: str
    series_instance_uid: str
    success: bool
    error_message: str | None = field(default=None)
    # error_message is sanitised: contains only class name / exception type,
    # never PHI (no UIDs, no patient data, no mask content)


# ── Internal helpers ──────────────────────────────────────────────────────────


def _safe_class(anatomy_class: str) -> str:
    """Return anatomy class for log messages (never PHI)."""
    return anatomy_class


# ── Public API ────────────────────────────────────────────────────────────────


async def upload_segmentations(
    client: OrthancClient,
    written: list[WrittenSegmentation],
    study_uid: str,
) -> list[UploadedSegmentation]:
    """
    Upload each WrittenSegmentation to Orthanc via STOW-RS.

    Behaviour
    ---------
    - Iterates written in order, calling ``client.stow_rs_post`` for each.
    - On per-SEG failure (4xx, StowRsRejected, OrthancServerError, etc.):
      logs a warning and records the failure in the result; continues to the
      next SEG.
    - On OrthancNetworkError (Orthanc unreachable): re-raises immediately.
      This is a top-level connection failure affecting all SEGs, so continuing
      would just produce N identical failures.

    Parameters
    ----------
    client:
        Authenticated OrthancClient instance (already open).
    written:
        List of WrittenSegmentation produced by ``write_dicom_seg``.
    study_uid:
        DICOM StudyInstanceUID — used as the STOW-RS study context.

    Returns
    -------
    list[UploadedSegmentation]
        One entry per input, in the same order.

    Raises
    ------
    OrthancNetworkError
        If Orthanc is unreachable (transport-level failure).
    OrthanWriterError
        On unexpected internal failures not related to individual SEG upload.
    """
    results: list[UploadedSegmentation] = []

    for seg in written:
        cls_label = _safe_class(seg.anatomy_class)
        try:
            await client.stow_rs_post(
                dicom_bytes=seg.dicom_bytes,
                study_uid=study_uid,
            )
            log.info(
                "STOW-RS upload succeeded for anatomy class '%s'",
                cls_label,
            )
            results.append(
                UploadedSegmentation(
                    anatomy_class=seg.anatomy_class,
                    sop_instance_uid=seg.sop_instance_uid,
                    series_instance_uid=seg.series_instance_uid,
                    success=True,
                    error_message=None,
                )
            )

        except OrthancNetworkError:
            # Connection-level failure — Orthanc is unreachable.
            # Re-raise immediately: no point continuing with remaining SEGs.
            log.error(
                "Orthanc unreachable during STOW-RS for class '%s' — aborting",
                cls_label,
            )
            raise

        except StowRsRejected as exc:
            log.warning(
                "STOW-RS rejected SEG for class '%s': %d instance(s) failed",
                cls_label,
                exc.failed_count,
            )
            results.append(
                UploadedSegmentation(
                    anatomy_class=seg.anatomy_class,
                    sop_instance_uid=seg.sop_instance_uid,
                    series_instance_uid=seg.series_instance_uid,
                    success=False,
                    error_message=f"StowRsRejected: {exc.failed_count} instance(s) rejected",
                )
            )

        except AiInferenceError as exc:
            # Typed pipeline error (OrthancClientError, OrthancServerError, etc.)
            error_type = type(exc).__name__
            log.warning(
                "STOW-RS failed for class '%s': %s",
                cls_label,
                error_type,
            )
            results.append(
                UploadedSegmentation(
                    anatomy_class=seg.anatomy_class,
                    sop_instance_uid=seg.sop_instance_uid,
                    series_instance_uid=seg.series_instance_uid,
                    success=False,
                    error_message=f"{error_type}: upload failed for class '{cls_label}'",
                )
            )

    return results
