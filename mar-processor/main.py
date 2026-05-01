"""
main.py — AmbientCT MAR-Processor  (FastAPI)

Endpunkte:
  POST /api/process-mar   → startet async MAR-Job, gibt job_id zurück
  GET  /api/job/{job_id}  → Jobstatus + Fortschritt abfragen
  GET  /health            → Liveness-Check

Umgebungsvariablen (über docker-compose gesetzt):
  ORTHANC_URL      http://orthanc:8042
  ORTHANC_USER     admin
  ORTHANC_PASSWORD <passwort>
"""

from __future__ import annotations

import logging
import os
import threading
import uuid
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from mar_pipeline import run_mar

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("mar-processor")

# ── Config ────────────────────────────────────────────────────────────────────
ORTHANC_URL  = os.environ.get("ORTHANC_URL",      "http://orthanc:8042")
ORTHANC_USER = os.environ.get("ORTHANC_USER",     "admin")
ORTHANC_PASS = os.environ.get("ORTHANC_PASSWORD", "")

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="AmbientCT MAR-Processor", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # Einschränken in Produktion via CORS_ALLOWED_ORIGINS
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory Job-Store (für Single-Instance Docker-Deployment ausreichend) ──
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **kwargs: Any) -> None:
    with _jobs_lock:
        if job_id not in _jobs:
            _jobs[job_id] = {}
        _jobs[job_id].update(kwargs)


def _get_job(job_id: str) -> dict[str, Any] | None:
    with _jobs_lock:
        return dict(_jobs[job_id]) if job_id in _jobs else None


# ── Background-Task ───────────────────────────────────────────────────────────

def _run_job(job_id: str, series_uid: str) -> None:
    _set_job(job_id, status="processing", progress=0.0)

    def progress_cb(pct: float, msg: str) -> None:
        _set_job(job_id, progress=round(pct, 3), message=msg)

    try:
        new_uid = run_mar(
            orthanc_url=ORTHANC_URL,
            series_uid=series_uid,
            auth=(ORTHANC_USER, ORTHANC_PASS),
            progress_cb=progress_cb,
        )
        _set_job(job_id, status="completed", progress=1.0, mar_series_uid=new_uid)
        log.info("Job %s abgeschlossen → %s", job_id, new_uid)

    except Exception as exc:  # noqa: BLE001
        log.exception("Job %s fehlgeschlagen", job_id)
        _set_job(job_id, status="error", error=str(exc))


# ── Pydantic-Schemas ──────────────────────────────────────────────────────────

class ProcessRequest(BaseModel):
    series_instance_uid: str


class ProcessResponse(BaseModel):
    job_id: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str            # queued | processing | completed | error
    progress: float        # 0.0 – 1.0
    message: str | None = None
    mar_series_uid: str | None = None
    error: str | None = None


# ── Endpunkte ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "orthanc": ORTHANC_URL}


@app.post("/api/process-mar", response_model=ProcessResponse)
def process_mar(req: ProcessRequest, bg: BackgroundTasks) -> ProcessResponse:
    """
    Startet einen asynchronen MAR-Verarbeitungsjob.
    Gibt sofort eine job_id zurück — Status via GET /api/job/{job_id} pollen.
    """
    job_id = str(uuid.uuid4())
    _set_job(job_id, status="queued", progress=0.0,
             series_uid=req.series_instance_uid)
    bg.add_task(_run_job, job_id, req.series_instance_uid)
    log.info("MAR-Job %s gestartet für Serie %s", job_id, req.series_instance_uid)
    return ProcessResponse(job_id=job_id)


@app.get("/api/job/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    job = _get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    return JobStatusResponse(job_id=job_id, **{
        k: job.get(k) for k in ("status", "progress", "message", "mar_series_uid", "error")
    })
