"""
main.py — AmbientCT AI Inference Service  (FastAPI, Phase 3b-1)

Endpoints:
  GET  /api/ai/health
  POST /api/ai/jobs                          → start inference job
  GET  /api/ai/jobs/{jobId}                  → poll job status
  GET  /api/ai/findings/{studyInstanceUID}   → list findings
  GET  /api/ai/segmentations/{studyInstanceUID} → list segmentation metadata
  POST /api/ai/findings/{findingId}/review   → submit reviewer decision

Phase 3b-1: real DICOM fetch from Orthanc + numpy volume reconstruction.
  - Fetches actual CBCT series via DICOMweb WADO-RS
  - Reconstructs 3D numpy volume in memory
  - Logs volume shape / dtype / spacing PHI-free
  - Mock findings / segmentations preserved (3b-2 replaces with nnU-Net)
Phase 3b-2: real DentalSegmentator / nnU-Net inference on the loaded volume.

Environment variables:
  CORS_ALLOWED_ORIGINS   comma-separated list (default: http://localhost:3000,http://viewer)
  ORTHANC_URL            Orthanc base URL (default: http://orthanc:8042)
  ORTHANC_USER           Orthanc username (default: admin)
  ORTHANC_PASSWORD       Orthanc password (required in production)
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from pipeline.dicom_loader import VolumeLoadError, load_volume_from_orthanc
from pipeline.exceptions import AiInferenceError
from pipeline.findings import build_mock_findings
from pipeline.orthanc_client import (
    OrthancAuthError,
    OrthancClient,
    OrthancNetworkError,
    OrthancNotFound,
)
from pipeline.quality_check import check_volume_quality
from pipeline.segmentation import run_mock_segmentation


def _to_camel_uid(snake: str) -> str:
    """
    camelCase alias generator that preserves DICOM acronyms.

    Standard to_camel converts 'study_instance_uid' → 'studyInstanceUid',
    but the TS AiFinding interface uses 'studyInstanceUID' (all-caps UID).
    This generator maps the trailing '_uid' segment to 'UID' so that:
      study_instance_uid   → studyInstanceUID
      series_instance_uid  → seriesInstanceUID

    All other words follow normal camelCase rules.
    """
    parts = snake.split("_")
    if not parts:
        return snake
    result = [parts[0]]
    for part in parts[1:]:
        if part == "uid":
            result.append("UID")
        else:
            result.append(part.capitalize())
    return "".join(result)

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("ai-inference")


def _safe_uid(uid: str) -> str:
    """Return a PHI-safe truncated representation of a StudyInstanceUID for logs."""
    return uid[:16] + "..." if len(uid) > 16 else uid


# ── Config ────────────────────────────────────────────────────────────────────

_raw_origins = os.environ.get(
    "CORS_ALLOWED_ORIGINS", "http://localhost:3000,http://viewer"
)
CORS_ORIGINS: list[str] = [o.strip() for o in _raw_origins.split(",") if o.strip()]

# Orthanc connectivity — internal docker-net, not nginx-proxied
ORTHANC_URL = os.environ.get("ORTHANC_URL", "http://orthanc:8042")
ORTHANC_USER = os.environ.get("ORTHANC_USER", "admin")
ORTHANC_PASSWORD = os.environ.get("ORTHANC_PASSWORD", "")

MODEL_ID = "ambientct-mock-v0"
MODEL_VERSION = "0.0.0-3b-1"
SERVICE_VERSION = "0.2.0"

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="AmbientCT AI Inference",
    version=SERVICE_VERSION,
    description=(
        "Local AI inference service for AmbientCT. "
        "Phase 3b-1: real DICOM fetch + numpy volume reconstruction. "
        "Mock findings preserved — nnU-Net inference in Phase 3b-2. "
        "Research preview — not for clinical diagnosis."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ── In-memory stores + async lock ─────────────────────────────────────────────

_jobs: Dict[str, "AiJob"] = {}
_findings: Dict[str, List["AiFinding"]] = {}
_segmentations: Dict[str, List["AiSegmentationMask"]] = {}

# Per-finding lookup for fast review updates: findingId → studyInstanceUID
_finding_index: Dict[str, str] = {}

_store_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Pydantic models ────────────────────────────────────────────────────────────
#
# Top-level fields use camelCase via alias_generator=to_camel.
# MeasurementPayload fields (area_mm2, tooth_number, …) stay snake_case because
# the TS interface uses snake_case there — we override with explicit aliases of
# the same name so to_camel does NOT transform them.


class _CamelModel(BaseModel):
    """Base model: emits camelCase JSON with DICOM acronym handling, accepts both forms."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=_to_camel_uid,
    )


