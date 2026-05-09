"""
pipeline/orthanc_client.py — Async DICOMweb client for Orthanc  (Phase 3b-1)

Talks to Orthanc via the internal Docker network (http://orthanc:8042) using
HTTP Basic auth.  No nginx proxy in this path — direct container-to-container.

DICOMweb endpoints used:
  QIDO  GET /dicom-web/studies/{study_uid}/series
  WADO  GET /dicom-web/studies/{study_uid}/series/{series_uid}/metadata
  WADO  GET /dicom-web/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}/frames/{frame}

Error hierarchy:
  AiInferenceError
  └── OrthancError
      ├── OrthancNotFound
      ├── OrthancAuthError
      └── OrthancNetworkError
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from pipeline.exceptions import AiInferenceError

log = logging.getLogger("ai-inference.orthanc")

# ── Timeouts ──────────────────────────────────────────────────────────────────
# connect: 60 s  (container cold-start)
# read:   300 s  (large CBCT frame transfer)
_TIMEOUT = httpx.Timeout(connect=60.0, read=300.0, write=60.0, pool=60.0)


# ── Exceptions ────────────────────────────────────────────────────────────────


class OrthancError(AiInferenceError):
    """Base class for all Orthanc communication errors."""


class OrthancNotFound(OrthancError):
    """Raised when a QIDO/WADO request returns 404."""


class OrthancAuthError(OrthancError):
    """Raised when Orthanc returns 401 or 403."""


class OrthancNetworkError(OrthancError):
    """Raised on transport-level failures (connection refused, timeout, …)."""


# ── Data classes ──────────────────────────────────────────────────────────────


def _safe_uid(uid: str) -> str:
    """Return a PHI-safe truncated UID for logging."""
    return uid[:16] + "..." if len(uid) > 16 else uid


def _qido_str(tag_dict: dict[str, Any], tag: str, fallback: str = "") -> str:
    """Extract the first string value from a DICOM JSON tag dict."""
    val = tag_dict.get(tag, {}).get("Value")
    if isinstance(val, list) and val:
        return str(val[0])
    return fallback


def _qido_int(tag_dict: dict[str, Any], tag: str, fallback: int = 0) -> int:
    val = tag_dict.get(tag, {}).get("Value")
    if isinstance(val, list) and val:
        try:
            return int(val[0])
        except (TypeError, ValueError):
            pass
    return fallback


@dataclass(frozen=True)
class SeriesSummary:
    series_instance_uid: str
    modality: str
    series_number: int
    num_instances: int
    description: str


@dataclass(frozen=True)
class InstanceSummary:
    sop_instance_uid: str
    instance_number: int


# ── Client ────────────────────────────────────────────────────────────────────


class OrthancClient:
    """
    Async DICOMweb client for Orthanc.

    Designed for use as an async context manager:

        async with OrthancClient(base_url, user, password) as client:
            series = await client.get_series_for_study(study_uid)
    """

    def __init__(self, base_url: str, username: str, password: str) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            auth=(username, password),
            timeout=_TIMEOUT,
            headers={"Accept": "application/dicom+json"},
        )

    async def __aenter__(self) -> OrthancClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _get(self, path: str, accept: str | None = None) -> httpx.Response:
        """Execute a GET request, translating HTTP/transport errors to typed exceptions."""
        url = f"{self._base}/{path.lstrip('/')}"
        headers: dict[str, str] = {}
        if accept:
            headers["Accept"] = accept
        try:
            resp = await self._client.get(url, headers=headers)
        except (httpx.ConnectError, httpx.TimeoutException, httpx.TransportError) as exc:
            raise OrthancNetworkError(
                f"Network error reaching Orthanc at {self._base}: {exc}"
            ) from exc

        if resp.status_code == 404:
            raise OrthancNotFound(
                f"Orthanc returned 404 for {path}"
            )
        if resp.status_code in (401, 403):
            raise OrthancAuthError(
                f"Orthanc auth failed (HTTP {resp.status_code}) for {path}"
            )
        if resp.status_code >= 400:
            raise OrthancError(
                f"Orthanc returned HTTP {resp.status_code} for {path}: "
                f"{resp.text[:200]}"
            )
        return resp

    # ── Public API ────────────────────────────────────────────────────────────

    async def check_reachable(self) -> bool:
        """
        Return True if Orthanc is reachable.
        Does NOT raise — designed for health-check use.
        """
        try:
            await self._get("/system", accept="application/json")
            return True
        except (OrthancError, Exception):  # noqa: BLE001
            return False

    async def get_series_for_study(
        self, study_instance_uid: str
    ) -> list[SeriesSummary]:
        """
        QIDO-RS: list all series for a study.

        Returns a list of SeriesSummary ordered by series_number ascending.
        Raises OrthancNotFound if the study does not exist.
        """
        path = f"/dicom-web/studies/{study_instance_uid}/series"
        resp = await self._get(path)
        raw: list[dict[str, Any]] = resp.json()

        results: list[SeriesSummary] = []
        for item in raw:
            uid = _qido_str(item, "0020000E")  # SeriesInstanceUID
            if not uid:
                continue
            results.append(
                SeriesSummary(
                    series_instance_uid=uid,
                    modality=_qido_str(item, "00080060"),
                    series_number=_qido_int(item, "00200011"),
                    num_instances=_qido_int(item, "00201209"),
                    description=_qido_str(item, "0008103E"),
                )
            )

        results.sort(key=lambda s: s.series_number)
        log.debug(
            "Study %s → %d series",
            _safe_uid(study_instance_uid),
            len(results),
        )
        return results

    async def get_series_metadata(
        self, study_uid: str, series_uid: str
    ) -> list[dict[str, Any]]:
        """
        WADO-RS metadata: list of DICOM JSON instance metadata dicts for the series.

        Returns one dict per instance containing all available DICOM JSON tags.
        """
        path = (
            f"/dicom-web/studies/{study_uid}/series/{series_uid}/metadata"
        )
        resp = await self._get(path)
        data: list[dict[str, Any]] = resp.json()
        log.debug(
            "Series %s metadata → %d instances",
            _safe_uid(series_uid),
            len(data),
        )
        return data

    async def list_instances(
        self, study_uid: str, series_uid: str
    ) -> list[InstanceSummary]:
        """
        QIDO-RS: list all instances in a series.

        Returned list is ordered by InstanceNumber ascending (0 where missing).
        """
        path = (
            f"/dicom-web/studies/{study_uid}/series/{series_uid}/instances"
        )
        resp = await self._get(path)
        raw: list[dict[str, Any]] = resp.json()

        results: list[InstanceSummary] = []
        for item in raw:
            sop_uid = _qido_str(item, "00080018")  # SOPInstanceUID
            if not sop_uid:
                continue
            results.append(
                InstanceSummary(
                    sop_instance_uid=sop_uid,
                    instance_number=_qido_int(item, "00200013"),
                )
            )

        results.sort(key=lambda i: i.instance_number)
        return results

    async def fetch_instance_frames(
        self,
        study_uid: str,
        series_uid: str,
        instance_uid: str,
        frame_numbers: list[int],
    ) -> bytes:
        """
        WADO-RS: fetch one or more frames from a single instance.

        frame_numbers is 1-based (DICOM convention).
        Returns the raw multipart/related response body.
        """
        frames_path = ",".join(str(n) for n in frame_numbers)
        path = (
            f"/dicom-web/studies/{study_uid}/series/{series_uid}"
            f"/instances/{instance_uid}/frames/{frames_path}"
        )
        resp = await self._get(
            path,
            accept="multipart/related; type=application/octet-stream",
        )
        return resp.content
