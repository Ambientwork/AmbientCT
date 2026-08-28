"""
pipeline/orthanc_client.py — Async DICOMweb client for Orthanc  (Phase 3b-1/2)

Talks to Orthanc via the internal Docker network (http://orthanc:8042) using
HTTP Basic auth.  No nginx proxy in this path — direct container-to-container.

DICOMweb endpoints used:
  QIDO  GET  /dicom-web/studies/{study_uid}/series
  WADO  GET  /dicom-web/studies/{study_uid}/series/{series_uid}/metadata
  WADO  GET  /dicom-web/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}/frames/{frame}
  STOW  POST /dicom-web/studies/{study_uid}/   (Phase 3b-2, STOW-RS upload)
        POST /dicom-web/studies                 (without study UID)

Error hierarchy:
  AiInferenceError
  └── OrthancError
      ├── OrthancNotFound
      ├── OrthancAuthError
      ├── OrthancNetworkError
      ├── OrthancClientError   (4xx, Phase 3b-2)
      ├── OrthancServerError   (5xx, Phase 3b-2)
      └── StowRsRejected       (STOW-RS FailedSOPSequence non-empty, Phase 3b-2)
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Any

import httpx

from pipeline.exceptions import AiInferenceError

log = logging.getLogger("ai-inference.orthanc")

# ── Timeouts ──────────────────────────────────────────────────────────────────
# connect: 60 s  (container cold-start)
# read:   300 s  (large CBCT frame transfer)
_TIMEOUT = httpx.Timeout(connect=60.0, read=300.0, write=60.0, pool=60.0)

# ── STOW-RS retry policy (plan P4.3) ────────────────────────────────────────
# Bounded retries ONLY for transient failures: a network error (Orthanc
# unreachable/timeout) or a 5xx server error. NOT retried: 4xx (client sent
# something Orthanc will always reject), 401/403/404, or a STOW-RS-level
# FailedSOPSequence rejection (StowRsRejected) — none of these are transient,
# retrying them would just waste time and could not change the outcome.
_STOW_MAX_ATTEMPTS = 3  # 1 initial attempt + 2 retries
_STOW_RETRY_DELAYS_S: tuple[float, ...] = (0.2, 0.5)  # before attempt 2, 3


# ── Exceptions ────────────────────────────────────────────────────────────────


class OrthancError(AiInferenceError):
    """Base class for all Orthanc communication errors."""


class OrthancNotFound(OrthancError):
    """Raised when a QIDO/WADO request returns 404."""


class OrthancAuthError(OrthancError):
    """Raised when Orthanc returns 401 or 403."""


class OrthancNetworkError(OrthancError):
    """Raised on transport-level failures (connection refused, timeout, …)."""


class OrthancClientError(OrthancError):
    """Raised when Orthanc returns an unexpected 4xx (not 401/403/404)."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class OrthancServerError(OrthancError):
    """Raised when Orthanc returns a 5xx response."""

    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


