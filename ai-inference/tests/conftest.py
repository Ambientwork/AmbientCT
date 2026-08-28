"""
tests/conftest.py — shared pytest fixtures for the AI Inference test suite.

AI_INFERENCE_DEMO_MODE defaults to "true" (and AI_MODEL_PATH is cleared) for
every test so the suite never depends on the host's ambient environment —
in particular it must not accidentally pick up a real AI_MODEL_PATH from
the developer's shell or docker-compose .env. This mirrors plan §9 P2.1
("für Tests explizit Demo-Modus verwenden").

monkeypatch is function-scoped, so any test that needs a different mode
(unavailable, real) simply requests `monkeypatch` itself and calls
`monkeypatch.setenv(...)` / `monkeypatch.delenv(...)` locally — that
test-local call always wins over this autouse default because both share
the same MonkeyPatch instance for that test node.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _default_demo_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_INFERENCE_DEMO_MODE", "true")
    monkeypatch.delenv("AI_MODEL_PATH", raising=False)
    monkeypatch.delenv("AI_INFERENCE_PERSIST_DEMO_SEG", raising=False)
