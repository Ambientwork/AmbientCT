"""
tests/test_main.py — pytest suite for AmbientCT AI Inference Service (Phase 3a)

Run:
  pip install -r requirements.txt -r requirements-dev.txt
  pytest tests/ -v
"""

from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

# Import app after path is established by pytest (cwd = ai-inference/)
from main import app, _jobs, _findings, _segmentations, _finding_index

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.test"


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
    """GET /api/ai/health returns 200 with expected shape."""
    r = await client.get("/api/ai/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"
    assert body["model_loaded"] is False
    assert body["phase"] == "3a-mock"


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
