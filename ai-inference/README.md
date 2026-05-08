# AmbientCT AI Inference Service

**Phase 3a — mock pipeline, no model loaded.**
Research preview. Not for clinical diagnosis.

## What this service is

A FastAPI microservice that implements the **Inference-Adapter-API** defined in
`docs/AI-ASSIST-ARCHITECTURE.md`. It lives inside the internal Docker network
(`pacs-net`) and is never exposed to the browser directly — all requests route
through the OHIF Viewer's reverse proxy.

## Relationship to the TypeScript adapter

`extensions/dental-cpr/src/ai/inferenceClient.ts` switches between two adapters
via the `VITE_AI_ADAPTER` environment variable:

| `VITE_AI_ADAPTER` | Backed by |
|---|---|
| `mock` | `MockAIAdapter` — in-browser, localStorage, no network |
| `http` | `HttpAIAdapter` — calls this FastAPI service |

Both adapters speak the same JSON contract. Switching from mock to real is a
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

```bash
pytest tests/ -v
```

## Phase 3a status

- All inference is **mocked** — no model weights, no DICOM I/O.
- The mock pipeline sleeps 2 s (queued → running) + 2 s (running → review_required)
  and returns deterministic demo findings mirroring `fixtures.ts`.
- `model_loaded: false` in the health response confirms no real model is active.
- The `models/` directory is intentionally empty — Phase 3b adds weight files
  via a Docker volume mount (`./data/ai-models:/models:ro`).

## Phase 3b plan

- Load **DentalSegmentator** (nnU-Net) weights from `/models` volume.
- Fetch DICOM volume from Orthanc via DICOMweb WADO-RS.
- Run `pipeline/quality_check.py` → `pipeline/normalize.py` → `pipeline/segmentation.py`.
- Derive findings from segmentation results in `pipeline/findings.py`.
- Push DICOM SEG output to Orthanc (STOW-RS).

## Docker (in docker-compose network)

```yaml
ai-inference:
  build: ./ai-inference
  networks: [pacs-net]   # no ports: — no host-port exposure
  volumes:
    - ./data/ai-models:/models:ro
  environment:
    - ORTHANC_URL=http://orthanc:8042
```
