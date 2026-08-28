"""
tests/test_main.py — pytest suite for AmbientCT AI Inference Service (Phase 3b-1)

Run:
  pip install -r requirements.txt -r requirements-dev.txt
  pytest tests/ -v

Key changes vs Phase 3a:
  - load_volume_from_orthanc is monkey-patched to avoid real Orthanc dependency
  - OrthancClient.check_reachable is patched for the health-endpoint test
  - New tests: job reaches "running" state, pipeline-error → "failed" status
  - Version / phase assertions updated to 3b-1
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import numpy as np
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Import app after path is established by pytest (cwd = ai-inference/)
import main
from main import app, _jobs, _findings, _segmentations, _finding_index
from pipeline.dicom_loader import LoadedVolume, VolumeLoadError
from pipeline.orthanc_client import OrthancNotFound

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.test"


# ── Fake volume fixture ────────────────────────────────────────────────────────


def _fake_volume() -> LoadedVolume:
    """Return a minimal LoadedVolume for mocking load_volume_from_orthanc."""
    n_slices = 10
    return LoadedVolume(
        pixel_array=np.zeros((n_slices, 64, 64), dtype=np.int16),
        spacing_mm=(0.4, 0.4, 0.4),
        origin_mm=(0.0, 0.0, 0.0),
        direction=(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        study_instance_uid=STUDY_UID,
        series_instance_uid="1.2.3.4.series",
        frame_of_reference_uid="1.2.3.4.for",
        # Real write_dicom_seg() (Stage 4b, plan P4.2) requires one entry per
        # slice — a fake volume with none would raise SegWriterError as soon
        # as any test enables AI_INFERENCE_PERSIST_DEMO_SEG without also
        # patching main.write_dicom_seg.
        source_sop_instance_uids=tuple(
            f"1.2.3.4.source.{i}" for i in range(n_slices)
        ),
        patient_id="SN-PHANTOM-001",
        patient_name="PHANTOM^DENTAL^CBCT",
    )


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest_asyncio.fixture
async def client():
    """Async HTTPX test client backed by the FastAPI ASGI app."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


@pytest.fixture(autouse=True)
def clear_stores():
    """Reset all in-memory stores between tests to avoid cross-test pollution."""
    _jobs.clear()
    _findings.clear()
    _segmentations.clear()
    _finding_index.clear()
    yield
    _jobs.clear()
    _findings.clear()
    _segmentations.clear()
    _finding_index.clear()


@pytest.fixture(autouse=True)
def mock_load_volume():
    """
    Auto-patch the heavy pipeline calls so tests don't hit real Orthanc / model.

      - load_volume_from_orthanc → returns a fake LoadedVolume
      - upload_segmentations    → returns fake successful uploads (Phase 3b-2)

    `run_segmentation` uses the built-in mock predictor when AI_MODEL_PATH is
    unset (the default in tests), so it doesn't need separate patching.
    `write_dicom_seg` runs in-process with synthetic masks — it's pure code.

    Individual tests can re-patch inside the test body to inject errors.
    """
    from pipeline.orthanc_writer import UploadedSegmentation

    async def _fake_upload(_client, written, study_uid):
        return [
            UploadedSegmentation(
                anatomy_class=w.anatomy_class,
                sop_instance_uid=w.sop_instance_uid,
                series_instance_uid=w.series_instance_uid,
                success=True,
                error_message=None,
            )
            for w in written
        ]

    with patch(
        "main.load_volume_from_orthanc",
        new_callable=AsyncMock,
        return_value=_fake_volume(),
    ), patch(
        "main.upload_segmentations",
        side_effect=_fake_upload,
    ):
        yield


# ── Helper ─────────────────────────────────────────────────────────────────────


async def _wait_for_status(
    client: AsyncClient,
    job_id: str,
    target_status: str,
    timeout_s: float = 10.0,
    poll_interval_s: float = 0.2,
) -> dict:
    """Poll job endpoint until target_status is reached or timeout expires."""
    elapsed = 0.0
    while elapsed < timeout_s:
        r = await client.get(f"/api/ai/jobs/{job_id}")
        assert r.status_code == 200
        data = r.json()
        if data["status"] == target_status:
            return data
        await asyncio.sleep(poll_interval_s)
        elapsed += poll_interval_s
    pytest.fail(
        f"Job {job_id} did not reach status={target_status!r} within {timeout_s}s "
        f"(last status: {data.get('status')!r})"
    )


