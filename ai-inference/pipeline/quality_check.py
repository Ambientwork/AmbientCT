"""
pipeline/quality_check.py — Input quality checks for CBCT volumes  (Phase 3b-1)

Replaces the Phase 3a placeholder with real checks against a LoadedVolume.

In 3b-1 this is purely informational: we log warnings but never reject a
volume.  Rejection logic (Pass / Warn / Reject + reason) is deferred to 3b-2
once we have calibrated thresholds from real scanner data.

Deferred to 3b-2:
  - HU calibration check (beam-hardening artifacts offset the HU range)
  - Extreme slice-count handling (> 800 slices → streaming approach)
  - Scanner/protocol whitelist (Manufacturer, ManufacturerModelName OOD check)
  - Mahalanobis-distance OOD detection
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

import numpy as np

from pipeline.dicom_loader import LoadedVolume

log = logging.getLogger("ai-inference.quality_check")

# Typical CBCT HU range: air ~ -1000, cortical bone ~ 2000–3000, metal > 3000
_CBCT_HU_MIN = -1100.0
_CBCT_HU_MAX = 4096.0

# Spacing (mm): anything outside these bounds is suspicious
_SPACING_MIN_MM = 0.05
_SPACING_MAX_MM = 2.0

# Isotropic threshold: all three spacing components within 0.05 mm of each other
_ISOTROPY_TOLERANCE_MM = 0.05


@dataclass
class QualityReport:
    """
    Summary of basic volume quality metrics.

    All checks are informational in 3b-1 — no volume is rejected.
    Rejection thresholds are intentionally left for 3b-2.
    """

    voxel_count: int
    spacing_mm: tuple[float, float, float]
    dtype_name: str
    isotropic: bool
    in_expected_range: bool
    warnings: list[str] = field(default_factory=list)


def check_volume_quality(vol: LoadedVolume) -> QualityReport:
    """
    Run basic quality checks on a loaded CBCT volume.

    Returns a QualityReport — never raises.  Warnings are appended to
    ``report.warnings`` and logged at WARNING level.

    Parameters
    ----------
    vol:
        The volume to inspect.

    Returns
    -------
    QualityReport
        Informational quality summary.
    """
    warnings: list[str] = []
    dz, dy, dx = vol.spacing_mm

    # ── Isotropy check ────────────────────────────────────────────────────────
    spacing_arr = np.array([dz, dy, dx])
    spacing_mean = float(np.mean(spacing_arr))
    max_deviation = float(np.max(np.abs(spacing_arr - spacing_mean)))
    isotropic = max_deviation < _ISOTROPY_TOLERANCE_MM

    if not isotropic:
        msg = (
            f"Anisotropic spacing detected: (dZ={dz:.3f}, dY={dy:.3f}, dX={dx:.3f}) mm — "
            f"max deviation from mean ({spacing_mean:.3f} mm) = {max_deviation:.3f} mm. "
            "Resampling will be needed before model inference (Phase 3b-2)."
        )
        warnings.append(msg)
        log.warning("Quality: %s", msg)

    # ── Spacing range check ───────────────────────────────────────────────────
    for label, sp in (("dZ", dz), ("dY", dy), ("dX", dx)):
        if sp < _SPACING_MIN_MM or sp > _SPACING_MAX_MM:
            msg = (
                f"Suspicious voxel spacing {label}={sp:.3f} mm "
                f"(expected {_SPACING_MIN_MM}–{_SPACING_MAX_MM} mm). "
                "Possible out-of-distribution acquisition."
            )
            warnings.append(msg)
            log.warning("Quality: %s", msg)

    # ── HU range check ────────────────────────────────────────────────────────
    pmin = float(vol.pixel_array.min())
    pmax = float(vol.pixel_array.max())
    in_range = (_CBCT_HU_MIN <= pmin) and (pmax <= _CBCT_HU_MAX)

    if not in_range:
        msg = (
            f"Pixel value range [{pmin:.0f}, {pmax:.0f}] outside expected "
            f"CBCT HU range [{_CBCT_HU_MIN:.0f}, {_CBCT_HU_MAX:.0f}]. "
            "Check for metal artifacts or non-CT modality."
        )
        warnings.append(msg)
        log.warning("Quality: %s", msg)

    # ── Slice count sanity ────────────────────────────────────────────────────
    z_count = vol.pixel_array.shape[0]
    if z_count < 10:
        msg = (
            f"Very few slices ({z_count}) — may not be a full CBCT volume. "
            "Scout or localiser images should be excluded."
        )
        warnings.append(msg)
        log.warning("Quality: %s", msg)
    elif z_count > 800:
        msg = (
            f"Large slice count ({z_count}) — memory usage may exceed budget. "
            "Streaming inference deferred to Phase 3b-2."
        )
        warnings.append(msg)
        log.warning("Quality: %s", msg)

    report = QualityReport(
        voxel_count=int(vol.pixel_array.size),
        spacing_mm=vol.spacing_mm,
        dtype_name=str(vol.pixel_array.dtype),
        isotropic=isotropic,
        in_expected_range=in_range,
        warnings=warnings,
    )

    if not warnings:
        log.info(
            "Quality check passed: voxels=%d dtype=%s spacing=%s isotropic=%s",
            report.voxel_count,
            report.dtype_name,
            report.spacing_mm,
            report.isotropic,
        )

    return report
