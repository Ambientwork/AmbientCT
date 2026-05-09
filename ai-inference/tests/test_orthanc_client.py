"""
tests/test_orthanc_client.py — Unit tests for OrthancClient  (Phase 3b-1)

Uses httpx.MockTransport / httpx.MockAsyncTransport so no real Orthanc is needed.

Test cases:
  test_get_series_for_study           — parses QIDO series list correctly
  test_orthanc_not_found_raises       — HTTP 404 → OrthancNotFound
  test_orthanc_auth_error_raises      — HTTP 401 → OrthancAuthError
  test_network_timeout_raises         — ConnectError → OrthancNetworkError
  test_get_series_sorted_by_number    — series returned in SeriesNumber order
  test_check_reachable_true           — /system 200 → True
  test_check_reachable_false_on_error — network failure → False (no raise)
"""

from __future__ import annotations

import json

import httpx
import pytest

from pipeline.orthanc_client import (
    OrthancAuthError,
    OrthancClient,
    OrthancNetworkError,
    OrthancNotFound,
    SeriesSummary,
)

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.0001"

# ── Minimal DICOM JSON helpers ────────────────────────────────────────────────


def _str_tag(value: str) -> dict:
    return {"vr": "UI", "Value": [value]}


def _int_tag(value: int) -> dict:
    return {"vr": "IS", "Value": [value]}


def _make_series_entry(
    series_uid: str,
    modality: str = "CT",
    series_number: int = 1,
    num_instances: int = 200,
    description: str = "CBCT",
) -> dict:
    return {
        "0020000E": _str_tag(series_uid),   # SeriesInstanceUID
        "00080060": _str_tag(modality),      # Modality
        "00200011": _int_tag(series_number), # SeriesNumber
        "00201209": _int_tag(num_instances), # NumberOfSeriesRelatedInstances
        "0008103E": {"vr": "LO", "Value": [description]},
    }


# ── Transport helpers ─────────────────────────────────────────────────────────


def _json_response(body: object, status: int = 200) -> httpx.Response:
    content = json.dumps(body).encode()
    return httpx.Response(
        status_code=status,
        headers={"Content-Type": "application/dicom+json"},
        content=content,
    )


def _make_client(handler) -> OrthancClient:
    """Build an OrthancClient backed by a mock ASGI-style handler."""
    transport = httpx.MockTransport(handler)
    client = OrthancClient.__new__(OrthancClient)
    client._base = "http://orthanc:8042"
    client._client = httpx.AsyncClient(
        transport=transport,
        auth=("admin", "secret"),
        timeout=httpx.Timeout(5.0),
    )
    return client


# ── Tests ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_get_series_for_study() -> None:
    """get_series_for_study parses a QIDO response into SeriesSummary objects."""
    body = [
        _make_series_entry("1.2.3.4.5.series1", modality="CT", series_number=1, num_instances=200),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "/dicom-web/studies/" in str(request.url)
        assert "/series" in str(request.url)
        return _json_response(body)

    async with _make_client(handler) as client:
        result = await client.get_series_for_study(STUDY_UID)

    assert len(result) == 1
    s = result[0]
    assert isinstance(s, SeriesSummary)
    assert s.series_instance_uid == "1.2.3.4.5.series1"
    assert s.modality == "CT"
    assert s.series_number == 1
    assert s.num_instances == 200


@pytest.mark.asyncio
async def test_get_series_sorted_by_number() -> None:
    """Series are returned sorted by SeriesNumber ascending."""
    body = [
        _make_series_entry("1.2.3.series3", series_number=3, num_instances=10),
        _make_series_entry("1.2.3.series1", series_number=1, num_instances=200),
        _make_series_entry("1.2.3.series2", series_number=2, num_instances=5),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response(body)

    async with _make_client(handler) as client:
        result = await client.get_series_for_study(STUDY_UID)

    assert [s.series_number for s in result] == [1, 2, 3]


@pytest.mark.asyncio
async def test_orthanc_not_found_raises() -> None:
    """HTTP 404 from Orthanc is translated to OrthancNotFound."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=404, content=b"Not Found")

    async with _make_client(handler) as client:
        with pytest.raises(OrthancNotFound):
            await client.get_series_for_study(STUDY_UID)


@pytest.mark.asyncio
async def test_orthanc_auth_error_raises_on_401() -> None:
    """HTTP 401 from Orthanc is translated to OrthancAuthError."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=401, content=b"Unauthorized")

    async with _make_client(handler) as client:
        with pytest.raises(OrthancAuthError):
            await client.get_series_for_study(STUDY_UID)


@pytest.mark.asyncio
async def test_orthanc_auth_error_raises_on_403() -> None:
    """HTTP 403 from Orthanc is translated to OrthancAuthError."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=403, content=b"Forbidden")

    async with _make_client(handler) as client:
        with pytest.raises(OrthancAuthError):
            await client.get_series_for_study(STUDY_UID)


@pytest.mark.asyncio
async def test_network_timeout_raises() -> None:
    """A ConnectError from httpx is wrapped as OrthancNetworkError."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("Connection refused")

    async with _make_client(handler) as client:
        with pytest.raises(OrthancNetworkError):
            await client.get_series_for_study(STUDY_UID)


@pytest.mark.asyncio
async def test_check_reachable_true() -> None:
    """check_reachable returns True when /system responds 200."""

    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response({"Version": "1.12.0"})

    async with _make_client(handler) as client:
        result = await client.check_reachable()

    assert result is True


@pytest.mark.asyncio
async def test_check_reachable_false_on_network_error() -> None:
    """check_reachable returns False (no raise) on connection failure."""

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    async with _make_client(handler) as client:
        result = await client.check_reachable()

    assert result is False


@pytest.mark.asyncio
async def test_list_instances_sorted() -> None:
    """list_instances returns InstanceSummary objects sorted by InstanceNumber."""
    body = [
        {"00080018": _str_tag("1.2.3.sop3"), "00200013": _int_tag(3)},
        {"00080018": _str_tag("1.2.3.sop1"), "00200013": _int_tag(1)},
        {"00080018": _str_tag("1.2.3.sop2"), "00200013": _int_tag(2)},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        return _json_response(body)

    async with _make_client(handler) as client:
        result = await client.list_instances(STUDY_UID, "1.2.3.series")

    assert [i.instance_number for i in result] == [1, 2, 3]
    assert result[0].sop_instance_uid == "1.2.3.sop1"