class MeasurementPayload(BaseModel):
    """
    Measurement fields deliberately keep their snake_case names — the TS
    MeasurementPayload interface uses them verbatim (area_mm2, not areaMm2).
    We do NOT inherit _CamelModel here.
    """

    distance_mm: Optional[float] = Field(default=None, alias="distance_mm")
    area_mm2: Optional[float] = Field(default=None, alias="area_mm2")
    volume_mm3: Optional[float] = Field(default=None, alias="volume_mm3")
    tooth_number: Optional[int] = Field(default=None, alias="tooth_number")
    canal_distance_mm: Optional[float] = Field(default=None, alias="canal_distance_mm")

    model_config = ConfigDict(populate_by_name=True)


class AiSourceMetadata(_CamelModel):
    model_id: str
    model_version: str
    created_at: str
    study_instance_uid: str
    series_instance_uid: Optional[str] = None


class AiJob(_CamelModel):
    job_id: str
    study_instance_uid: str
    status: str  # queued | running | review_required | completed | failed
    progress: float = 0.0
    error: Optional[str] = None
    created_at: str
    updated_at: str


class AiFinding(_CamelModel):
    finding_id: str
    job_id: str
    study_instance_uid: str
    finding_class: str
    anatomy_class: Optional[str] = None
    confidence: float
    uncertainty: str
    reviewer_state: str = "unreviewed"
    measurement: Optional[MeasurementPayload] = None
    source: AiSourceMetadata
    is_demo: bool = True
    description: Optional[str] = None


class AiSegmentationMask(_CamelModel):
    segmentation_id: str
    job_id: str
    study_instance_uid: str
    anatomy_class: str
    confidence: float
    uncertainty: str
    source: AiSourceMetadata
    is_demo: bool = True


# ── Request / response schemas ─────────────────────────────────────────────────


class StartJobRequest(_CamelModel):
    study_instance_uid: str


class ReviewRequest(BaseModel):
    state: str  # accepted | rejected | edited


class ReviewResponse(_CamelModel):
    finding_id: str
    reviewer_state: str


class FindingsResponse(BaseModel):
    findings: List[AiFinding]

    def model_dump(self, **kwargs):  # type: ignore[override]
        kwargs.setdefault("by_alias", True)
        return super().model_dump(**kwargs)


class SegmentationsResponse(BaseModel):
    segmentations: List[AiSegmentationMask]

    def model_dump(self, **kwargs):  # type: ignore[override]
        kwargs.setdefault("by_alias", True)
        return super().model_dump(**kwargs)


# ── Background pipeline task ───────────────────────────────────────────────────


async def _set_job_status(
    job_id: str,
    status: str,
    progress: float,
    error: Optional[str] = None,
) -> None:
    """Update job status + progress atomically under the store lock."""
    async with _store_lock:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.status = status
        job.progress = progress
        job.updated_at = _now_iso()
        if error is not None:
            job.error = error


def _build_findings_and_segs(
    study_instance_uid: str,
    job_id: str,
    source: "AiSourceMetadata",
) -> tuple[list[AiFinding], list[AiSegmentationMask]]:
    """Assemble AiFinding + AiSegmentationMask lists from mock generators."""
    raw_findings = build_mock_findings(study_instance_uid, job_id, source)
    raw_segs = run_mock_segmentation(study_instance_uid)

    findings: list[AiFinding] = []
    for rf in raw_findings:
        m = rf.get("measurement")
        findings.append(
            AiFinding(
                finding_id=rf["findingId"],
                job_id=job_id,
                study_instance_uid=study_instance_uid,
                finding_class=rf["findingClass"],
                anatomy_class=rf.get("anatomyClass"),
                confidence=rf["confidence"],
                uncertainty=rf["uncertainty"],
                reviewer_state="unreviewed",
                measurement=MeasurementPayload(**m) if m else None,
                source=source,
                is_demo=True,
                description=rf.get("description"),
            )
        )

    seg_list: list[AiSegmentationMask] = []
    for rs in raw_segs:
        seg_list.append(
            AiSegmentationMask(
                segmentation_id=f"seg-{rs['anatomyClass']}-{job_id[:8]}",
                job_id=job_id,
                study_instance_uid=study_instance_uid,
                anatomy_class=rs["anatomyClass"],
                confidence=rs["confidence"],
                uncertainty=rs["uncertainty"],
                source=source,
                is_demo=True,
            )
        )

    return findings, seg_list


