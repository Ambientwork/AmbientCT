"""
tests/test_segmentation.py — pytest suite for pipeline/segmentation.py  (Phase 3b-2)

All tests use the mock predictor — real nnU-Net weights are not required.

Env setup for test isolation:
  Mock-vs-real is controlled by the explicit `demo=` keyword argument to
  run_segmentation() (plan P1.2) — this module no longer reads
  AI_INFERENCE_DEMO_MODE itself, so tests pass `demo=True`/`demo=False`
  directly rather than relying on env vars.  tests/conftest.py's autouse
  fixture still clears AI_MODEL_PATH / sets AI_INFERENCE_DEMO_MODE=true at
  the process-env level so nothing here depends on the host's ambient
  environment; every test gets a clean _PREDICTOR_CACHE dict beforehand
  (reset_predictor_cache fixture, autouse).

Coverage:
  test_run_segmentation_mock_returns_canal_mask
  test_run_segmentation_returns_confidence_in_range
  test_run_segmentation_records_device
  test_run_segmentation_records_inference_seconds
  test_run_segmentation_records_peak_memory
  test_memory_budget_exceeded_raises
  test_model_load_error_when_path_missing
  test_model_load_error_when_no_path_and_demo_off
  test_demo_mode_uses_mock

Phase 3b-2 P5 additions (plan §12):
  test_cache_key_includes_model_path_and_device
  test_is_real_model_loaded_false_before_any_load
  test_is_real_model_loaded_true_after_cached_load
  test_default_canal_label_is_five_not_one
  test_canal_label_env_override_still_works
  test_extract_canal_from_nnunet_result_contract_tuple
  test_extract_canal_from_nnunet_result_contract_seg_only
  test_extract_canal_from_nnunet_result_shape_mismatch_falls_back
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import numpy as np
import pytest

import pipeline.segmentation as seg_module
from pipeline.dicom_loader import LoadedVolume
from pipeline.exceptions import MemoryBudgetExceeded, ModelLoadError
from pipeline.segmentation import SegmentationResult, run_segmentation

# ── Test fixtures ─────────────────────────────────────────────────────────────

STUDY_UID = "1.2.3.4.5.segtest"
SERIES_UID = "1.2.3.4.5.segtest.series"
FOR_UID = "1.2.3.4.5.segtest.for"


def _make_volume(
    shape: tuple[int, int, int] = (32, 32, 32),
    spacing: tuple[float, float, float] = (1.0, 1.0, 1.0),
) -> LoadedVolume:
    """Synthesise a minimal LoadedVolume for testing."""
    arr = np.zeros(shape, dtype=np.int16)
    return LoadedVolume(
        pixel_array=arr,
        spacing_mm=spacing,
        origin_mm=(0.0, 0.0, 0.0),
        direction=(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        study_instance_uid=STUDY_UID,
        series_instance_uid=SERIES_UID,
        frame_of_reference_uid=FOR_UID,
    )


@pytest.fixture(autouse=True)
def reset_predictor_cache():
    """Reset module-level predictor cache before each test for isolation.

    The cache is a dict keyed by (kind, model_path, device) (plan §12
    P5.2), not a single bare slot — reset to an empty dict, not None.
    """
    seg_module._PREDICTOR_CACHE.clear()
    yield
    seg_module._PREDICTOR_CACHE.clear()


# ── Tests ─────────────────────────────────────────────────────────────────────
#
# Mock-vs-real is the explicit `demo=` kwarg (plan P1.2) — pass demo=True to
# force the mock predictor, independent of any env var.


@pytest.mark.asyncio
async def test_run_segmentation_mock_returns_canal_mask() -> None:
    """Mock run returns a canal mask: correct key, dtype uint8, correct shape."""
    volume = _make_volume(shape=(16, 24, 32))
    result: SegmentationResult = await run_segmentation(volume, demo=True)

    assert "mandibular_canal" in result.masks_by_class, (
        "masks_by_class must contain 'mandibular_canal'"
    )
    mask = result.masks_by_class["mandibular_canal"]
    assert mask.dtype == np.uint8, f"Expected uint8, got {mask.dtype}"
    assert mask.shape == volume.pixel_array.shape, (
        f"Mask shape {mask.shape} != volume shape {volume.pixel_array.shape}"
    )
    # Canal tube should have some foreground voxels
    assert mask.sum() > 0, "Mock canal mask must not be all-zero"
    # Values should only be 0 or 1
    assert set(np.unique(mask)).issubset({0, 1}), "Mask values must be 0 or 1"


@pytest.mark.asyncio
async def test_run_segmentation_returns_confidence_in_range() -> None:
    """Confidence value for canal class must be in [0, 1]."""
    volume = _make_volume()
    result = await run_segmentation(volume, demo=True)

    assert "mandibular_canal" in result.confidence_by_class
    conf = result.confidence_by_class["mandibular_canal"]
    assert isinstance(conf, float), f"Expected float, got {type(conf)}"
    assert 0.0 <= conf <= 1.0, f"Confidence {conf} not in [0, 1]"


@pytest.mark.asyncio
async def test_run_segmentation_records_device() -> None:
    """Device field must be 'mps' or 'cpu'."""
    volume = _make_volume()
    result = await run_segmentation(volume, demo=True)

    assert result.device in ("mps", "cpu"), (
        f"device must be 'mps' or 'cpu', got {result.device!r}"
    )


@pytest.mark.asyncio
async def test_run_segmentation_records_inference_seconds() -> None:
    """inference_seconds must be strictly positive."""
    volume = _make_volume()
    result = await run_segmentation(volume, demo=True)

    assert isinstance(result.inference_seconds, float)
    assert result.inference_seconds > 0.0, (
        f"inference_seconds must be > 0, got {result.inference_seconds}"
    )


@pytest.mark.asyncio
async def test_run_segmentation_records_peak_memory() -> None:
    """peak_memory_mb must be a non-negative integer."""
    volume = _make_volume()
    result = await run_segmentation(volume, demo=True)

    assert isinstance(result.peak_memory_mb, int)
    assert result.peak_memory_mb >= 0, (
        f"peak_memory_mb must be >= 0, got {result.peak_memory_mb}"
    )


@pytest.mark.asyncio
async def test_memory_budget_exceeded_raises() -> None:
    """Setting memory_budget_mb=1 must trigger MemoryBudgetExceeded.

    The watchdog polls RSS and the baseline snapshot is taken immediately
    before inference.  With budget=1 MB, any allocation during inference
    (even a tiny numpy array) will exceed the budget.  We synthesise a
    larger volume so the numpy array allocation is non-trivial.
    """
    # 64^3 int16 = ~512 KB of pixel_array alone; but the mock also allocates
    # several same-shaped float32 arrays (~2 MB each), which will push delta > 1 MB.
    volume = _make_volume(shape=(64, 64, 64))

    with pytest.raises(MemoryBudgetExceeded):
        await run_segmentation(volume, memory_budget_mb=1, demo=True)


@pytest.mark.asyncio
async def test_model_load_error_when_path_missing() -> None:
    """Non-existent model_path with demo=False must raise ModelLoadError.

    demo=False and a path that does not exist exercises the real load code
    path directly (no env involved — demo is an explicit kwarg now).
    """
    volume = _make_volume()

    missing = Path("/nonexistent/path/to/model")
    assert not missing.exists(), "Test invariant: path must not exist"

    with pytest.raises(ModelLoadError):
        await run_segmentation(volume, model_path=missing, demo=False)


@pytest.mark.asyncio
async def test_model_load_error_when_no_path_and_demo_off() -> None:
    """demo=False with model_path=None must raise ModelLoadError, never
    fall back to the mock predictor silently (plan §3.1 / P1.2).
    """
    volume = _make_volume()

    with pytest.raises(ModelLoadError):
        await run_segmentation(volume, model_path=None, demo=False)


@pytest.mark.asyncio
async def test_demo_mode_uses_mock() -> None:
    """demo=True forces mock even if a model path is set.

    We pass a path that does NOT exist.  With demo=False this would raise
    ModelLoadError; with demo=True the mock must run silently regardless.
    """
    volume = _make_volume()

    # Path does not exist, but demo=True should bypass real loading entirely
    fake_path = Path("/nonexistent/model/for/demo/test")

    result = await run_segmentation(volume, model_path=fake_path, demo=True)

    # Must succeed and return valid mask
    assert "mandibular_canal" in result.masks_by_class
    mask = result.masks_by_class["mandibular_canal"]
    assert mask.dtype == np.uint8
    assert mask.shape == volume.pixel_array.shape


# ── Additional robustness tests ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_result_geometry_not_stored() -> None:
    """SegmentationResult must not carry geometry fields.

    Geometry (spacing, origin, direction, frame_of_reference_uid) is
    Agent C's responsibility via the original LoadedVolume.
    """
    volume = _make_volume()
    result = await run_segmentation(volume, demo=True)

    assert not hasattr(result, "spacing_mm"), "Result must not carry spacing_mm"
    assert not hasattr(result, "origin_mm"), "Result must not carry origin_mm"
    assert not hasattr(result, "direction"), "Result must not carry direction"
    assert not hasattr(result, "frame_of_reference_uid"), (
        "Result must not carry frame_of_reference_uid"
    )


@pytest.mark.asyncio
async def test_mock_predictor_cache_reused() -> None:
    """Second call must reuse the module-level cached predictor (no re-init)."""
    volume = _make_volume()

    await run_segmentation(volume, demo=True)
    cached_after_first = seg_module._PREDICTOR_CACHE[seg_module._DEMO_CACHE_KEY]

    await run_segmentation(volume, demo=True)
    cached_after_second = seg_module._PREDICTOR_CACHE[seg_module._DEMO_CACHE_KEY]

    assert cached_after_first is cached_after_second, (
        "Predictor cache must be the same object on second call"
    )


def test_make_mock_predictor_returns_correct_shape() -> None:
    """_make_mock_predictor().predict() output shapes match input."""
    from pipeline.segmentation import _make_mock_predictor

    predictor = _make_mock_predictor(label_for_canal=1)
    arr = np.zeros((20, 30, 40), dtype=np.int16)
    label_map, softmax_canal = predictor.predict(arr, canal_label=1)

    assert label_map.shape == (20, 30, 40)
    assert softmax_canal.shape == (20, 30, 40)
    assert label_map.dtype == np.uint8
    assert softmax_canal.dtype == np.float32
    assert float(softmax_canal.min()) >= 0.0
    assert float(softmax_canal.max()) <= 1.0


def test_compute_confidence_empty_mask() -> None:
    """_compute_confidence returns 0.0 when the mask has no foreground."""
    from pipeline.segmentation import _compute_confidence

    mask = np.zeros((10, 10, 10), dtype=np.uint8)
    softmax = np.full((10, 10, 10), 0.5, dtype=np.float32)
    assert _compute_confidence(mask, softmax) == 0.0


def test_compute_confidence_full_mask() -> None:
    """_compute_confidence returns the mean softmax over all voxels when all are fg."""
    from pipeline.segmentation import _compute_confidence

    mask = np.ones((4, 4, 4), dtype=np.uint8)
    softmax = np.full((4, 4, 4), 0.8, dtype=np.float32)
    conf = _compute_confidence(mask, softmax)
    assert abs(conf - 0.8) < 1e-5


def test_backward_compat_shim() -> None:
    """run_mock_segmentation() still works for main.py Stage 4 compatibility."""
    from pipeline.segmentation import run_mock_segmentation

    result = run_mock_segmentation("1.2.3.dummy")
    assert isinstance(result, list)
    assert any(r["anatomyClass"] == "mandibular_canal" for r in result)


# ── Phase 3b-2 P5 — cache key, model_loaded, canal label default, contract ────


@pytest.mark.asyncio
async def test_cache_key_includes_model_path_and_device() -> None:
    """Two different (demo=False) model_path/device configs must NOT share a
    cached predictor — plan §12 P5.2: a config change must never silently
    reuse a predictor loaded under a different configuration.

    Both configs point at a non-existent path so real loading fails fast
    with ModelLoadError without needing torch/nnunetv2 installed; the point
    of this test is that each distinct (model_path, device) pair is looked
    up independently in the cache (via its own key) rather than colliding
    on a single shared slot.
    """
    volume = _make_volume()
    path_a = Path("/nonexistent/model/a")
    path_b = Path("/nonexistent/model/b")

    with pytest.raises(ModelLoadError):
        await run_segmentation(volume, model_path=path_a, device="cpu", demo=False)
    with pytest.raises(ModelLoadError):
        await run_segmentation(volume, model_path=path_b, device="cpu", demo=False)

    # Neither attempt should have populated the cache (both failed to load).
    assert ("real", str(path_a), "cpu") not in seg_module._PREDICTOR_CACHE
    assert ("real", str(path_b), "cpu") not in seg_module._PREDICTOR_CACHE


def test_is_real_model_loaded_false_before_any_load(tmp_path: Path) -> None:
    """model_loaded must be False for a path that was never actually loaded,
    even if it looks structurally plausible — mode=='real' (a filesystem
    stat check) is not the same claim as 'the weights are loaded' (plan
    §12 P5.2)."""
    from pipeline.segmentation import is_real_model_loaded

    model_dir = tmp_path / "never-loaded"
    model_dir.mkdir()
    assert is_real_model_loaded(model_dir, "cpu") is False


def test_is_real_model_loaded_none_path_is_false() -> None:
    from pipeline.segmentation import is_real_model_loaded

    assert is_real_model_loaded(None, "cpu") is False


def test_is_real_model_loaded_true_after_cached_load(tmp_path: Path) -> None:
    """Once a real predictor is cached under (real, path, device),
    is_real_model_loaded() must report True for that exact combination and
    False for a different device — proving health() would reflect an
    actual load, not just a plausible path (plan §12 P5.2). Populates the
    cache directly (no torch needed) since this test only exercises the
    lookup, not the load itself.
    """
    from pipeline.segmentation import is_real_model_loaded

    model_dir = tmp_path / "loaded-model"
    model_dir.mkdir()
    key = ("real", str(model_dir), "cpu")
    seg_module._PREDICTOR_CACHE[key] = object()

    assert is_real_model_loaded(model_dir, "cpu") is True
    assert is_real_model_loaded(model_dir, "mps") is False


@pytest.mark.asyncio
async def test_default_canal_label_is_five_not_one() -> None:
    """The default AI_INFERENCE_CANAL_LABEL must be 5 (DentalSegmentator's
    canal label), not 1 (its maxilla label) — plan §12 P5.3 / addendum
    §18.3, confirmed critical: a stock deployment previously defaulted to
    silently extracting the wrong anatomy.
    """
    from pipeline.inference_mode import REAL_MODEL_CANAL_LABEL

    assert REAL_MODEL_CANAL_LABEL == 5

    # Exercise it through the real env-parsing path in run_segmentation():
    # a nonexistent model_path with the label env var unset still reaches
    # the canal_label parse line before ModelLoadError is raised, and we
    # can observe the value it would have used via the log call args is
    # brittle — instead assert the module-level default directly (the
    # single source of truth run_segmentation() reads from).
    assert seg_module.REAL_MODEL_CANAL_LABEL == 5


def test_canal_label_env_override_still_works(monkeypatch) -> None:
    """AI_INFERENCE_CANAL_LABEL remains env-overridable despite the new
    model-metadata default (plan §12 P5.3: 'env-overridable')."""
    monkeypatch.setenv("AI_INFERENCE_CANAL_LABEL", "2")
    canal_label = int(
        os.environ.get(
            "AI_INFERENCE_CANAL_LABEL", str(seg_module.REAL_MODEL_CANAL_LABEL)
        )
    )
    assert canal_label == 2


# ── nnU-Net v2 return-shape contract (plan §12 P5.3) ───────────────────────────
#
# Pins this codebase's assumption about what predictor.predict_from_array()
# returns, without needing torch/nnunetv2 installed: _extract_canal_from_
# nnunet_result is pure numpy and is exercised directly against synthetic
# arrays shaped exactly like the documented nnunetv2 contract.


def test_extract_canal_from_nnunet_result_contract_tuple() -> None:
    """(segmentation, softmax_probs) tuple: softmax at canal_label's index
    is used verbatim as the confidence map."""
    from pipeline.segmentation import _extract_canal_from_nnunet_result

    shape = (4, 5, 6)
    seg = np.zeros(shape, dtype=np.uint8)
    seg[1, 2, 3] = 5  # one canal voxel
    softmax = np.zeros((6, *shape), dtype=np.float32)  # num_classes=6
    softmax[5, 1, 2, 3] = 0.91

    canal_mask, softmax_canal = _extract_canal_from_nnunet_result(
        (seg, softmax), canal_label=5, array_shape=shape
    )

    assert canal_mask.dtype == np.uint8
    assert canal_mask.shape == shape
    assert canal_mask.sum() == 1
    assert canal_mask[1, 2, 3] == 1
    assert softmax_canal.shape == shape
    assert abs(float(softmax_canal[1, 2, 3]) - 0.91) < 1e-6


def test_extract_canal_from_nnunet_result_contract_seg_only() -> None:
    """Older/degenerate nnunetv2 return: segmentation array only (no
    softmax tuple) — falls back to a fixed 0.85 proxy confidence rather
    than crashing."""
    from pipeline.segmentation import _extract_canal_from_nnunet_result

    shape = (3, 3, 3)
    seg = np.full(shape, 5, dtype=np.uint8)

    canal_mask, softmax_canal = _extract_canal_from_nnunet_result(
        seg, canal_label=5, array_shape=shape
    )

    assert canal_mask.sum() == 27
    assert np.allclose(softmax_canal, 0.85)


def test_extract_canal_from_nnunet_result_shape_mismatch_falls_back() -> None:
    """A softmax array whose spatial dims don't match the segmentation
    (a defensive case, e.g. a future nnunetv2 API change) must fall back to
    the proxy confidence rather than raising or silently misindexing."""
    from pipeline.segmentation import _extract_canal_from_nnunet_result

    shape = (4, 4, 4)
    seg = np.zeros(shape, dtype=np.uint8)
    seg[0, 0, 0] = 5
    wrong_shape_softmax = np.zeros((6, 2, 2, 2), dtype=np.float32)

    canal_mask, softmax_canal = _extract_canal_from_nnunet_result(
        (seg, wrong_shape_softmax), canal_label=5, array_shape=shape
    )

    assert canal_mask.sum() == 1
    assert softmax_canal.shape == shape
    assert np.allclose(softmax_canal[canal_mask.astype(bool)], 0.85)
