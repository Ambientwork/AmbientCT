<div align="center">

# 🦷 AmbientCT

**Your practice PACS in a box — zero license fees, zero cloud dependency, one command.**

[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](https://github.com/Ambientwork/AmbientCT)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/Ambientwork/AmbientCT?style=social)](https://github.com/Ambientwork/AmbientCT/stargazers)

A free, open-source DICOM viewer for dental and medical practices.
View CBCT, CT, MRI, OPG and all DICOM formats in your browser —
with 3D volume rendering, MPR, and measurement tools.

</div>

> A dentist built a full PACS server with zero programming background — using AI coding tools.
> One Docker command. Zero license fees. Patient data stays on your hardware.

---

## Interface

<div align="center">
<img src="docs/assets/hero.svg" width="700" alt="AmbientCT DICOM Viewer — patient list, CBCT axial view, dental presets" />
</div>

---

## Quick Start

```bash
git clone https://github.com/Ambientwork/AmbientCT.git && cd AmbientCT
cp .env.example .env          # Edit credentials before going live
docker compose up -d
```

Open **http://localhost:3000** — your PACS is running.

---

## Features

- 🏥 **Full PACS Server** — Orthanc with DICOMweb, C-STORE, and WADO support
- 🧠 **3D Volume Rendering** — Axial, sagittal, and coronal MPR via Cornerstone3D
- 🦷 **Dental Presets** — Optimized Window/Level for bone, implants, soft tissue, and mandibular canal
- 📦 **One Command Deploy** — Docker Compose, runs on Mac, Linux, and Windows
- 🔒 **Privacy First** — Fully on-premise, no cloud, no tracking, DSGVO-ready
- 📂 **Any DICOM Source** — Drag & drop files or receive from any DICOM device via DIMSE
- 🛠️ **Zero Config** — Sane defaults out of the box, `.env` for overrides
- 🆓 **Free Forever** — MIT license, no vendor lock-in

---

## Architecture

```
Browser → Nginx :443 → AmbientCT Viewer :3000   (React + WebGL, built on OHIF)
                     → Orthanc :8042        (DICOMweb REST API)
                     → Orthanc :4242        (DICOM DIMSE, LAN only)

Storage: Orthanc → SQLite + filesystem (./data/orthanc-db/)
```

| Component | Version | Role |
|-----------|---------|------|
| [Orthanc](https://www.orthanc-server.com/) | 24.12.2 | PACS server, DICOMweb, DIMSE |
| [AmbientCT Viewer](https://github.com/Ambientwork/AmbientCT) | v0.2.0 | Web imaging frontend, built on OHIF v3.9.2 |
| [Cornerstone3D](https://www.cornerstonejs.org/) | latest | 3D rendering engine |
| [ai-inference](ai-inference/) | v0.3.0 (Phase 3b-2) | AI Assist backend — demo/real DentalSegmentator (nnU-Net) inference, DICOM SEG output |
| Nginx | latest | Reverse proxy |

> The root [`VERSION`](VERSION) file (`1.0.0`) is a legacy release tag that predates this table and has not been re-cut for the current work; it is not a claim that every component below is at that maturity. Per-component versions above are the source of truth for what actually runs today. Reconciling `VERSION` with an actual release is left for a dedicated release/versioning pass, not bundled into this docs sync.

---

## AI Assist (research preview)

AmbientCT ships a Phase 3b-2 **AI Assist** layer for dental CBCT review: a local FastAPI service (`ai-inference/`, internal Docker network only, no host port) alongside the browser-side mock adapter. No image, header, or log ever leaves your machine — there is no cloud inference and no telemetry.

The service resolves one of three explicit modes on every health check and job start (never cached, never guessed): `demo` (synthetic predictor, opt-in via `AI_INFERENCE_DEMO_MODE=true`), `real` (DentalSegmentator nnU-Net, requires a downloaded and unpacked model folder), `unavailable` (no valid model and demo off — the service stays healthy, a started job fails fast with a clear reason instead of silently producing clinically-plausible synthetic output).

| Runtime-verified today (2026-08-28, isolated test stack) | Implemented but not yet runtime-verified | Intentionally out of scope for this repo |
|---|---|---|
| Demo job pipeline end-to-end: `queued → running → review_required`, findings clearly marked `isDemo=true` / `ambientct-mock-v0` | Real DentalSegmentator (nnU-Net) inference — code path is complete (correct volume spacing, `tile_step_size=0.9`, mirroring disabled, canal label defaults to `5`, hardcoded from the model's documented label scheme, not read from `dataset.json`; env-overridable via `AI_INFERENCE_CANAL_LABEL`) but **no model weights have been downloaded**; status `pending_external_artifact` | Out-of-distribution detection (stub only) |
| Demo DICOM SEG write → Orthanc STOW-RS → re-read → all per-frame source-instance references validated against the real source series (0 fabricated references) | — | Persistence of MAR mapping / review state to Orthanc metadata (in-memory + localStorage only) |
| Demo SEG persistence gated behind `AI_INFERENCE_PERSIST_DEMO_SEG` (default `false`; only enabled in the isolated `ambientct-test` stack) so nothing synthetic reaches a normal PACS instance by default | — | Structured report (DICOM SR) export |

Every suggestion is labeled **"Research Preview · Demo Data · Not for Diagnosis"** in the UI, and a persisted demo SEG carries the same marking inside the DICOM file itself (`SeriesDescription` / `ManufacturerModelName`) so it can never be mistaken for a real result in a PACS browser. See [`ai-inference/README.md`](ai-inference/README.md) for the service details and mode table, [`docs/AI-ASSIST-ARCHITECTURE.md`](docs/AI-ASSIST-ARCHITECTURE.md) for the architecture and risk controls, and [`docs/DENTAL-FEATURES-ROADMAP.md`](docs/DENTAL-FEATURES-ROADMAP.md) for the broader feature plan.

---

## Documentation

- [Setup Guide](docs/SETUP-GUIDE.md)
- [Architecture Decisions](docs/ARCHITECTURE.md)
- [AI Assist Architecture](docs/AI-ASSIST-ARCHITECTURE.md)
- [Dental Features Roadmap](docs/DENTAL-FEATURES-ROADMAP.md)
- [Dental Viewer Feature Matrix & Plan](docs/DENTAL-VIEWER-FEATURE-MATRIX-AND-PLAN.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Third-Party Notices](THIRD_PARTY_NOTICES.md)

---

## Disclaimer

AmbientCT is **not FDA- or CE-certified**. It is intended for informational and workflow purposes only. Clinical diagnostic decisions must be made by licensed healthcare professionals using certified software. The AI Assist layer is a research preview and does not perform autonomous diagnosis.

---

## Story

Built by a dentist using AI-powered development tools (Claude Code + Conductor) as a showcase for what non-programmers can build with modern AI tooling. [Read the full story →](#)

---

<div align="center">

**By [Ambientwork](https://ambientwork.ai)** — the better OS for dental practices.

MIT License · Made with 🤖 and ☕

</div>
