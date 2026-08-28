"""
pipeline/segmentation.py — nnU-Net mandibular canal inference  (Phase 3b-2)

Provides run_segmentation(), the async entry-point that _run_pipeline in
main.py will call.  The old run_mock_segmentation() shim is preserved so
main.py needs no modification at this stage; the integrator replaces the
call-site in Stage 4 when they wire up 3b-2.

Design notes
────────────
* Lazy torch import — torch is only imported inside _load_predictor() so the
  module can be imported (and tests can run) without torch installed.
* Module-level cache — _PREDICTOR_CACHE is a dict keyed by
  (mode, model_path, device) so a config change (different model path,
  different device) can never return a stale predictor loaded under a
  different configuration (plan §12 P5.2). Subsequent calls with the same
  key reuse the cached object.
* Load off the event loop — the actual predictor load (cache miss) runs
  inside asyncio.to_thread() so a slow first real-model load never blocks
  the FastAPI event loop / other in-flight requests (plan §12 P5.2).
* MPS → CPU fallback — attempted automatically; RuntimeError containing
  "MPS", "Placeholder", or "Operator" triggers the retry on CPU.
* Memory watchdog — _RssWatchdog polls psutil every 200 ms in an asyncio
  task running concurrently with the inference coroutine.  When RSS delta
  exceeds the budget it cancels the *asyncio* inference task (cooperative
  cancellation) and raises MemoryBudgetExceeded. IMPORTANT — this is
  OBSERVATIONAL, not a hard kill: cancelling an asyncio.to_thread() task
  does not stop the underlying OS thread, which keeps running (and keeps
  holding whatever memory it already allocated) until the blocking call it
  is in returns on its own. The real hard memory boundary is the Docker
  `mem_limit` (plan §3.3 / §12 P5.4) — the watchdog only gives the API a
  faster, cleaner "failed" response and a log line; it does not guarantee
  the process's memory footprint actually shrinks. True process-level
  kill-on-breach requires moving inference into its own OS process that the
  parent can SIGKILL, which is tracked as an open follow-up (plan §12 P5.4 /
  §17.8), not implemented in this phase.
* Sliding-window inference — nnUNetPredictor.predict_from_array with
  tile_step_size=0.9 and mirroring/TTA disabled, matching the documented
  CPU memory compromise (plan §12 P5.3; see also MODEL_CARD.md).
* Confidence — mean softmax probability over foreground voxels of the canal
  class, computed from the raw softmax output BEFORE binarisation.
* Label filter — only the canal label (env AI_INFERENCE_CANAL_LABEL,
  defaulting to pipeline.inference_mode.REAL_MODEL_CANAL_LABEL == 5, the
  DentalSegmentator model's own label scheme — see MODEL_CARD.md) is
  extracted from the multi-class label map. The default was previously 1,
  which is the model's MAXILLA label, not the canal — a stock deployment
  would have silently extracted the wrong anatomy (plan §12 P5.3, addendum
  §18.3, confirmed critical).
* Demo / mock mode — the caller decides via the explicit `demo` keyword
  argument to run_segmentation(); this module does NOT read
  AI_INFERENCE_DEMO_MODE itself (Phase 3b-2 P1.2 fix: main.py's
  pipeline.inference_mode.resolve_inference_mode() is the single source of
  truth for demo/real/unavailable, and passes its decision down explicitly
  so this module can never diverge from what health() reported). When
  demo=True, a _MockPredictor is used: its output is a deterministic
  ~3-mm-radius tube along a fixed parabolic arch curve inside the volume —
  clearly synthetic but produces valid DICOM SEG. When demo=False, a model
  MUST be configured and structurally valid (see
  pipeline.inference_mode.validate_model_folder) — there is no silent
  fallback to the mock predictor here.
* PHI-safe logging — volume content is never logged; shape/dtype/device/time
  are fine.

Env vars consumed (set by Agent A / infra):
  AI_MODEL_PATH              path to the VALIDATED, UNPACKED nnU-Net model
                             directory (dataset.json + plans.json +
                             fold_*/checkpoint_final.pth) — a .zip path is
                             rejected upstream by resolve_inference_mode(),
                             never reaches this module in normal operation.
  AI_INFERENCE_DEVICE        "mps" | "cpu"  (default: "cpu" — plan §3.3: the
                             resilient default for the linux/amd64 Docker
                             path; "mps" only applies on a native macOS
                             dev host, never promised inside the container)
  AI_INFERENCE_CANAL_LABEL   int label for mandibular canal
                             (default: pipeline.inference_mode.
                             REAL_MODEL_CANAL_LABEL == 5)
  PYTORCH_ENABLE_MPS_FALLBACK=1  set by Agent A; handles most MPS ops auto

  AI_INFERENCE_PATCH_SIZE is intentionally NOT consumed here (removed in
  plan §12 P5.3): nnU-Net's sliding-window patch size is fixed by the
  trained model's plans.json at initialize_from_trained_model_folder() time
  and is not a supported nnUNetPredictor constructor override — the env var
  reached only a log line and never affected inference (addendum §18.1,
  blocker #5). Memory is instead bounded via tile_step_size / the RSS
  watchdog / the Docker mem_limit, not a patch-size knob that does not
  exist in the underlying library's public API.

  AI_INFERENCE_DEMO_MODE is intentionally NOT read here — see `demo` kwarg.

Output contract for Agent C (seg_writer.py / DICOM SEG):
  SegmentationResult.masks_by_class["mandibular_canal"]
      dtype=uint8, values 0/1, shape == volume.pixel_array.shape
  SegmentationResult.confidence_by_class["mandibular_canal"]
      float in [0, 1]
  Geometry (spacing_mm, origin_mm, direction, frame_of_reference_uid)
  is NOT carried in SegmentationResult — Agent C reads it from the original
  LoadedVolume that was passed to run_segmentation().
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Literal

import numpy as np
import psutil

from pipeline.dicom_loader import LoadedVolume
from pipeline.exceptions import MemoryBudgetExceeded, ModelLoadError
from pipeline.inference_mode import REAL_MODEL_CANAL_LABEL, validate_model_folder

log = logging.getLogger("ai-inference.segmentation")

# ── Anatomy class literal type (mirrors types.ts AnatomyClass) ────────────────

AnatomyClass = Literal[
    "mandible",
    "maxilla",
    "tooth",
    "mandibular_canal",
    "maxillary_sinus",
]

_CANAL_CLASS: AnatomyClass = "mandibular_canal"

# ── Module-level predictor cache ──────────────────────────────────────────────
#
# Keyed by (kind, model_path, device) rather than a single bare slot, so a
# config change between calls — a different AI_MODEL_PATH, a different
# device — cannot silently return a predictor loaded under a *different*
# configuration (plan §12 P5.2). "demo" always maps to the same fixed key
# regardless of model_path/device since the mock predictor ignores both.

PredictorKey = tuple[str, str, str]  # (kind, model_path_str, device)

_DEMO_CACHE_KEY: PredictorKey = ("demo", "", "cpu")

_PREDICTOR_CACHE: dict[PredictorKey, object] = {}


# ── Result dataclass ──────────────────────────────────────────────────────────


@dataclass
class SegmentationResult:
    """Output of a single inference run.

    Holds binary masks per anatomy class.  Geometry is preserved by reusing
    the source LoadedVolume's spacing/origin/direction/frame_of_reference_uid,
    which is critical for DICOM SEG generation in seg_writer.py.

    Agent C reads geometry directly from the LoadedVolume; this dataclass
    carries only masks and per-class statistics.

    Attributes
    ----------
    masks_by_class:
        Binary uint8 ndarray per anatomy class.  Shape == volume.pixel_array.shape.
        Values: 0 (background) or 1 (foreground).
    confidence_by_class:
        Mean softmax probability over foreground voxels for each class.
        Typical range 0.7–0.95 for a well-trained model.
    inference_seconds:
        Wall-clock time for the forward pass (not including model load).
    peak_memory_mb:
        Peak RSS delta in MB relative to the pre-inference baseline.
    device:
        Actual device used: "mps" or "cpu".
    """

    masks_by_class: dict[AnatomyClass, np.ndarray]
    confidence_by_class: dict[AnatomyClass, float]
    inference_seconds: float
    peak_memory_mb: int
    device: str


# ── Mock predictor (no torch required) ───────────────────────────────────────


class _MockPredictor:
    """Deterministic fake predictor.  Produces a parabolic-arch tube mask.

    The tube approximates the mandibular canal arch: a parabola in the X-Z
    plane centred at mid-Y, with ~3 mm radius (3 voxel radius at 1 mm/vox).
    Output is always a dict with key "mandibular_canal" and value:
      (label_map: uint8 ndarray, softmax_canal: float32 ndarray)
    where softmax_canal[z, y, x] is a plausible probability in [0, 1].
    """

    def __init__(self, label_for_canal: int = 1) -> None:
        self.label_for_canal = label_for_canal

    def predict(
        self,
        pixel_array: np.ndarray,
        canal_label: int,
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return (label_map uint8, softmax_canal float32) for pixel_array.

        Parameters
        ----------
        pixel_array:
            Shape (Z, Y, X), any integer dtype.
        canal_label:
            Integer label ID to use for the canal in the label map.

        Returns
        -------
        label_map:
            uint8, same shape as pixel_array, values 0 or canal_label.
        softmax_canal:
            float32, same shape, values in (0, 1).
        """
        Z, Y, X = pixel_array.shape

        # Parabolic arch: x as independent variable, z = a*(x - cx)^2 + z_base
        cx = X / 2.0
        z_base = Z * 0.35   # arch bottom at 35 % of depth
        a = Z * 0.15 / ((X / 2.0) ** 2)  # opens upward, apex at z_base

        # Build coordinate grids
        zg, yg, xg = np.mgrid[0:Z, 0:Y, 0:X]

        # Arch centreline at each x: z_arch, y_arch = Y/2
        z_arch = a * (xg - cx) ** 2 + z_base
        y_arch = Y / 2.0

        # Tube radius ~3 voxels (or 10 % of min dimension, whichever smaller)
        radius = max(2.0, min(3.0, min(Z, Y, X) * 0.10))

        # Distance from each voxel to the arch centreline (in YZ-plane per x)
        dist_sq = (zg - z_arch) ** 2 + (yg - y_arch) ** 2
        inside = dist_sq <= radius ** 2

        label_map = np.zeros((Z, Y, X), dtype=np.uint8)
        label_map[inside] = 1  # binarised canal; caller remaps to canal_label

        # Softmax-like probability: 0.85 inside, falloff outside
        softmax_canal = np.where(inside, 0.85, 0.02).astype(np.float32)
        # Add minor spatial gradient so the values aren't perfectly constant
        gradient = 1.0 - np.sqrt(dist_sq) / (radius * 4.0 + 1.0)
        softmax_canal = np.clip(softmax_canal * gradient, 0.01, 0.98).astype(np.float32)
        softmax_canal[inside] = np.clip(softmax_canal[inside], 0.75, 0.98)

        return label_map, softmax_canal


