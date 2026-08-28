# AmbientCT AI Inference Service

**Phase 3b-2 — service version 0.3.0.**
Three explicit modes: `demo` (synthetic predictor), `real` (DentalSegmentator
nnU-Net, requires a downloaded and unpacked model folder), `unavailable`
(demo off and no valid model — jobs fail fast with a clear reason, the
service itself stays healthy). Research preview. Not for clinical diagnosis.

## What this service is

A FastAPI microservice that implements the **Inference-Adapter-API** defined in
`docs/AI-ASSIST-ARCHITECTURE.md`. It lives inside the internal Docker network
(`pacs-net`) and is never exposed to the browser directly — all requests route
through the OHIF Viewer's reverse proxy.

## Relationship to the TypeScript adapter

`extensions/dental-cpr/src/ai/inferenceClient.ts` (`InferenceClient`) speaks
the same JSON contract in both modes:

| Mode | Trigger | Backed by |
|---|---|---|
| Mock | no `baseUrl` configured (default) | in-browser, `FindingsStore` + `localStorage`, no network |
| HTTP | `baseUrl` configured — wired from `AI_INFERENCE_ENABLED=true` / `AI_INFERENCE_BASE_URL` in `.env.example` | real `fetch()` calls to this FastAPI service, proxied through the viewer's nginx at `/api/ai/*` |

Both modes speak the same JSON contract. Switching from mock to HTTP is a
config change, not a code change.

## Endpoint table

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ai/health` | Liveness + version check |
| POST | `/api/ai/jobs` | Start inference job for a study |
| GET | `/api/ai/jobs/{jobId}` | Poll job status and progress |
| GET | `/api/ai/findings/{studyInstanceUID}` | List findings for a study |
| GET | `/api/ai/segmentations/{studyInstanceUID}` | List segmentation metadata |
| POST | `/api/ai/findings/{findingId}/review` | Submit accept / reject / edit |

## Running standalone for development

```bash
cd ai-inference
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn main:app --reload
# API docs: http://localhost:8000/docs
```

## Running tests

Host venv (Python 3.11 recommended — the repo's Docker `test` stage is the
canonical, reproducible way to run these; see `docs/TESTING.md`):

```bash
pytest tests/ -v
```

Reproducible Docker test stage (does not require torch/nnunetv2 — the unit
suite only imports them lazily inside real-inference code paths):

```bash
docker build --target test -t ambientct/ai-inference:test .
docker run --rm ambientct/ai-inference:test
```

**Known build issue, confirmed 2026-08-28 (still unresolved):** building the
default target (the production runtime stage, which installs
`requirements.txt`) currently fails with `pip`
`ResolutionImpossible` — `nnunetv2==2.5.1` pins `numpy==2.2.0`, which
conflicts with `pydicom-seg==0.4.1`'s `numpy<2.0.0` constraint. This does
**not** affect the `test` stage above (it uses the separate, lighter
`requirements-test.txt` and never imports torch/nnunetv2), but it does block
`docker build -t ambientct/ai-inference:latest .` and therefore
`docker compose build ai-inference` outright. Whoever next touches
`requirements.txt` should treat this as a real, reproduced build blocker,
not a hypothetical risk.

## Mode resolution (`demo` | `real` | `unavailable`)

`pipeline/inference_mode.py`'s `resolve_inference_mode()` is the single
source of truth, called fresh on every health check and every job start (no
import-time caching):

| Mode | Condition | Behavior |
|---|---|---|
| `demo` | `AI_INFERENCE_DEMO_MODE=true` | Synthetic mock predictor (`ambientct-mock-v0`). Job pipeline sleeps briefly then returns deterministic demo findings. Findings and, if persisted, the DICOM SEG file itself are marked `isDemo=true` / `[DEMO DATA — Research Preview, Not for Diagnosis]`. |
| `real` | Demo off AND `AI_MODEL_PATH` points at a valid, **unpacked** nnU-Net folder (`dataset.json` + `plans.json` + at least one `fold_*/`) | Real DentalSegmentator inference. |
| `unavailable` | Demo off AND the model path is missing, unset, or invalid (including the raw `.zip` — it is rejected, never handed to nnU-Net) | `/api/ai/health` stays HTTP 200 (liveness); a started job fails fast with a PHI-free reason instead of loading a full CBCT volume first. |

A configured-but-missing model never silently falls back to synthetic
clinically-plausible output — that is exactly what `unavailable` prevents.

## Demo SEG persistence

`AI_INFERENCE_PERSIST_DEMO_SEG` (default `false`) controls whether a demo
job's synthetic DICOM SEG is written to Orthanc via STOW-RS:

- `false` (production default): the demo result stays in the API's
  in-memory job/findings state only — nothing synthetic is ever persisted
  to the normal PACS instance.
- `true`: used **only** in the isolated test stack
  (`docker-compose.test.yml`) to exercise the full write/upload/roundtrip
  path. The persisted SEG's `SeriesDescription` and
  `ManufacturerModelName`/`SegmentAlgorithmName` carry the demo marker so it
  can never be mistaken for a real result in a PACS browser.

## Phase 3b-2 — Real Model Setup

### One-time model download

Run this from the project root **before** `docker compose up` (this step is
`pending_external_artifact` — no weights are downloaded or bundled by this
repo; nothing runs it automatically):

```bash
bash scripts/download-models.sh --help          # usage
bash scripts/download-models.sh --verify-only   # check without touching the network
bash scripts/download-models.sh --yes           # explicit, non-interactive download authorization
```

The script:
1. Shows model details (name, URL, license, size) and, without `--yes`,
   asks for interactive confirmation before any network access.
2. Downloads `Dataset111_453CT_v100.zip` (~175 MB) from the GitHub release
   or the Zenodo fallback, to a temporary file with an atomic rename.
3. **Unpacks the ZIP into a deterministic folder**
   (`data/ai-models/mandibular-canal/Dataset111_453CT_v100/`) and
   structurally validates it (`dataset.json`, `plans.json`, `fold_*/`) —
   this unpacked folder, not the ZIP, is the path the pipeline ever reads.
4. Verifies SHA256 (prints the hash if not yet pinned in the script — an
   unpinned hash is trust-on-first-download, not a passed production gate).
5. Writes `data/ai-models/mandibular-canal/MODEL_CARD.md` with full
   provenance, but only after the unpacked folder passes validation.

### Hardware notes — Docker CPU path (resilient default, plan §3.3)

| Parameter | Value |
|-----------|-------|
| Container mem_limit | 8 GB (`AI_INFERENCE_MEM_LIMIT` in `.env.example`) |
| Inference config | `tile_step_size=0.9`, mirroring/TTA disabled (`use_mirroring=False`) — hardcoded in `pipeline/segmentation.py`, not env-configurable |
| Device | `cpu` is the Docker Compose default (`AI_INFERENCE_DEVICE=cpu`). `mps` is **not** promised as acceleration inside the linux/amd64 container — it is only meaningful for an optional native macOS development path outside Docker. |

**If you hit OOM in Docker Desktop:**
1. Go to Preferences → Resources → Memory → increase the allocation.
2. Go to Preferences → Resources → Swap → set a few GB of headroom.
3. Restart Docker Desktop and re-try.

Docker's `mem_limit` is the hard memory boundary. The in-process RSS
watchdog (`pipeline/segmentation.py`) is **observational only** — cancelling
its `asyncio.to_thread()` task does not reliably stop the underlying
inference thread, so it cannot promise a clean abort; a genuinely
OOM-approaching job is stopped by Docker killing the container, not by the
watchdog. Process-level worker isolation is a documented open item, not yet
implemented.

### Model card

See `data/ai-models/mandibular-canal/MODEL_CARD.md` (generated by the download
script) for the full provenance, label scheme, and attribution.

**Quick reference:**

- **Model**: DentalSegmentator v1.0.0-alpha (nnU-Net v2)
- **License**: Apache-2.0
- **Paper**: Dot G et al., *Journal of Dentistry* 2024, doi:10.1016/j.jdent.2024.105130
- **Zenodo**: https://zenodo.org/records/10829675
- **Mandibular canal label ID**: **5**
  (model outputs 5 classes: 1=maxilla, 2=mandible, 3=upper teeth, 4=lower teeth, 5=canal)

### Environment variables

See `.env.example` for the full, current, commented list. Summary:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AI_INFERENCE_DEMO_MODE` | `false` | Forces the synthetic mock predictor regardless of `AI_MODEL_PATH`. |
| `AI_INFERENCE_PERSIST_DEMO_SEG` | `false` | Whether a demo job's SEG is written to Orthanc (isolated test stack only). |
| `AI_MODEL_PATH` | `/models/mandibular-canal/Dataset111_453CT_v100` | Path to the **unpacked** nnU-Net model folder inside the container — never the `.zip`. |
| `AI_INFERENCE_DEVICE` | `cpu` | `cpu` (Docker default) or `mps` (native macOS dev only). |
| `AI_INFERENCE_CANAL_LABEL` | `5` | nnU-Net label ID extracted as the mandibular canal — the model's own label metadata (1=maxilla, 2=mandible, 3=upper teeth, 4=lower teeth, 5=canal). A wrong value here does not fail loudly, it silently extracts the wrong anatomy. |
| `PYTORCH_ENABLE_MPS_FALLBACK` | `1` | Routes unsupported MPS ops to CPU when `AI_INFERENCE_DEVICE=mps`. |