class StowRsRejected(OrthancError):
    """
    Raised when the STOW-RS response contains a non-empty FailedSOPSequence.

    Orthanc accepted the request but rejected one or more instances.
    """

    def __init__(self, failed_count: int, reasons: list[str]) -> None:
        reason_text = "; ".join(reasons) if reasons else "no details"
        super().__init__(
            f"STOW-RS rejected {failed_count} instance(s): {reason_text}"
        )
        self.failed_count = failed_count
        self.reasons = reasons


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
        Returns the raw multipart/related response body containing only
        pixel-data bytes (no DICOM headers). For full DICOM with all tags,
        use ``fetch_instance_full`` instead.
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

    async def fetch_instance_full(
        self,
        study_uid: str,
        series_uid: str,
        instance_uid: str,
    ) -> bytes:
        """
        WADO-RS: fetch the **full** DICOM Part-10 instance.

        Unlike ``fetch_instance_frames`` (which returns only pixel bytes),
        this returns the complete DICOM with all metadata tags
        (ImagePositionPatient, PixelSpacing, FrameOfReferenceUID, …) plus
        the pixel data. The response is multipart/related with a single
        application/dicom part — pass the result to ``_multipart_to_bytes``
        to get the bare DICOM bytes for ``pydicom.dcmread``.
        """
        path = (
            f"/dicom-web/studies/{study_uid}/series/{series_uid}"
            f"/instances/{instance_uid}"
        )
        resp = await self._get(
            path,
            accept="multipart/related; type=application/dicom",
        )
        return resp.content

    async def stow_rs_post(
        self,
        dicom_bytes: bytes,
        study_uid: str | None = None,
    ) -> dict[str, Any]:
        """
        STOW-RS: POST a single DICOM Part-10 instance to Orthanc.

        Bounded retries (plan P4.3): a transient failure — OrthancNetworkError
        (unreachable/timeout) or OrthancServerError (5xx) — is retried up to
        ``_STOW_MAX_ATTEMPTS - 1`` times with a short delay, then the last
        exception is re-raised. Every other failure (4xx, 401/403/404,
        StowRsRejected) is NOT transient and is raised immediately on the
        first attempt — retrying a request Orthanc will always reject the
        same way would only waste time.

        Endpoint
        --------
        With study_uid:    POST /dicom-web/studies/{study_uid}/
        Without study_uid: POST /dicom-web/studies

        Returns
        -------
        dict
            Parsed JSON response body containing ReferencedSOPSequence and
            FailedSOPSequence as returned by Orthanc.

        Raises
        ------
        OrthancClientError
            On 4xx responses (excluding 401/403/404 which raise their own types).
        OrthancServerError
            On 5xx responses that persisted through all retry attempts.
        OrthancNetworkError
            On transport-level failures that persisted through all retry
            attempts (connection refused, timeout).
        StowRsRejected
            When the response JSON contains a non-empty FailedSOPSequence,
            meaning Orthanc accepted the HTTP request but rejected the instance.
        """
        last_exc: OrthancNetworkError | OrthancServerError | None = None
        for attempt in range(1, _STOW_MAX_ATTEMPTS + 1):
            try:
                return await self._stow_rs_post_once(dicom_bytes, study_uid)
            except (OrthancNetworkError, OrthancServerError) as exc:
                last_exc = exc
                if attempt >= _STOW_MAX_ATTEMPTS:
                    break
                log.warning(
                    "STOW-RS transient failure on attempt %d/%d (%s) — retrying",
                    attempt,
                    _STOW_MAX_ATTEMPTS,
                    type(exc).__name__,
                )
                await asyncio.sleep(_STOW_RETRY_DELAYS_S[attempt - 1])

        assert last_exc is not None  # loop always sets it before exhausting
        raise last_exc

    async def _stow_rs_post_once(
        self,
        dicom_bytes: bytes,
        study_uid: str | None = None,
    ) -> dict[str, Any]:
        """Single STOW-RS attempt, no retries. See ``stow_rs_post`` for the
        public, retrying entry point."""
        if study_uid:
            path = f"/dicom-web/studies/{study_uid}/"
        else:
            path = "/dicom-web/studies"

        url = f"{self._base}/{path.lstrip('/')}"

        # PHI-safe path for log/exception messages: study_uid truncated, never
        # logged in full (plan P4.3). `path`/`url` above (unsanitised) are used
        # ONLY for the actual HTTP request, never for logging.
        safe_path = (
            f"/dicom-web/studies/{_safe_uid(study_uid)}/" if study_uid else path
        )

        # Build multipart/related body with a random hex boundary
        boundary = os.urandom(16).hex()
        content_type = (
            f'multipart/related; type="application/dicom"; boundary={boundary}'
        )

        # Multipart body: preamble + one part + epilogue
        body = (
            f"--{boundary}\r\n"
            f"Content-Type: application/dicom\r\n"
            f"\r\n"
        ).encode("ascii") + dicom_bytes + (
            f"\r\n--{boundary}--\r\n"
        ).encode("ascii")

        log.debug(
            "STOW-RS POST to %s (%d bytes payload)",
            safe_path,
            len(body),
        )

        try:
            resp = await self._client.post(
                url,
                content=body,
                headers={
                    "Content-Type": content_type,
                    "Accept": "application/dicom+json",
                },
            )
        except (httpx.ConnectError, httpx.TimeoutException, httpx.TransportError) as exc:
            raise OrthancNetworkError(
                f"Network error reaching Orthanc at {self._base} for STOW-RS "
                f"{safe_path}: {type(exc).__name__}"
            ) from exc

        # Map HTTP status codes to typed exceptions
        if resp.status_code in (401, 403):
            raise OrthancAuthError(
                f"Orthanc auth failed (HTTP {resp.status_code}) for STOW-RS {safe_path}"
            )
        if resp.status_code == 404:
            raise OrthancNotFound(f"Orthanc returned 404 for STOW-RS {safe_path}")
        if 400 <= resp.status_code < 500:
            raise OrthancClientError(
                f"Orthanc returned HTTP {resp.status_code} for STOW-RS {safe_path}",
                status_code=resp.status_code,
            )
        if resp.status_code >= 500:
            raise OrthancServerError(
                f"Orthanc server error HTTP {resp.status_code} for STOW-RS {safe_path}",
                status_code=resp.status_code,
            )

        # Parse the STOW-RS response
        try:
            response_json: dict[str, Any] = resp.json()
        except Exception:  # noqa: BLE001
            # Some Orthanc versions return empty body on success
            response_json = {}

        # Check for partial failures in FailedSOPSequence
        # DICOM tag 00081198 = FailedSOPSequence
        failed_seq = response_json.get("00081198", {}).get("Value", [])
        if failed_seq:
            reasons: list[str] = []
            for item in failed_seq:
                # 00081197 = FailureReason (US), 00081150 = ReferencedSOPClassUID
                reason_val = item.get("00081197", {}).get("Value", [])
                reason_str = str(reason_val[0]) if reason_val else "unknown"
                reasons.append(reason_str)
            raise StowRsRejected(failed_count=len(failed_seq), reasons=reasons)

        log.debug("STOW-RS success for %s", safe_path)
        return response_json
