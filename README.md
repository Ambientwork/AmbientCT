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

---

## Screenshots

<!-- TODO: Add screenshots -->
| OHIF Viewer | 3D Volume Rendering | MPR View |
|:-----------:|:-------------------:|:--------:|
| *(screenshot)* | *(screenshot)* | *(screenshot)* |

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
Browser → Nginx :443 → OHIF Viewer :3000   (React + WebGL)
                     → Orthanc :8042        (DICOMweb REST API)
                     → Orthanc :4242        (DICOM DIMSE, LAN only)

Storage: Orthanc → SQLite + filesystem (./data/orthanc-db/)
```

| Component | Version | Role |
|-----------|---------|------|
| [Orthanc](https://www.orthanc-server.com/) | 24.12.2 | PACS server, DICOMweb, DIMSE |
| [OHIF Viewer](https://ohif.org/) | v3.9.2 | Web imaging frontend |
| [Cornerstone3D](https://www.cornerstonejs.org/) | latest | 3D rendering engine |
| Nginx | latest | Reverse proxy |

---

## Documentation

- [Setup Guide](docs/SETUP-GUIDE.md)
- [Architecture Decisions](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

---

## Disclaimer

AmbientCT is **not FDA- or CE-certified**. It is intended for informational and workflow purposes only. Clinical diagnostic decisions must be made by licensed healthcare professionals using certified software.

---

## Story

Built by a dentist using AI-powered development tools (Claude Code + Conductor) as a showcase for what non-programmers can build with modern AI tooling. [Read the full story →](#)

---

<div align="center">

**By [Ambientwork](https://ambientwork.ai)** — the better OS for dental practices.

MIT License · Made with 🤖 and ☕

</div>
