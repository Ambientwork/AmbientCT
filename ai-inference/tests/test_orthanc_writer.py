"""
tests/test_orthanc_writer.py — Unit tests for pipeline/orthanc_writer.py  (Phase 3b-2)

All tests mock the OrthancClient.stow_rs_post method so no real Orthanc is needed.

Tests:
  test_upload_segmentations_success_path         — all SEGs succeed
  test_upload_per_seg_failure_continues_others   — first fails 4xx, second succeeds
  test_upload_orthanc_unreachable_raises         — OrthancNetworkError bubbles up
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from pipeline.orthanc_client import (
    OrthancClientError,
    OrthancNetworkError,
    StowRsRejected,
)
from pipeline.orthanc_writer import UploadedSegmentation, upload_segmentations
from pipeline.seg_writer import WrittenSegmentation

STUDY_UID = "1.2.840.10008.5.1.4.1.1.2.9999.STUDY"


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_written(anatomy_class: str, index: int = 0) -> WrittenSegmentation:
    """Build a minimal WrittenSegmentation for testing."""
    return WrittenSegmentation(
        anatomy_class=anatomy_class,
        sop_instance_uid=f"1.2.3.sop.{index}",
        series_instance_uid=f"1.2.3.series.{index}",
        dicom_bytes=b"\x00" * 16,  # fake DICOM bytes
    )


def _make_client(stow_side_effect=None, stow_return_value=None) -> MagicMock:
    """Build a mock OrthancClient with a configurable stow_rs_post."""
    client = MagicMock()
    if stow_side_effect is not None:
        client.stow_rs_post = AsyncMock(side_effect=stow_side_effect)
    elif stow_return_value is not None:
        client.stow_rs_post = AsyncMock(return_value=stow_return_value)
    else:
        # Default: success with a minimal STOW-RS response
        client.stow_rs_post = AsyncMock(
            return_value={
                "00081199": {  # ReferencedSOPSequence
                    "vr": "SQ",
                    "Value": [{"00081155": {"vr": "UI", "Value": ["1.2.3.sop.0"]}}],
                }
            }
        )
    return client


# ── Tests ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_upload_segmentations_success_path() -> None:
    """
    Both SEGs upload successfully.
    Result list has two entries, both success=True, error_message=None.
    """
    written = [
        _make_written("mandibular_canal", 0),
        _make_written("mandible", 1),
    ]
    # Return a valid STOW-RS response for every call
    success_response = {
        "00081199": {
            "vr": "SQ",
            "Value": [{"00081155": {"vr": "UI", "Value": ["1.2.3.sop"]}}],
        }
    }
    client = _make_client(stow_return_value=success_response)

    results = await upload_segmentations(client, written, STUDY_UID)

    assert len(results) == 2
    for result in results:
        assert isinstance(result, UploadedSegmentation)
        assert result.success is True
        assert result.error_message is None

    assert results[0].anatomy_class == "mandibular_canal"
    assert results[1].anatomy_class == "mandible"

    # stow_rs_post was called once per SEG
    assert client.stow_rs_post.call_count == 2


@pytest.mark.asyncio
async def test_upload_per_seg_failure_continues_others() -> None:
    """
    Two SEGs: first upload raises OrthancClientError (4xx), second succeeds.
    Result list reflects both outcomes; processing continues after the first failure.
    """
    written = [
        _make_written("mandibular_canal", 0),
        _make_written("mandible", 1),
    ]

    success_response = {
        "00081199": {"vr": "SQ", "Value": []}
    }
    client_error = OrthancClientError(
        "HTTP 422 Unprocessable Entity", status_code=422
    )

    # First call fails, second call succeeds
    client = _make_client(
        stow_side_effect=[client_error, success_response]
    )
    # Second call should return dict, so we use side_effect list;
    # AsyncMock with side_effect=[exception, value] works: exception raises, value returns
    client.stow_rs_post.side_effect = [
        client_error,
        success_response,  # AsyncMock returns this dict on second call
    ]

    results = await upload_segmentations(client, written, STUDY_UID)

    assert len(results) == 2

    # First result: failure
    first = results[0]
    assert first.anatomy_class == "mandibular_canal"
    assert first.success is False
    assert first.error_message is not None
    assert "OrthancClientError" in first.error_message

    # Second result: success
    second = results[1]
    assert second.anatomy_class == "mandible"
    assert second.success is True
    assert second.error_message is None

    # Both were attempted
    assert client.stow_rs_post.call_count == 2


@pytest.mark.asyncio
async def test_upload_orthanc_unreachable_raises() -> None:
    """
    If OrthancNetworkError is raised (Orthanc unreachable), it must bubble up
    immediately — no result list, no swallowing.
    """
    written = [
        _make_written("mandibular_canal", 0),
        _make_written("mandible", 1),
    ]
    network_error = OrthancNetworkError("Connection refused")
    client = _make_client(stow_side_effect=network_error)

    with pytest.raises(OrthancNetworkError):
        await upload_segmentations(client, written, STUDY_UID)

    # Only the first SEG was attempted before the error propagated
    assert client.stow_rs_post.call_count == 1


@pytest.mark.asyncio
async def test_upload_stow_rs_rejected_is_per_seg_failure() -> None:
    """StowRsRejected (partial DICOM rejection) counts as a per-SEG failure, not a crash."""
    written = [_make_written("mandibular_canal", 0)]
    rejection = StowRsRejected(failed_count=1, reasons=["0110"])
    client = _make_client(stow_side_effect=rejection)

    results = await upload_segmentations(client, written, STUDY_UID)

    assert len(results) == 1
    assert results[0].success is False
    assert results[0].error_message is not None
    assert "StowRsRejected" in results[0].error_message or "rejected" in results[0].error_message.lower()


@pytest.mark.asyncio
async def test_upload_result_preserves_uids() -> None:
    """UploadedSegmentation carries the sop/series UIDs from WrittenSegmentation."""
    seg = _make_written("tooth", 7)
    success_response: dict = {}
    client = _make_client(stow_return_value=success_response)

    results = await upload_segmentations(client, [seg], STUDY_UID)

    assert results[0].sop_instance_uid == seg.sop_instance_uid
    assert results[0].series_instance_uid == seg.series_instance_uid