async def _run_pipeline(job_id: str, study_instance_uid: str) -> None:
    """
    Real AI pipeline for Phase 3b-1.

    Stage 1  queued → running  (mark job + progress=0.1)
    Stage 2  fetch DICOM from Orthanc + reconstruct numpy volume
    Stage 3  quality check (informational, no rejection)
    Stage 4  mock findings + segmentations  (unchanged from 3a; 3b-2 replaces)
    Stage 5  running → review_required  (progress=1.0)

    On any typed pipeline error: job status → failed with sanitised error string.
    PHI-safe: volume shape/dtype/spacing are logged, never patient metadata.
    """
    t0 = datetime.now(timezone.utc)
    safe_study = _safe_uid(study_instance_uid)

    try:
        # ── Stage 1: mark running ─────────────────────────────────────────────
        await _set_job_status(job_id, "running", progress=0.1)
        log.info("Job %s → running (study %s)", job_id[:8], safe_study)

        # ── Stage 2: fetch from Orthanc ───────────────────────────────────────
        async with OrthancClient(ORTHANC_URL, ORTHANC_USER, ORTHANC_PASSWORD) as client:
            volume = await load_volume_from_orthanc(client, study_instance_uid)

        await _set_job_status(job_id, "running", progress=0.5)

        # ── Stage 3: quality check ────────────────────────────────────────────
        report = check_volume_quality(volume)
        log.info(
            "Volume loaded: shape=%s dtype=%s spacing_mm=%s isotropic=%s "
            "(job=%s study=%s)",
            volume.pixel_array.shape,
            volume.pixel_array.dtype,
            volume.spacing_mm,
            report.isotropic,
            job_id[:8],
            safe_study,
        )
        if report.warnings:
            log.warning(
                "Quality warnings for job %s: %d warning(s)",
                job_id[:8],
                len(report.warnings),
            )

        # ── Stage 4: mock findings (3b-2 replaces with nnU-Net inference) ─────
        await _set_job_status(job_id, "running", progress=0.7)
        now_iso = _now_iso()
        source = AiSourceMetadata(
            model_id=MODEL_ID,
            model_version=MODEL_VERSION,
            created_at=now_iso,
            study_instance_uid=study_instance_uid,
            series_instance_uid=volume.series_instance_uid,
        )
        findings, seg_list = _build_findings_and_segs(
            study_instance_uid, job_id, source
        )

        # ── Stage 5: store results + mark review_required ─────────────────────
        async with _store_lock:
            job = _jobs.get(job_id)
            if job is None:
                return
            _findings[study_instance_uid] = findings
            _segmentations[study_instance_uid] = seg_list
            for f in findings:
                _finding_index[f.finding_id] = study_instance_uid
            job.status = "review_required"
            job.progress = 1.0
            job.updated_at = _now_iso()

        elapsed = (datetime.now(timezone.utc) - t0).total_seconds()
        log.info(
            "Job %s → review_required (study %s, %.1fs, %d findings, %d segs)",
            job_id[:8],
            safe_study,
            elapsed,
            len(findings),
            len(seg_list),
        )

    except OrthancNotFound:
        log.error("Job %s failed: study %s not found in Orthanc", job_id[:8], safe_study)
        await _set_job_status(
            job_id, "failed", progress=0.0,
            error="Study not found in Orthanc"
        )

    except OrthancAuthError:
        log.error("Job %s failed: Orthanc auth error", job_id[:8])
        await _set_job_status(
            job_id, "failed", progress=0.0,
            error="Orthanc authentication failed — check ORTHANC_USER/ORTHANC_PASSWORD"
        )

    except OrthancNetworkError as exc:
        log.error("Job %s failed: Orthanc network error: %s", job_id[:8], exc)
        await _set_job_status(
            job_id, "failed", progress=0.0,
            error="Cannot reach Orthanc — check service health"
        )

    except VolumeLoadError as exc:
        log.error("Job %s failed: volume load error: %s", job_id[:8], exc)
        await _set_job_status(
            job_id, "failed", progress=0.0,
            error=f"Volume load failed: {type(exc).__name__}"
        )

    except AiInferenceError as exc:
        log.error("Job %s failed: pipeline error: %s", job_id[:8], exc)
        await _set_job_status(
            job_id, "failed", progress=0.0,
            error=f"Pipeline error: {type(exc).__name__}"
        )

    except Exception:
        log.exception("Job %s: unexpected pipeline failure", job_id[:8])
        await _set_job_status(
            job_id, "failed", progress=0.0,
            error="Internal error — see service logs"
        )