# ── Tests ──────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    """GET /api/ai/health returns 200 with expected shape including orthanc_reachable."""
    with patch(
        "main.OrthancClient",
    ) as mock_cls:
        mock_instance = AsyncMock()
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_instance.check_reachable = AsyncMock(return_value=False)
        mock_cls.return_value = mock_instance

        r = await client.get("/api/ai/health")

    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.3.0"
    # Demo mode in tests (no AI_MODEL_PATH set), so model_loaded=False
    assert body["model_loaded"] is False
    assert body["phase"] == "3b-2"
    assert body["demo_mode"] is True
    assert "orthanc_reachable" in body


@pytest.mark.asyncio
async def test_start_job_returns_queued(client: AsyncClient) -> None:
    """POST /api/ai/jobs returns status=queued immediately."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "queued"
    assert "jobId" in body
    assert body["studyInstanceUID"] == STUDY_UID
    assert "createdAt" in body
    assert "updatedAt" in body


@pytest.mark.asyncio
async def test_job_transitions_to_review_required(client: AsyncClient) -> None:
    """Job transitions queued → running → review_required within 8 seconds."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    assert r.status_code == 200
    job_id = r.json()["jobId"]

    final = await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)
    assert final["status"] == "review_required"
    assert final["progress"] == 1.0