There is deliberately **no** `AI_INFERENCE_PATCH_SIZE` variable — nnU-Net's
sliding-window patch size is fixed by the trained model's own `plans.json`
and was never actually wired to this option; it was removed rather than
left as a no-op.

## Docker (in docker-compose network)

```yaml
ai-inference:
  build: ./ai-inference
  networks: [pacs-net]   # no ports: — no host-port exposure
  mem_limit: ${AI_INFERENCE_MEM_LIMIT:-8g}
  volumes:
    - ./data/ai-models:/models:ro
  environment:
    - ORTHANC_URL=http://orthanc:8042
    - AI_MODEL_PATH=${AI_MODEL_PATH:-/models/mandibular-canal/Dataset111_453CT_v100}
    - AI_INFERENCE_DEVICE=${AI_INFERENCE_DEVICE:-cpu}
    - AI_INFERENCE_CANAL_LABEL=${AI_INFERENCE_CANAL_LABEL:-5}
    - AI_INFERENCE_DEMO_MODE=${AI_INFERENCE_DEMO_MODE:-false}
    - AI_INFERENCE_PERSIST_DEMO_SEG=${AI_INFERENCE_PERSIST_DEMO_SEG:-false}
    - PYTORCH_ENABLE_MPS_FALLBACK=1
```

This mirrors the actual `docker-compose.yml` service definition — `cpu` is
the real, resilient Compose default; `mps` is not promised inside this
container (plan §3.3).
