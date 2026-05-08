"""Mock finding suggestion pipeline for Phase 3a.

In Phase 3b this module will derive findings from real segmentation results
and measurement extraction. For now it returns deterministic demo findings
that mirror the TypeScript fixtures in extensions/dental-cpr/src/ai/fixtures.ts.

The four findings cover:
  1. periodontal_bone_loss   — mandible, area_mm2 measurement
  2. periapical_radiolucency — tooth, volume_mm3 measurement
  3. sinus_opacity           — maxillary_sinus, no measurement
  4. caries_suspected        — tooth, tooth_number only

All are marked isDemo=True and reviewerState='unreviewed'.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from main import AiSourceMetadata


def build_mock_findings(
    study_instance_uid: str,
    job_id: str,
    source: "AiSourceMetadata",
) -> list[dict[str, Any]]:
    """
    Return deterministic mock AiFinding dicts for the given study.

    Keys use camelCase to match the TS AiFinding interface so that main.py
    can forward them directly into the AiFinding constructor.
    """
    uid = study_instance_uid
    return [
        {
            "findingId": f"finding-1-{uid}",
            "jobId": job_id,
            "studyInstanceUID": uid,
            "findingClass": "periodontal_bone_loss",
            "anatomyClass": "mandible",
            "confidence": 0.81,
            "uncertainty": "low",
            "reviewerState": "unreviewed",
            "measurement": {"area_mm2": 14.3, "tooth_number": 36},
            "isDemo": True,
            "description": (
                "Possible horizontal bone loss at tooth 36. "
                "Requires clinician confirmation."
            ),
        },
        {
            "findingId": f"finding-2-{uid}",
            "jobId": job_id,
            "studyInstanceUID": uid,
            "findingClass": "periapical_radiolucency",
            "anatomyClass": "tooth",
            "confidence": 0.94,
            "uncertainty": "low",
            "reviewerState": "unreviewed",
            "measurement": {"volume_mm3": 38.7, "tooth_number": 46},
            "isDemo": True,
            "description": (
                "Possible periapical radiolucency at tooth 46. "
                "Requires clinician confirmation."
            ),
        },
        {
            "findingId": f"finding-3-{uid}",
            "jobId": job_id,
            "studyInstanceUID": uid,
            "findingClass": "sinus_opacity",
            "anatomyClass": "maxillary_sinus",
            "confidence": 0.62,
            "uncertainty": "high",
            "reviewerState": "unreviewed",
            "measurement": None,
            "isDemo": True,
            "description": (
                "Possible sinus opacity, right maxillary sinus. "
                "Low confidence — requires review."
            ),
        },
        {
            "findingId": f"finding-4-{uid}",
            "jobId": job_id,
            "studyInstanceUID": uid,
            "findingClass": "caries_suspected",
            "anatomyClass": "tooth",
            "confidence": 0.74,
            "uncertainty": "medium",
            "reviewerState": "unreviewed",
            "measurement": {"tooth_number": 26},
            "isDemo": True,
            "description": (
                "Caries suspected at tooth 26. "
                "Requires clinician confirmation."
            ),
        },
    ]