@pytest.mark.asyncio
async def test_findings_populated_after_job(client: AsyncClient) -> None:
    """After job reaches review_required, findings endpoint returns isDemo=True items."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    job_id = r.json()["jobId"]
    await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    r = await client.get(f"/api/ai/findings/{STUDY_UID}")
    assert r.status_code == 200
    body = r.json()
    assert "findings" in body
    findings = body["findings"]
    assert len(findings) > 0
    for f in findings:
        assert f["isDemo"] is True
        assert f["reviewerState"] == "unreviewed"
        assert "findingId" in f
        assert "findingClass" in f


@pytest.mark.asyncio
async def test_review_finding_updates_state(client: AsyncClient) -> None:
    """POST /api/ai/findings/{findingId}/review changes reviewerState."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    job_id = r.json()["jobId"]
    await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    r = await client.get(f"/api/ai/findings/{STUDY_UID}")
    finding_id = r.json()["findings"][0]["findingId"]

    r = await client.post(
        f"/api/ai/findings/{finding_id}/review",
        json={"state": "accepted"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["findingId"] == finding_id
    assert body["reviewerState"] == "accepted"

    # Verify persisted
    r2 = await client.get(f"/api/ai/findings/{STUDY_UID}")
    updated = next(f for f in r2.json()["findings"] if f["findingId"] == finding_id)
    assert updated["reviewerState"] == "accepted"


@pytest.mark.asyncio
async def test_unknown_job_404(client: AsyncClient) -> None:
    """GET /api/ai/jobs/{unknown} returns 404."""
    r = await client.get("/api/ai/jobs/nonexistent-job-id")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_unknown_finding_404(client: AsyncClient) -> None:
    """POST /api/ai/findings/{unknown}/review returns 404."""
    r = await client.post(
        "/api/ai/findings/nonexistent-finding-id/review",
        json={"state": "accepted"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_camel_case_json(client: AsyncClient) -> None:
    """Response JSON uses camelCase keys (jobId not job_id, studyInstanceUID not study_instance_uid)."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    assert r.status_code == 200
    body = r.json()

    # camelCase keys must be present
    assert "jobId" in body, "Expected 'jobId', got: " + str(list(body.keys()))
    assert "studyInstanceUID" in body
    assert "createdAt" in body
    assert "updatedAt" in body

    # snake_case variants must NOT be present at top level
    assert "job_id" not in body
    assert "study_instance_uid" not in body
    assert "created_at" not in body


@pytest.mark.asyncio
async def test_segmentations_populated_after_job(client: AsyncClient) -> None:
    """After job completes, segmentations endpoint contains the canal class.

    Phase 3b-2: the active inference target is mandibular canal (single-class).
    Other anatomy classes (mandible, maxilla, etc.) come back when a multi-class
    model is configured — out of scope for this test.
    """
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    job_id = r.json()["jobId"]
    await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    r = await client.get(f"/api/ai/segmentations/{STUDY_UID}")
    assert r.status_code == 200
    segs = r.json()["segmentations"]
    anatomy_classes = {s["anatomyClass"] for s in segs}
    assert "mandibular_canal" in anatomy_classes
    # All segs from this job must be marked demo (mock predictor in tests)
    assert all(s["isDemo"] for s in segs)


@pytest.mark.asyncio
async def test_findings_empty_before_job(client: AsyncClient) -> None:
    """GET /api/ai/findings returns empty list when no job has run."""
    r = await client.get(f"/api/ai/findings/{STUDY_UID}")
    assert r.status_code == 200
    assert r.json()["findings"] == []


@pytest.mark.asyncio
async def test_measurement_snake_case_preserved(client: AsyncClient) -> None:
    """Measurement field names stay snake_case (area_mm2 not areaMm2, tooth_number not toothNumber)."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    job_id = r.json()["jobId"]
    await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    r = await client.get(f"/api/ai/findings/{STUDY_UID}")
    findings = r.json()["findings"]

    bone_loss = next(
        (f for f in findings if f["findingClass"] == "periapical_radiolucency"),
        None,
    )
    assert bone_loss is not None
    m = bone_loss.get("measurement", {}) or {}
    # snake_case keys must exist
    assert "volume_mm3" in m, f"Expected volume_mm3 in measurement, got: {m}"
    assert "tooth_number" in m, f"Expected tooth_number in measurement, got: {m}"
    # camelCase must NOT appear
    assert "volumeMm3" not in m
    assert "toothNumber" not in m


# ── Phase 3b-1 specific tests ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_job_completes_with_full_progress(client: AsyncClient) -> None:
    """
    Job completes at progress=1.0 with status=review_required.

    The pipeline sets progress=0.1 (running), 0.5 (after fetch), 0.7 (before
    findings), and 1.0 (review_required).  We verify the terminal state has
    the correct progress value.  Catching intermediate states in a polling test
    is timing-sensitive so we only assert the final outcome here.
    """
    r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
    assert r.status_code == 200
    job_id = r.json()["jobId"]

    final = await _wait_for_status(client, job_id, "review_required", timeout_s=5.0)
    assert final["status"] == "review_required"
    assert final["progress"] == 1.0
    # error field must be None on success
    assert final.get("error") is None


@pytest.mark.asyncio
async def test_pipeline_orthanc_not_found_sets_failed(client: AsyncClient) -> None:
    """When OrthancNotFound is raised, job ends as failed with sanitized error."""
    with patch(
        "main.load_volume_from_orthanc",
        new_callable=AsyncMock,
        side_effect=OrthancNotFound("Study not found"),
    ):
        r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
        job_id = r.json()["jobId"]
        # Keep patch active while polling — background task runs within event loop
        final = await _wait_for_status(client, job_id, "failed", timeout_s=5.0)
        assert final["status"] == "failed"
        assert final["error"] is not None
        assert "not found" in final["error"].lower()
        # Must not expose raw exception internals
        assert "Traceback" not in final["error"]


@pytest.mark.asyncio
async def test_pipeline_volume_load_error_sets_failed(client: AsyncClient) -> None:
    """When VolumeLoadError is raised, job ends as failed with sanitized error."""
    with patch(
        "main.load_volume_from_orthanc",
        new_callable=AsyncMock,
        side_effect=VolumeLoadError("Inconsistent SeriesInstanceUID"),
    ):
        r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
        job_id = r.json()["jobId"]
        final = await _wait_for_status(client, job_id, "failed", timeout_s=5.0)
        assert final["status"] == "failed"
        assert final["error"] is not None
        assert "VolumeLoadError" in final["error"]
        # PHI check: raw exception message must NOT appear in the sanitized error string
        assert "Inconsistent SeriesInstanceUID" not in final["error"]


@pytest.mark.asyncio
async def test_pipeline_unexpected_error_sets_failed(client: AsyncClient) -> None:
    """Generic unhandled exceptions result in failed status with generic message."""
    with patch(
        "main.load_volume_from_orthanc",
        new_callable=AsyncMock,
        side_effect=RuntimeError("Unexpected boom"),
    ):
        r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
        job_id = r.json()["jobId"]
        final = await _wait_for_status(client, job_id, "failed", timeout_s=5.0)
        assert final["status"] == "failed"
        assert final["error"] == "Internal error — see service logs"


@pytest.mark.asyncio
async def test_pipeline_loads_volume_with_correct_study_uid(client: AsyncClient) -> None:
    """
    Verify load_volume_from_orthanc is called with the correct study UID.
    """
    with patch(
        "main.load_volume_from_orthanc",
        new_callable=AsyncMock,
        return_value=_fake_volume(),
    ) as mock_load:
        r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
        job_id = r.json()["jobId"]
        await _wait_for_status(client, job_id, "review_required", timeout_s=5.0)
        mock_load.assert_called_once()
        # study_instance_uid is the second positional arg (first is OrthancClient instance)
        positional_args = mock_load.call_args.args
        assert STUDY_UID in positional_args


# ── Phase 3b-2 P1.2/P1.3 — inference mode + demo SEG persistence ──────────────
#
# tests/conftest.py's autouse fixture sets AI_INFERENCE_DEMO_MODE=true and
# clears AI_MODEL_PATH / AI_INFERENCE_PERSIST_DEMO_SEG for every test in this
# module unless a test overrides them locally via monkeypatch.


@pytest.mark.asyncio
async def test_health_reports_demo_mode_fields(client: AsyncClient) -> None:
    """Health includes mode/reason alongside the legacy demo_mode/model_loaded
    fields, resolved fresh via resolve_inference_mode() (plan P1.2)."""
    with patch("main.OrthancClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_instance.check_reachable = AsyncMock(return_value=False)
        mock_cls.return_value = mock_instance

        r = await client.get("/api/ai/health")

    body = r.json()
    assert r.status_code == 200
    assert body["mode"] == "demo"
    assert body["reason"] == "demo_mode_forced"
    assert body["model_id"] == "ambientct-mock-v0"


@pytest.mark.asyncio
async def test_health_unavailable_stays_http_200(
    client: AsyncClient, monkeypatch
) -> None:
    """demo=false + no model configured → mode=unavailable, but liveness
    (HTTP 200) is unaffected — only the readiness fields in the body change
    (plan P1.2: 'Docker-Liveness bleibt HTTP 200')."""
    monkeypatch.setenv("AI_INFERENCE_DEMO_MODE", "false")
    monkeypatch.delenv("AI_MODEL_PATH", raising=False)

    with patch("main.OrthancClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_instance.check_reachable = AsyncMock(return_value=False)
        mock_cls.return_value = mock_instance

        r = await client.get("/api/ai/health")

    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "unavailable"
    assert body["model_loaded"] is False
    assert body["demo_mode"] is False
    assert body["model_id"] is None
    assert body["reason"] == "model_path_not_configured"


@pytest.mark.asyncio
async def test_health_mode_reflects_env_change_without_restart(
    client: AsyncClient, monkeypatch
) -> None:
    """Mode is resolved fresh on every /api/ai/health call — flipping
    AI_INFERENCE_DEMO_MODE between two calls in the same running process
    must change the reported mode immediately, proving there is no
    import-time caching / stale health (plan §8 addendum P1.2a)."""
    monkeypatch.setenv("AI_INFERENCE_DEMO_MODE", "false")
    monkeypatch.delenv("AI_MODEL_PATH", raising=False)

    with patch("main.OrthancClient") as mock_cls:
        mock_instance = AsyncMock()
        mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_instance.__aexit__ = AsyncMock(return_value=None)
        mock_instance.check_reachable = AsyncMock(return_value=False)
        mock_cls.return_value = mock_instance

        r1 = await client.get("/api/ai/health")
        assert r1.json()["mode"] == "unavailable"

        monkeypatch.setenv("AI_INFERENCE_DEMO_MODE", "true")
        r2 = await client.get("/api/ai/health")
        assert r2.json()["mode"] == "demo"


@pytest.mark.asyncio
async def test_job_unavailable_mode_fails_before_loading_volume(
    client: AsyncClient, monkeypatch
) -> None:
    """demo=false + no model configured: the job must fail immediately with
    a PHI-free 'unavailable' error, WITHOUT ever calling
    load_volume_from_orthanc — i.e. no CBCT volume is fetched for a job that
    cannot possibly complete (plan P1.2, blocker: 'a job in unavailable
    state would still load the full CBCT volume before failing')."""
    monkeypatch.setenv("AI_INFERENCE_DEMO_MODE", "false")
    monkeypatch.delenv("AI_MODEL_PATH", raising=False)

    r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
    job_id = r.json()["jobId"]

    final = await _wait_for_status(client, job_id, "failed", timeout_s=5.0)
    assert final["status"] == "failed"
    assert final["error"] is not None
    assert "unavailable" in final["error"].lower()

    # The autouse mock_load_volume fixture patches this name onto `main`;
    # it must never have been invoked for an unavailable-mode job.
    assert main.load_volume_from_orthanc.call_count == 0


@pytest.mark.asyncio
async def test_demo_without_persistence_skips_stow(client: AsyncClient) -> None:
    """Default AI_INFERENCE_PERSIST_DEMO_SEG=false: a demo job's result
    never goes through STOW-RS, and its segmentation id is deliberately NOT
    a DICOM UID (no fake Orthanc SOP UID in the API state) — plan P1.3."""
    r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
    job_id = r.json()["jobId"]
    await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    assert main.upload_segmentations.call_count == 0

    r = await client.get(f"/api/ai/segmentations/{STUDY_UID}")
    segs = r.json()["segmentations"]
    assert len(segs) > 0
    for s in segs:
        assert s["isDemo"] is True
        assert s["segmentationId"].startswith("demo-inmemory-")


@pytest.mark.asyncio
async def test_demo_with_persistence_stows_and_marks_seg_as_demo(
    client: AsyncClient, monkeypatch
) -> None:
    """AI_INFERENCE_PERSIST_DEMO_SEG=true: write_dicom_seg is called with
    is_demo=True and the mock model id, and the (persisted) result is
    uploaded via STOW-RS — plan P1.3."""
    monkeypatch.setenv("AI_INFERENCE_PERSIST_DEMO_SEG", "true")

    from pipeline.seg_writer import WrittenSegmentation

    captured: dict = {}

    def _fake_write_dicom_seg(**kwargs):
        captured.update(kwargs)
        return [
            WrittenSegmentation(
                anatomy_class="mandibular_canal",
                sop_instance_uid="1.2.3.fake.sop",
                series_instance_uid="1.2.3.fake.series",
                dicom_bytes=b"\x00",
            )
        ]

    with patch("main.write_dicom_seg", side_effect=_fake_write_dicom_seg):
        r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
        job_id = r.json()["jobId"]
        await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    assert captured.get("is_demo") is True
    assert captured.get("model_id") == "ambientct-mock-v0"
    assert main.upload_segmentations.call_count == 1

    r = await client.get(f"/api/ai/segmentations/{STUDY_UID}")
    segs = r.json()["segmentations"]
    assert len(segs) > 0
    assert all(s["isDemo"] for s in segs)
    assert segs[0]["segmentationId"] == "1.2.3.fake.sop"


@pytest.mark.asyncio
async def test_all_seg_uploads_failing_sets_job_failed_not_review_required(
    client: AsyncClient, monkeypatch
) -> None:
    """Plan P4.3/P4.4: a STOW-RS upload failure must never present a false
    overall success. When every SEG produced this run fails to upload, the
    job must end in status=failed (not review_required) with a PHI-free
    error — review_required is reserved for a completed configured path.
    """
    monkeypatch.setenv("AI_INFERENCE_PERSIST_DEMO_SEG", "true")

    from pipeline.orthanc_writer import UploadedSegmentation

    async def _all_fail_upload(_client, written, study_uid):
        assert written, "test setup expected at least one WrittenSegmentation"
        return [
            UploadedSegmentation(
                anatomy_class=w.anatomy_class,
                sop_instance_uid=w.sop_instance_uid,
                series_instance_uid=w.series_instance_uid,
                success=False,
                error_message="OrthancServerError: upload failed",
            )
            for w in written
        ]

    with patch("main.upload_segmentations", side_effect=_all_fail_upload):
        r = await client.post("/api/ai/jobs", json={"studyInstanceUID": STUDY_UID})
        job_id = r.json()["jobId"]
        data = await _wait_for_status(client, job_id, "failed", timeout_s=8.0)

    assert data["status"] == "failed"
    assert data["error"]
    # PHI-free: the stored error must never contain the raw StudyInstanceUID.
    assert STUDY_UID not in data["error"]

    # The job must never have reached review_required with results that were
    # never actually persisted — nothing should be stored for this study.
    r2 = await client.get(f"/api/ai/segmentations/{STUDY_UID}")
    assert r2.json()["segmentations"] == []
    r3 = await client.get(f"/api/ai/findings/{STUDY_UID}")
    assert r3.json()["findings"] == []