def _make_mock_predictor(label_for_canal: int = 1) -> _MockPredictor:
    """Return a callable that produces a deterministic fake segmentation.

    Used when AI_MODEL_PATH is unset or the file does not exist, or when
    AI_INFERENCE_DEMO_MODE=true.  Output: a thin tube along the mandibular
    arch just so DICOM SEG generation downstream has something to write.

    Parameters
    ----------
    label_for_canal:
        The integer label ID the mock will assign to canal voxels.

    Returns
    -------
    _MockPredictor
        Instance with .predict(pixel_array, canal_label) method.
    """
    return _MockPredictor(label_for_canal=label_for_canal)


# ── RSS watchdog ──────────────────────────────────────────────────────────────


class _RssWatchdog:
    """Async task that polls process RSS every poll_interval_s seconds.

    Raises MemoryBudgetExceeded if the delta from baseline exceeds budget_mb.
    Cancels the target inference task on breach (cooperative cancellation via
    asyncio.Task.cancel()).

    Usage::

        watchdog = _RssWatchdog(budget_mb=6144)
        async with watchdog.guard(inference_task):
            ...
    """

    def __init__(
        self,
        budget_mb: int,
        poll_interval_s: float = 0.2,
    ) -> None:
        self._budget_mb = budget_mb
        self._poll_interval_s = poll_interval_s
        self._baseline_bytes: int = 0
        self._peak_bytes: int = 0
        self._proc = psutil.Process()

    def snapshot_baseline(self) -> None:
        """Record the RSS baseline immediately before inference starts."""
        self._baseline_bytes = self._proc.memory_info().rss
        self._peak_bytes = self._baseline_bytes

    @property
    def peak_delta_mb(self) -> int:
        """Peak RSS delta from baseline in MB, measured so far."""
        return max(0, (self._peak_bytes - self._baseline_bytes) // (1024 * 1024))

    async def _poll_loop(self, inference_task: asyncio.Task) -> None:  # type: ignore[type-arg]
        """Poll RSS and cancel inference_task if budget is breached."""
        budget_bytes = self._budget_mb * 1024 * 1024
        try:
            while not inference_task.done():
                await asyncio.sleep(self._poll_interval_s)
                try:
                    current_rss = self._proc.memory_info().rss
                except psutil.NoSuchProcess:
                    break
                self._peak_bytes = max(self._peak_bytes, current_rss)
                delta = current_rss - self._baseline_bytes
                if delta > budget_bytes:
                    log.warning(
                        "Memory budget exceeded: delta=%.0f MB > budget=%d MB — "
                        "cancelling inference task",
                        delta / (1024 * 1024),
                        self._budget_mb,
                    )
                    inference_task.cancel()
                    return
        except asyncio.CancelledError:
            # Watchdog itself was cancelled (normal shutdown path)
            pass


# ── Real nnU-Net predictor loader (lazy torch import) ────────────────────────


def _load_real_predictor(
    model_path: Path,
    device_str: str,
) -> object:
    """Load nnUNetPredictor from model_path.  torch is imported here only.

    Parameters
    ----------
    model_path:
        Directory containing nnU-Net fold_*/checkpoint_final.pth and
        dataset.json / plans.json from the training run.
    device_str:
        "mps" or "cpu".

    Returns
    -------
    nnUNetPredictor
        Initialised and ready for predict_from_array calls.

    Raises
    ------
    ModelLoadError
        If the path is missing, not a validly-structured unpacked nnU-Net
        folder (see pipeline.inference_mode.validate_model_folder — this
        rejects e.g. the distributed .zip artifact, which passes a bare
        .exists() check but explodes deep inside nnU-Net), or nnunetv2
        raises on load.
    """
    # Lazy import — keeps module importable without torch/nnunetv2
    try:
        import torch  # noqa: PLC0415
        from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor  # noqa: PLC0415
    except ImportError as exc:
        raise ModelLoadError(
            f"torch or nnunetv2 not installed: {exc}"
        ) from exc

    # Defense-in-depth: main.py's resolve_inference_mode() should already
    # have routed an invalid/missing model to `unavailable` before
    # run_segmentation() was ever called, but validate again here in case
    # a caller (test, script, future code path) reaches this function
    # directly with an unvalidated path.
    is_valid, reason = validate_model_folder(model_path)
    if not is_valid:
        raise ModelLoadError(
            f"Invalid nnU-Net model folder at {model_path} (reason={reason})"
        )

    try:
        device = torch.device(device_str)
    except Exception as exc:
        raise ModelLoadError(f"Invalid device '{device_str}': {exc}") from exc

    # CPU inference budget (plan §12 P5.3, MODEL_CARD.md "Hardware Notes"):
    #   tile_step_size=0.9 — larger step = fewer overlapping sliding-window
    #     patches = less peak RAM (was 0.5, which the docs never actually
    #     promised — addendum §18.1 blocker #4).
    #   use_mirroring=False — disables test-time-augmentation mirroring,
    #     matching the documented `--disable_tta` (was True).
    #   perform_everything_on_device — keeps softmax aggregation on the
    #     compute device. On CPU that IS system RAM either way, so forcing
    #     it False makes nnU-Net use its lower-peak-memory CPU aggregation
    #     path instead of the GPU-oriented one; True is still appropriate
    #     for an actual accelerator (mps) where device memory is distinct
    #     from host RAM.
    perform_everything_on_device = device.type != "cpu"
    try:
        predictor = nnUNetPredictor(
            tile_step_size=0.9,
            use_gaussian=True,
            use_mirroring=False,
            perform_everything_on_device=perform_everything_on_device,
            device=device,
            verbose=False,
            allow_tqdm=False,
        )
        predictor.initialize_from_trained_model_folder(
            str(model_path),
            use_folds="all",
            checkpoint_name="checkpoint_final.pth",
        )
    except Exception as exc:
        raise ModelLoadError(
            f"Failed to load nnUNet model from {model_path}: {exc}"
        ) from exc

    log.info(
        "nnUNetPredictor loaded: model=%s device=%s tile_step_size=0.9 "
        "use_mirroring=False perform_everything_on_device=%s",
        model_path.name,
        device_str,
        perform_everything_on_device,
    )
    return predictor


def is_real_model_loaded(model_path: Path | None, device: str) -> bool:
    """True only if a REAL nnU-Net predictor has already been successfully
    loaded (and cached) for this exact model_path + device combination.

    This is deliberately NOT the same question as "is mode == real"
    (pipeline.inference_mode.resolve_inference_mode() answers that one from
    a cheap filesystem stat check). A structurally valid model folder does
    not guarantee the weights actually load — corrupt checkpoint, OOM
    during load, incompatible nnunetv2 version, wrong device, etc. Used by
    main.py's /api/ai/health so `model_loaded` reflects an actual completed
    torch load, not just "a plausible-looking path exists on disk" (plan
    §12 P5.2). Before the first real job runs (or after a config change to
    a not-yet-loaded path/device), this correctly returns False even in
    mode=real.
    """
    if model_path is None:
        return False
    return ("real", str(model_path), device) in _PREDICTOR_CACHE


def _get_predictor(
    model_path: Path | None,
    device_str: str,
    demo_mode: bool,
) -> tuple[object, str, bool]:
    """Return (predictor, actual_device, is_mock) with MPS→CPU fallback.

    Synchronous — the caller (run_segmentation) is responsible for running
    this inside asyncio.to_thread() so a cold real-model load never blocks
    the event loop (plan §12 P5.2).

    Uses the module-level (kind, model_path, device)-keyed cache. On a
    cache miss, loads from disk (or creates the mock) and stores it under
    that exact key; a later call with a *different* model_path or device
    loads (and caches) separately rather than reusing a predictor that was
    configured differently.

    Returns
    -------
    predictor:
        Either a _MockPredictor or an nnUNetPredictor.
    actual_device:
        "mps" or "cpu" — the device actually used.
    is_mock:
        True when the mock predictor is active.
    """
    # ── Decide: mock or real ──────────────────────────────────────────────────
    # demo_mode overrides everything → mock. This is the ONLY branch that
    # produces a mock predictor.
    #
    # demo_mode=False + no/invalid model_path → ModelLoadError, never a
    # silent mock fallback. A configured-but-missing model must not
    # silently produce synthetic, clinically-plausible output (plan §3.1).
    # In normal operation this branch is unreachable: main.py's
    # resolve_inference_mode() already routes that combination to
    # `unavailable` and returns before run_segmentation() is ever called.
    # It remains here as defense-in-depth for direct/test callers.
    if demo_mode:
        cached = _PREDICTOR_CACHE.get(_DEMO_CACHE_KEY)
        if cached is not None:
            return cached, "cpu", True
        log.info("Demo mode active — using mock predictor")
        predictor = _make_mock_predictor()
        _PREDICTOR_CACHE[_DEMO_CACHE_KEY] = predictor
        return predictor, "cpu", True

    if model_path is None:
        raise ModelLoadError(
            "AI_MODEL_PATH not configured and demo mode is off — "
            "cannot run real inference"
        )

    # ── Attempt real load, MPS first then CPU fallback ────────────────────────
    for attempt_device in ([device_str, "cpu"] if device_str == "mps" else [device_str]):
        key: PredictorKey = ("real", str(model_path), attempt_device)
        cached = _PREDICTOR_CACHE.get(key)
        if cached is not None:
            return cached, attempt_device, False
        try:
            predictor = _load_real_predictor(model_path, attempt_device)
            _PREDICTOR_CACHE[key] = predictor
            return predictor, attempt_device, False
        except ModelLoadError:
            raise  # propagate missing model immediately
        except RuntimeError as exc:
            msg = str(exc)
            if any(kw in msg for kw in ("MPS", "Placeholder", "Operator")):
                log.warning(
                    "MPS error during model load (%s) — retrying on CPU", msg[:120]
                )
                if attempt_device == "cpu":
                    raise ModelLoadError(f"CPU load also failed: {exc}") from exc
                continue
            raise ModelLoadError(f"RuntimeError loading model: {exc}") from exc

    # Should not be reached
    raise ModelLoadError("All device attempts exhausted")


# ── Core inference function ───────────────────────────────────────────────────


def _extract_canal_from_nnunet_result(
    result: object,
    canal_label: int,
    array_shape: tuple[int, ...],
) -> tuple[np.ndarray, np.ndarray]:
    """Pure numpy interpretation of nnUNetPredictor.predict_from_array()'s
    return value — no torch/nnunetv2 import, so this is directly unit-
    testable without those (heavy, platform-specific) dependencies
    installed. This is the CONTRACT this codebase pins against the
    installed nnunetv2 version (plan §12 P5.3): a tuple of
    (segmentation, softmax_probabilities) where
      segmentation:  (Z, Y, X) integer label map
      softmax_probs: (num_classes, Z, Y, X) float array, class-indexed on
                     axis 0 — softmax_probs[canal_label] is the canal
                     class's per-voxel probability.
    An older/different nnunetv2 pin that returns only the segmentation
    (no softmax tuple) is also handled: confidence then falls back to a
    fixed proxy value derived from the binary mask alone, tests for this
    scenario cover that fallback explicitly (test_segmentation.py).

    Parameters
    ----------
    result:
        Whatever predictor.predict_from_array(...) returned.
    canal_label:
        Integer label ID to extract as foreground.
    array_shape:
        Expected (Z, Y, X) shape — used only to validate softmax_probs'
        spatial dims defensively; a mismatch falls back to the proxy path
        rather than raising, since a confidence estimate is not worth
        failing the whole job over.

    Returns
    -------
    canal_mask:
        uint8 binary mask, shape == array_shape.
    softmax_canal:
        float32 probability map, shape == array_shape, values in [0, 1].
    """
    if isinstance(result, (list, tuple)) and len(result) == 2:
        seg, softmax = result
    else:
        # Older nnunetv2 API returns only segmentation
        seg = result
        softmax = None

    seg_np = np.array(seg)
    canal_mask = (seg_np == canal_label).astype(np.uint8)

    if softmax is not None:
        softmax_np = np.array(softmax)
        # softmax_np shape: (num_classes, Z, Y, X)
        # Canal class is at index canal_label
        if (
            softmax_np.ndim == 4
            and softmax_np.shape[0] > canal_label
            and softmax_np.shape[1:] == array_shape
        ):
            softmax_canal = softmax_np[canal_label].astype(np.float32)
        else:
            # Fallback: use binarised mask as proxy probability
            softmax_canal = canal_mask.astype(np.float32) * 0.85
    else:
        softmax_canal = canal_mask.astype(np.float32) * 0.85

    return canal_mask, softmax_canal


def _run_inference_sync(
    predictor: object,
    pixel_array: np.ndarray,
    spacing_mm: tuple[float, float, float],
    is_mock: bool,
    canal_label: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Synchronous forward pass.  Runs in a thread via asyncio.to_thread().

    Parameters
    ----------
    spacing_mm:
        The loaded volume's real voxel spacing (dZ, dY, dX) in millimetres
        — same axis order as pixel_array (plan §12 P5.3). Previously this
        was hardcoded to [1.0, 1.0, 1.0] regardless of the actual volume
        (addendum §18.1 blocker #6); nnU-Net resamples to its trained
        target spacing internally using whatever it is told the input
        spacing is, so a wrong value here silently mis-scales the volume
        before inference. Unused on the mock path (mock has no notion of
        physical spacing).

    Returns
    -------
    canal_mask:
        uint8 binary mask, shape == pixel_array.shape.
    softmax_canal:
        float32 probability map, shape == pixel_array.shape, values in [0, 1].
    """
    if is_mock:
        mock: _MockPredictor = predictor  # type: ignore[assignment]
        label_map, softmax_canal = mock.predict(pixel_array, canal_label)
        canal_mask = (label_map == 1).astype(np.uint8)
        return canal_mask, softmax_canal

    # Real nnU-Net path (torch present)
    try:
        import torch  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError("torch not available for real inference") from exc

    # nnU-Net expects float32 input, channel-first: (C, Z, Y, X)
    arr_f32 = pixel_array.astype(np.float32)
    # Add channel dim: shape (1, Z, Y, X)
    inp = arr_f32[np.newaxis, ...]

    # predict_from_array returns (segmentation, softmax_probs) — see
    # _extract_canal_from_nnunet_result's docstring for the pinned contract.
    result = predictor.predict_from_array(  # type: ignore[union-attr]
        inp,
        properties={
            # Real geometry, in the same (Z, Y, X) axis order as pixel_array
            # — nnU-Net's own SimpleITKIO reader produces spacing in this
            # same reversed-from-ITK order for arrays read via
            # GetArrayFromImage(), which is the convention this in-memory
            # path mirrors (was a hardcoded [1, 1, 1] — addendum §18.1
            # blocker #6).
            "spacing": list(spacing_mm),
        },
        save_probabilities=True,
    )

    return _extract_canal_from_nnunet_result(result, canal_label, pixel_array.shape)


def _compute_confidence(canal_mask: np.ndarray, softmax_canal: np.ndarray) -> float:
    """Mean softmax probability over foreground voxels of the canal class.

    Confidence is computed BEFORE binarisation thresholding — we use the raw
    softmax values at voxels classified as foreground.

    Returns 0.0 if there are no foreground voxels (empty mask).
    """
    foreground = canal_mask > 0
    if not foreground.any():
        return 0.0
    return float(np.mean(softmax_canal[foreground]))


# ── Public async entry-point ──────────────────────────────────────────────────


async def run_segmentation(
    volume: LoadedVolume,
    *,
    model_path: Path | None = None,
    device: str = "cpu",
    memory_budget_mb: int = 6144,
    demo: bool = False,
) -> SegmentationResult:
    """Run mandibular canal segmentation on a CBCT volume.

    Parameters
    ----------
    volume:
        Loaded 3-D CBCT volume from dicom_loader.load_volume_from_orthanc().
    model_path:
        Path to nnU-Net model directory.  If None, falls back to the
        AI_MODEL_PATH env var (only relevant when demo=False).
    device:
        Preferred device: "mps" or "cpu" (default "cpu" — plan §3.3: the
        resilient default for the linux/amd64 Docker path). Falls back to
        CPU on MPS errors.
    memory_budget_mb:
        Hard ceiling on RSS delta in MB.  Exceeding it raises MemoryBudgetExceeded.
    demo:
        Explicit mock-vs-real switch (plan P1.2). The caller (main.py) is
        expected to have already resolved this via
        pipeline.inference_mode.resolve_inference_mode() and pass the
        decision down — this function does NOT read AI_INFERENCE_DEMO_MODE
        itself, so there is exactly one place in the whole service that
        makes this decision. demo=True always uses the mock predictor.
        demo=False requires a valid, unpacked nnU-Net model_path; there is
        no silent fallback to the mock predictor.

    Returns
    -------
    SegmentationResult
        See dataclass docstring for field descriptions.  Geometry is NOT
        stored here — Agent C reads spacing/origin/direction/FOR-UID from the
        original LoadedVolume.

    Raises
    ------
    ModelLoadError
        demo=False and the model is unconfigured, missing, or structurally
        invalid (see pipeline.inference_mode.validate_model_folder), or the
        weights themselves are corrupted/incompatible.
    MemoryBudgetExceeded
        RSS delta from baseline exceeded memory_budget_mb during inference.
    """
    demo_mode = demo

    if model_path is None:
        env_path = os.environ.get("AI_MODEL_PATH", "")
        model_path = Path(env_path) if env_path else None

    env_device = os.environ.get("AI_INFERENCE_DEVICE", "")
    if env_device in ("mps", "cpu"):
        device = env_device

    canal_label = int(
        os.environ.get("AI_INFERENCE_CANAL_LABEL", str(REAL_MODEL_CANAL_LABEL))
    )

    log.info(
        "run_segmentation: shape=%s dtype=%s device=%s canal_label=%d "
        "budget_mb=%d demo_mode=%s",
        volume.pixel_array.shape,
        volume.pixel_array.dtype,
        device,
        canal_label,
        memory_budget_mb,
        demo_mode,
    )

    # ── Load / retrieve cached predictor ──────────────────────────────────────
    # Off the event loop (plan §12 P5.2): a cache hit returns near-instantly,
    # but a cache miss on the real path runs torch model load + weight
    # deserialisation synchronously — without to_thread that would block
    # the FastAPI event loop (and every other in-flight request) for the
    # duration of the first real job (addendum §18.3 P5.2).
    predictor, actual_device, is_mock = await asyncio.to_thread(
        _get_predictor, model_path, device, demo_mode
    )

    # ── Memory watchdog setup ─────────────────────────────────────────────────
    watchdog = _RssWatchdog(budget_mb=memory_budget_mb)
    watchdog.snapshot_baseline()

    # ── Launch inference in a thread (non-blocking for the event loop) ────────
    t_start = time.monotonic()

    # Wrap the synchronous inference call in an asyncio.Task so the watchdog
    # can cancel it cooperatively via task.cancel().
    loop = asyncio.get_event_loop()
    inference_task: asyncio.Task = loop.create_task(  # type: ignore[type-arg]
        asyncio.to_thread(
            _run_inference_sync,
            predictor,
            volume.pixel_array,
            volume.spacing_mm,
            is_mock,
            canal_label,
        )
    )

    watchdog_task: asyncio.Task = loop.create_task(  # type: ignore[type-arg]
        watchdog._poll_loop(inference_task)
    )

    try:
        canal_mask, softmax_canal = await inference_task
    except asyncio.CancelledError:
        watchdog_task.cancel()
        raise MemoryBudgetExceeded(
            f"Process RSS exceeded {memory_budget_mb} MB during inference "
            f"(peak delta: {watchdog.peak_delta_mb} MB)"
        )
    finally:
        if not watchdog_task.done():
            watchdog_task.cancel()
            try:
                await watchdog_task
            except asyncio.CancelledError:
                pass

    inference_seconds = time.monotonic() - t_start

    # Post-inference RSS check: inference may have completed before the watchdog's
    # first 200 ms poll fired (common for the fast mock predictor).  Take a final
    # snapshot here so a budget breach that went undetected mid-run is caught now.
    try:
        final_rss = psutil.Process().memory_info().rss
    except psutil.NoSuchProcess:
        final_rss = watchdog._baseline_bytes
    watchdog._peak_bytes = max(watchdog._peak_bytes, final_rss)
    peak_memory_mb = watchdog.peak_delta_mb

    if peak_memory_mb > memory_budget_mb:
        raise MemoryBudgetExceeded(
            f"Process RSS exceeded {memory_budget_mb} MB after inference "
            f"(peak delta: {peak_memory_mb} MB)"
        )

    # ── Compute confidence ────────────────────────────────────────────────────
    confidence = _compute_confidence(canal_mask, softmax_canal)

    if not is_mock and not canal_mask.any():
        # An empty real-model canal mask is a review case, not a failure and
        # never a fabricated positive finding (plan §12 P5.3): the caller
        # (main.py / seg_writer.py) already skips persisting an all-zero
        # mask as if it were a successful segmentation — this log line just
        # makes that "nothing found" outcome visible in service logs rather
        # than silent.
        log.warning(
            "Real segmentation produced an EMPTY canal mask — no voxels "
            "labelled %d — flag for manual review, no SEG will be persisted "
            "for this class",
            canal_label,
        )

    log.info(
        "Segmentation complete: device=%s inference_s=%.2f peak_mb=%d "
        "canal_voxels=%d confidence=%.3f",
        actual_device,
        inference_seconds,
        peak_memory_mb,
        int(canal_mask.sum()),
        confidence,
    )

    return SegmentationResult(
        masks_by_class={_CANAL_CLASS: canal_mask},
        confidence_by_class={_CANAL_CLASS: confidence},
        inference_seconds=inference_seconds,
        peak_memory_mb=peak_memory_mb,
        device=actual_device,
    )


# ── Backward-compat shim (main.py still calls this in 3b-1 stage 4) ──────────


def run_mock_segmentation(study_instance_uid: str) -> list[dict]:
    """Return mock anatomy segmentation metadata. No image processing.

    Preserved for backward compatibility: main.py Stage 4 still calls this
    until the integrator replaces it with run_segmentation().
    """
    _ = study_instance_uid
    return [
        {"anatomyClass": "mandible", "confidence": 0.92, "uncertainty": "low"},
        {
            "anatomyClass": "mandibular_canal",
            "confidence": 0.78,
            "uncertainty": "medium",
        },
    ]
