# syntax=docker/dockerfile:1
# =============================================================================
# AmbientCT ai-inference — Multi-stage Dockerfile (Phase 3b-2)
#
# Stage 1 (builder): compiles/installs all production Python deps into ~/.local
# Stage 2 (test):    independent, lightweight unit-test environment (P2.1) —
#                     not built FROM builder, not used by runtime
# Stage 3 (runtime):  copies builder's installed packages — no build tools
#
# Hardware target: Apple Silicon M4 Mac mini, 8 GB container limit.
#   PYTORCH_ENABLE_MPS_FALLBACK=1 routes unsupported MPS ops to CPU.
#   No CUDA; torch CPU/MPS only.
#
# Image size: ~2.5–3 GB (builder discards build-essential, keeps torch + nnunet)
# =============================================================================

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.11-slim-bookworm AS builder

# build-essential: needed to compile C extensions (acvl-utils, scikit-learn, etc.)
# libgl1-mesa-glx / libglib2.0-0: OpenCV headless runtime (also needed at build)
# NOTE: Bookworm (Debian 12) still has libgl1-mesa-glx.
#       If base image moves to Trixie (Debian 13), replace with libgl1.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY requirements.txt .

# --user installs into /root/.local so it can be COPY'd to the runtime stage
# --no-cache-dir keeps layer size down
RUN pip install --user --no-cache-dir -r requirements.txt


# ── Stage 2: test image (P2.1) ────────────────────────────────────────────────
# Reproducible Python 3.11 unit-test environment. NOT built FROM builder and
# NOT referenced by the runtime stage below, so `docker build` (no --target,
# or --target runtime) never builds this stage and the production image
# stays pytest-free.
#
#   docker build --target test -t ambientct/ai-inference:test ai-inference/
#   docker run --rm ambientct/ai-inference:test
#
# Uses requirements-test.txt, NOT requirements.txt + requirements-dev.txt:
# torch/torchvision/nnunetv2 are heavy and the unit test suite never
# imports them at collection time (they are lazily imported only inside
# pipeline/segmentation.py's real-inference code paths — see
# requirements-test.txt for the full explanation and the `real_model`
# pytest marker for the test category this stage does not cover).
# requirements-test.txt pins the same numpy==1.26.4 as requirements.txt so
# this stage stays production-representative. This stage must never be
# reported as a passed real-model gate.
#
# No real model weights are required or expected: AI_INFERENCE_DEMO_MODE=true
# is set explicitly below so resolve_inference_mode() always resolves to the
# synthetic demo predictor inside this image, matching plan §9 P2.1. Test
# files also override env vars locally per-test via tests/conftest.py.
FROM python:3.11-slim-bookworm AS test

# libgl1-mesa-glx / libglib2.0-0: SimpleITK runtime deps (same as runtime stage)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-test.txt .
RUN pip install --no-cache-dir -r requirements-test.txt

COPY . .

ENV PYTHONPATH=/app \
    AI_INFERENCE_DEMO_MODE=true \
    AI_INFERENCE_PERSIST_DEMO_SEG=false \
    PYTORCH_ENABLE_MPS_FALLBACK=1

CMD ["pytest", "tests", "-q"]


# ── Stage 3: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm

# Keep in sync with SERVICE_VERSION in main.py and the ai-inference row in
# README.md's component table — three places, one number (plan §14 P7.1).
LABEL org.opencontainers.image.title="ambientct-ai-inference" \
      org.opencontainers.image.version="0.3.0" \
      org.opencontainers.image.description="AmbientCT AI Assist inference service — Phase 3b-2, demo/real DentalSegmentator (nnU-Net) mandibular-canal segmentation" \
      org.opencontainers.image.licenses="MIT"

# Runtime-only native libs (no build-essential — that stays in builder)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 aiuser

WORKDIR /app

# Pull installed packages from builder
COPY --from=builder /root/.local /home/aiuser/.local

ENV PATH=/home/aiuser/.local/bin:$PATH \
    PYTHONPATH=/home/aiuser/.local/lib/python3.11/site-packages \
    # Apple Silicon: fall back unsupported MPS ops to CPU automatically
    PYTORCH_ENABLE_MPS_FALLBACK=1 \
    # nnU-Net environment variables (paths overridable via docker-compose.yml)
    nnUNet_raw=/tmp/nnunet_raw \
    nnUNet_preprocessed=/tmp/nnunet_preprocessed \
    nnUNet_results=/tmp/nnunet_results

# Copy application source (owned by aiuser for security)
COPY --chown=aiuser:aiuser . .

USER aiuser

EXPOSE 8000

# Liveness probe: hits the /api/ai/health endpoint.
# start-period=60s because torch + nnunet model loading takes time on first start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import urllib.request as r; r.urlopen('http://localhost:8000/api/ai/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
