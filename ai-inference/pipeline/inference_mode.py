"""
pipeline/inference_mode.py — single source of truth for AI inference mode
resolution  (Phase 3b-2, plan §8 P1.2)

resolve_inference_mode() is the ONLY place that decides demo | real |
unavailable. main.py's health endpoint and job-start path both call it
fresh (no caching, no import-time evaluation) so a health check or a new
job always reflects the current filesystem/env state — e.g. weights that
appear on disk after the service started are picked up on the very next
health call or job start, without a container restart.

Modes (plan §3.1)
──────────────────
  demo         AI_INFERENCE_DEMO_MODE=true
  real         demo off AND AI_MODEL_PATH points at a valid, UNPACKED
               nnU-Net model folder (dataset.json + plans.json + at least
               one fold_* subdirectory)
  unavailable  demo off AND the model is missing or invalid — this
               includes a configured-but-missing path AND a path that
               exists but is not a valid unpacked folder (e.g. the
               distributed .zip artifact, which must never be handed to
               nnU-Net directly).

A configured-but-missing model must never silently produce synthetic,
clinically-plausible output — that is exactly what `unavailable` guards
against. `demo` is the only mode that runs the mock predictor, and it is
only reached by an explicit opt-in (AI_INFERENCE_DEMO_MODE=true).

validate_model_folder() is exported so pipeline/segmentation.py can reuse
the exact same structural check as a defense-in-depth guard immediately
before handing a path to nnU-Net (belt-and-braces: the primary gate is
still `unavailable` never reaching run_segmentation() at all).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# ── Model identifiers ──────────────────────────────────────────────────────
# These are provenance strings written into DICOM SEG SegmentAlgorithmName /
# ManufacturerModelName (seg_writer.py) and into AiSourceMetadata — never
# clinical claims, just which predictor produced the output.

DEMO_MODEL_ID = "ambientct-mock-v0"
DEMO_MODEL_VERSION = "0.0.0-3b-2-demo"

REAL_MODEL_ID = "dental-segmentator"
REAL_MODEL_VERSION = "v1.0.0-alpha"

_REQUIRED_MODEL_FILES: tuple[str, ...] = ("dataset.json", "plans.json")

# Reason codes are short, PHI-free, machine-readable tokens (never a
# formatted sentence containing a filesystem path with patient context —
# there is none here, but the convention is kept for consistency with the
# rest of the pipeline's PHI-safe logging discipline).
REASON_OK = "ok"
REASON_DEMO_FORCED = "demo_mode_forced"
REASON_MODEL_PATH_NOT_CONFIGURED = "model_path_not_configured"
REASON_MODEL_PATH_MISSING = "model_path_missing"
REASON_MODEL_PATH_IS_FILE = "model_path_is_file_not_unpacked_folder"
REASON_MODEL_PATH_NOT_A_DIRECTORY = "model_path_not_a_directory"
REASON_MODEL_FOLDER_MISSING_FILES = "model_folder_missing_required_files"
REASON_MODEL_FOLDER_MISSING_FOLD_DIR = "model_folder_missing_fold_dir"


@dataclass(frozen=True)
class InferenceModeDecision:
    """Result of resolve_inference_mode() — the pipeline's single source of
    truth for what predictor to use and how to report it.

    Attributes
    ----------
    mode:
        "demo" | "real" | "unavailable"
    model_id, model_version:
        Provenance identifiers. None for `unavailable` (no model is active).
    model_path:
        The resolved, validated nnU-Net folder for `real`; the (possibly
        invalid or non-existent) configured path for `unavailable` when one
        was configured; None for `demo` or when nothing was configured.
    reason:
        Short machine-readable code. REASON_OK for `real`, a specific
        REASON_* for `unavailable`, REASON_DEMO_FORCED for `demo`.
    device:
        Requested inference device ("cpu" | "mps"), unrelated to mode.
    """

    mode: str
    model_id: str | None
    model_version: str | None
    model_path: Path | None
    reason: str
    device: str

    @property
    def is_demo(self) -> bool:
        return self.mode == "demo"


def validate_model_folder(path: Path) -> tuple[bool, str]:
    """Structural validation of an UNPACKED nnU-Net model folder.

    A valid folder has ``dataset.json``, ``plans.json``, and at least one
    ``fold_*`` subdirectory. This intentionally does NOT check weight file
    contents (checkpoint_final.pth) or hash-verify anything — that level of
    verification belongs to scripts/download-models.sh (plan §12 P5.1).
    Here we only need to reject the two most common misconfigurations:
    a missing path, and the distributed .zip file handed to AI_MODEL_PATH
    as-is (a plain file passes a bare ``.exists()`` check but explodes deep
    inside nnU-Net — this is blocker #3 from the plan).

    Returns
    -------
    (is_valid, reason) — reason is one of the REASON_* constants above.
    """
    if not path.exists():
        return False, REASON_MODEL_PATH_MISSING
    if path.is_file():
        return False, REASON_MODEL_PATH_IS_FILE
    if not path.is_dir():
        return False, REASON_MODEL_PATH_NOT_A_DIRECTORY

    missing = [f for f in _REQUIRED_MODEL_FILES if not (path / f).is_file()]
    if missing:
        return False, REASON_MODEL_FOLDER_MISSING_FILES

    has_fold_dir = any(
        child.is_dir() and child.name.startswith("fold_") for child in path.iterdir()
    )
    if not has_fold_dir:
        return False, REASON_MODEL_FOLDER_MISSING_FOLD_DIR

    return True, REASON_OK


def resolve_inference_mode(
    *,
    demo_mode_env: bool | None = None,
    model_path_env: str | None = None,
    device_env: str | None = None,
) -> InferenceModeDecision:
    """Resolve demo | real | unavailable fresh from env + a cheap stat check.

    Called with no arguments in production (main.py health + job-start);
    the ``*_env`` overrides exist purely so tests can exercise every branch
    without mutating process environment via monkeypatch.

    This function performs at most a handful of ``Path.exists()`` /
    ``Path.is_dir()`` / ``Path.iterdir()`` stat calls — cheap enough to run
    on every health check and every job start, which is the whole point:
    no import-time caching, no stale health after weights appear on disk.
    """
    demo = (
        demo_mode_env
        if demo_mode_env is not None
        else os.environ.get("AI_INFERENCE_DEMO_MODE", "false").strip().lower() == "true"
    )
    raw_path = (
        model_path_env
        if model_path_env is not None
        else os.environ.get("AI_MODEL_PATH", "").strip()
    )
    device = (
        device_env
        if device_env is not None
        else os.environ.get("AI_INFERENCE_DEVICE", "cpu").strip().lower()
    )

    if demo:
        return InferenceModeDecision(
            mode="demo",
            model_id=DEMO_MODEL_ID,
            model_version=DEMO_MODEL_VERSION,
            model_path=None,
            reason=REASON_DEMO_FORCED,
            device=device,
        )

    if not raw_path:
        return InferenceModeDecision(
            mode="unavailable",
            model_id=None,
            model_version=None,
            model_path=None,
            reason=REASON_MODEL_PATH_NOT_CONFIGURED,
            device=device,
        )

    model_path = Path(raw_path)
    is_valid, reason = validate_model_folder(model_path)
    if not is_valid:
        return InferenceModeDecision(
            mode="unavailable",
            model_id=None,
            model_version=None,
            model_path=model_path,
            reason=reason,
            device=device,
        )

    return InferenceModeDecision(
        mode="real",
        model_id=REAL_MODEL_ID,
        model_version=REAL_MODEL_VERSION,
        model_path=model_path,
        reason=REASON_OK,
        device=device,
    )
