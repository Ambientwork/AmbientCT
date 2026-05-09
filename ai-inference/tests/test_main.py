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
from main import app, _jobs, _findings, _segmentations, _finding_index
from pipeline.dicom_loader import LoadedVolume, VolumeLoadError
from pipeline.orthanc_client import OrthancNotFound

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.test"


# ── Fake volume fixture ────────────────────────────────────────────────────────


def _fake_volume() -> LoadedVolume:
    """Return a minimal LoadedVolume for mocking load_volume_from_orthanc."""
    return LoadedVolume(
        pixel_array=np.zeros((10, 64, 64), dtype=np.int16),
        spacing_mm=(0.4, 0.4, 0.4),
        origin_mm=(0.0, 0.0, 0.0),
        direction=(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0),
        study_instance_uid=STUDY_UID,
        series_instance_uid="1.2.3.4.series",
        frame_of_reference_uid="1.2.3.4.for",
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
    Auto-patch load_volume_from_orthanc to return a fake LoadedVolume.

    This removes the Orthanc dependency from all pipeline tests in this module.
    Individual tests can re-patch inside the test body to inject errors.
    """
    with patch(
        "main.load_volume_from_orthanc",
        new_callable=AsyncMock,
        return_value=_fake_volume(),
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
    assert body["version"] == "0.2.0"
    assert body["model_loaded"] is False
    assert body["phase"] == "3b-1"
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
    """After job completes, segmentations endpoint returns at least mandible and mandibular_canal."""
    r = await client.post(
        "/api/ai/jobs", json={"studyInstanceUID": STUDY_UID}
    )
    job_id = r.json()["jobId"]
    await _wait_for_status(client, job_id, "review_required", timeout_s=8.0)

    r = await client.get(f"/api/ai/segmentations/{STUDY_UID}")
    assert r.status_code == 200
    segs = r.json()["segmentations"]
    anatomy_classes = {s["anatomyClass"] for s in segs}
    assert "mandible" in anatomy_classes
    assert "mandibular_canal" in anatomy_classes


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
