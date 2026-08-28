"""
tests/test_inference_mode.py — pytest suite for pipeline/inference_mode.py
(Phase 3b-2, plan §8 P1.2)

resolve_inference_mode() is the single source of truth for demo | real |
unavailable. These tests exercise every branch using tmp_path fixtures for
a fake nnU-Net model folder — no real model, no torch/nnunetv2 import.

Coverage:
  test_demo_forced_regardless_of_model_path
  test_no_model_path_is_unavailable
  test_missing_model_path_is_unavailable
  test_zip_file_model_path_is_unavailable
  test_folder_missing_plans_json_is_unavailable
  test_folder_missing_fold_dir_is_unavailable
  test_valid_folder_is_real
  test_env_overrides_take_precedence_over_kwargs_defaults
  test_device_default_is_cpu
  test_validate_model_folder_directly
"""

from __future__ import annotations

from pathlib import Path

from pipeline.inference_mode import (
    DEMO_MODEL_ID,
    REAL_MODEL_CANAL_LABEL,
    REAL_MODEL_ID,
    REASON_DEMO_FORCED,
    REASON_MODEL_FOLDER_MISSING_FILES,
    REASON_MODEL_FOLDER_MISSING_FOLD_DIR,
    REASON_MODEL_PATH_IS_FILE,
    REASON_MODEL_PATH_MISSING,
    REASON_MODEL_PATH_NOT_CONFIGURED,
    REASON_OK,
    resolve_inference_mode,
    validate_model_folder,
)


def _make_valid_model_folder(base: Path) -> Path:
    """Create a minimal but structurally valid unpacked nnU-Net folder."""
    model_dir = base / "valid-model"
    model_dir.mkdir()
    (model_dir / "dataset.json").write_text("{}")
    (model_dir / "plans.json").write_text("{}")
    (model_dir / "fold_0").mkdir()
    (model_dir / "fold_0" / "checkpoint_final.pth").write_bytes(b"\x00")
    return model_dir


# ── resolve_inference_mode ──────────────────────────────────────────────────


def test_demo_forced_regardless_of_model_path(tmp_path: Path) -> None:
    """AI_INFERENCE_DEMO_MODE=true → demo, even with a valid model configured."""
    valid = _make_valid_model_folder(tmp_path)
    decision = resolve_inference_mode(
        demo_mode_env=True, model_path_env=str(valid)
    )
    assert decision.mode == "demo"
    assert decision.model_id == DEMO_MODEL_ID
    assert decision.reason == REASON_DEMO_FORCED
    assert decision.model_path is None
    assert decision.is_demo is True


def test_no_model_path_is_unavailable() -> None:
    """demo=False, no AI_MODEL_PATH configured → unavailable."""
    decision = resolve_inference_mode(demo_mode_env=False, model_path_env="")
    assert decision.mode == "unavailable"
    assert decision.reason == REASON_MODEL_PATH_NOT_CONFIGURED
    assert decision.model_id is None
    assert decision.is_demo is False


def test_missing_model_path_is_unavailable(tmp_path: Path) -> None:
    """demo=False, AI_MODEL_PATH points at a path that does not exist → unavailable."""
    missing = tmp_path / "does-not-exist"
    decision = resolve_inference_mode(
        demo_mode_env=False, model_path_env=str(missing)
    )
    assert decision.mode == "unavailable"
    assert decision.reason == REASON_MODEL_PATH_MISSING


def test_zip_file_model_path_is_unavailable(tmp_path: Path) -> None:
    """A model path that exists but is a plain file (e.g. the distributed
    .zip artifact) must be `unavailable`, not silently accepted — this is
    blocker #3 from the plan: a bare .exists() check would pass here and
    then explode deep inside nnU-Net.
    """
    zip_path = tmp_path / "Dataset111_453CT_v100.zip"
    zip_path.write_bytes(b"PK\x03\x04fake-zip-bytes")

    decision = resolve_inference_mode(
        demo_mode_env=False, model_path_env=str(zip_path)
    )
    assert decision.mode == "unavailable"
    assert decision.reason == REASON_MODEL_PATH_IS_FILE
    assert decision.model_id is None


def test_folder_missing_plans_json_is_unavailable(tmp_path: Path) -> None:
    """A directory with dataset.json but no plans.json is not a valid model folder."""
    model_dir = tmp_path / "incomplete-model"
    model_dir.mkdir()
    (model_dir / "dataset.json").write_text("{}")
    (model_dir / "fold_0").mkdir()

    decision = resolve_inference_mode(
        demo_mode_env=False, model_path_env=str(model_dir)
    )
    assert decision.mode == "unavailable"
    assert decision.reason == REASON_MODEL_FOLDER_MISSING_FILES


def test_folder_missing_fold_dir_is_unavailable(tmp_path: Path) -> None:
    """dataset.json + plans.json present but no fold_* subdirectory → unavailable."""
    model_dir = tmp_path / "no-folds-model"
    model_dir.mkdir()
    (model_dir / "dataset.json").write_text("{}")
    (model_dir / "plans.json").write_text("{}")

    decision = resolve_inference_mode(
        demo_mode_env=False, model_path_env=str(model_dir)
    )
    assert decision.mode == "unavailable"
    assert decision.reason == REASON_MODEL_FOLDER_MISSING_FOLD_DIR


def test_valid_folder_is_real(tmp_path: Path) -> None:
    """demo=False + a structurally valid unpacked model folder → real."""
    valid = _make_valid_model_folder(tmp_path)

    decision = resolve_inference_mode(
        demo_mode_env=False, model_path_env=str(valid)
    )
    assert decision.mode == "real"
    assert decision.model_id == REAL_MODEL_ID
    assert decision.reason == REASON_OK
    assert decision.model_path == valid
    assert decision.is_demo is False


def test_env_overrides_take_precedence_over_kwargs_defaults(
    tmp_path: Path, monkeypatch
) -> None:
    """When no *_env kwarg is passed, resolve_inference_mode reads os.environ."""
    valid = _make_valid_model_folder(tmp_path)
    monkeypatch.setenv("AI_INFERENCE_DEMO_MODE", "false")
    monkeypatch.setenv("AI_MODEL_PATH", str(valid))
    monkeypatch.setenv("AI_INFERENCE_DEVICE", "cpu")

    decision = resolve_inference_mode()
    assert decision.mode == "real"
    assert decision.device == "cpu"


def test_device_default_is_cpu(monkeypatch) -> None:
    """With AI_INFERENCE_DEVICE unset, the resolved device defaults to cpu
    (plan §3.3: the resilient Docker-path default)."""
    monkeypatch.delenv("AI_INFERENCE_DEVICE", raising=False)
    decision = resolve_inference_mode(demo_mode_env=True)
    assert decision.device == "cpu"


# ── validate_model_folder ────────────────────────────────────────────────────


def test_validate_model_folder_directly(tmp_path: Path) -> None:
    """validate_model_folder() is independently correct for the valid case."""
    valid = _make_valid_model_folder(tmp_path)
    is_valid, reason = validate_model_folder(valid)
    assert is_valid is True
    assert reason == REASON_OK


# ── Model metadata ───────────────────────────────────────────────────────────


def test_real_model_canal_label_is_five() -> None:
    """DentalSegmentator's own label scheme puts the mandibular canal at
    label 5, not 1 (its maxilla label) — plan §12 P5.3 / addendum §18.3,
    confirmed critical. pipeline/segmentation.py imports this constant as
    the default for AI_INFERENCE_CANAL_LABEL."""
    assert REAL_MODEL_CANAL_LABEL == 5