# ── Endpoints ──────────────────────────────────────────────────────────────────


@app.get("/api/ai/health")
async def health() -> dict:
    """
    Liveness + readiness check.

    orthanc_reachable is non-blocking: a single /system probe with a short
    timeout.  Failure here does NOT cause a 5xx — the health endpoint stays
    green so nginx/docker healthcheck does not restart the service on Orthanc
    downtime.  The pipeline itself will fail individual jobs with "failed".
    """
    async with OrthancClient(ORTHANC_URL, ORTHANC_USER, ORTHANC_PASSWORD) as c:
        orthanc_ok = await c.check_reachable()

    return {
        "status": "ok",
        "version": SERVICE_VERSION,
        "model_loaded": False,
        "phase": "3b-1",
        "orthanc_reachable": orthanc_ok,
        "orthanc_url": ORTHANC_URL,
    }


@app.post("/api/ai/jobs", response_model=AiJob, response_model_by_alias=True)
async def start_job(req: StartJobRequest, bg: BackgroundTasks) -> AiJob:
    """
    Start an AI inference job for the given studyInstanceUID.
    Returns immediately with status=queued; poll GET /api/ai/jobs/{jobId} for updates.
    """
    job_id = str(uuid.uuid4())
    now_iso = _now_iso()
    job = AiJob(
        job_id=job_id,
        study_instance_uid=req.study_instance_uid,
        status="queued",
        progress=0.0,
        created_at=now_iso,
        updated_at=now_iso,
    )
    async with _store_lock:
        _jobs[job_id] = job

    bg.add_task(_run_pipeline, job_id, req.study_instance_uid)
    log.info(
        "Job %s queued for study %s",
        job_id[:8],
        _safe_uid(req.study_instance_uid),
    )
    return job


@app.get("/api/ai/jobs/{job_id}", response_model=AiJob, response_model_by_alias=True)
async def get_job(job_id: str) -> AiJob:
    async with _store_lock:
        job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job {job_id!r} not found")
    return job


@app.get(
    "/api/ai/findings/{study_instance_uid}",
    response_model=FindingsResponse,
    response_model_by_alias=True,
)
async def get_findings(study_instance_uid: str) -> dict:
    async with _store_lock:
        findings = list(_findings.get(study_instance_uid, []))
    return {"findings": findings}


@app.get(
    "/api/ai/segmentations/{study_instance_uid}",
    response_model=SegmentationsResponse,
    response_model_by_alias=True,
)
async def get_segmentations(study_instance_uid: str) -> dict:
    async with _store_lock:
        segs = list(_segmentations.get(study_instance_uid, []))
    return {"segmentations": segs}


@app.post(
    "/api/ai/findings/{finding_id}/review",
    response_model=ReviewResponse,
    response_model_by_alias=True,
)
async def review_finding(finding_id: str, req: ReviewRequest) -> ReviewResponse:
    """
    Submit a reviewer decision for a finding.
    Valid states: accepted | rejected | edited
    """
    valid_states = {"accepted", "rejected", "edited"}
    if req.state not in valid_states:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid review state {req.state!r}. Must be one of {sorted(valid_states)}.",
        )

    async with _store_lock:
        study_uid = _finding_index.get(finding_id)
        if study_uid is None:
            raise HTTPException(
                status_code=404, detail=f"Finding {finding_id!r} not found"
            )
        findings_list = _findings.get(study_uid, [])
        target: Optional[AiFinding] = None
        for f in findings_list:
            if f.finding_id == finding_id:
                target = f
                break
        if target is None:
            raise HTTPException(
                status_code=404, detail=f"Finding {finding_id!r} not found"
            )
        target.reviewer_state = req.state

    log.info("Finding %s → reviewerState=%s", finding_id[:12], req.state)
    return ReviewResponse(finding_id=finding_id, reviewer_state=req.state)
