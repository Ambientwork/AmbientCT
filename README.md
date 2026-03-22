# 🦷 AmbientCT

> Your practice PACS in a box — zero license fees, zero cloud dependency, one command.

A free, open-source DICOM viewer for dental and medical practices. View CBCT, CT, MRI, OPG and any DICOM images in your browser with 3D volume rendering, MPR, and measurement tools.

**By [Ambientwork](https://ambientwork.ai)** — the better OS for dental practices.

## Quick Start

```bash
git clone https://github.com/Ambientwork/AmbientCT.git
cd AmbientCT
cp .env.example .env        # Edit credentials!
docker compose up -d
open http://localhost:3000   # OHIF Viewer
```

## Features

- 🏥 **Full PACS Server** — Orthanc with DICOMweb, C-STORE, WADO
- 🧠 **3D Volume Rendering** — MPR (axial, sagittal, coronal) via Cornerstone3D
- 🦷 **Dental Presets** — Optimized Window/Level for bone, soft tissue, implants
- 📦 **One Command Deploy** — Docker Compose, works on Mac, Linux, Windows
- 🔒 **Privacy First** — Runs on your LAN, no cloud, no tracking
- 📂 **Any DICOM Source** — Drag & drop files or receive from any DICOM device

## Architecture

<!-- TODO: Architecture diagram -->

## Documentation

- [Setup Guide](docs/SETUP-GUIDE.md)
- [Architecture Decisions](docs/ARCHITECTURE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

## Built With

- [Orthanc](https://www.orthanc-server.com/) — Open-source DICOM server
- [OHIF Viewer](https://ohif.org/) — Open-source web imaging platform
- [Cornerstone3D](https://www.cornerstonejs.org/) — Medical imaging rendering engine

## Story

This project was built by a dentist using AI-powered development tools
(Claude Code + Conductor) as a showcase for what non-programmers can
build with modern AI tooling. [Read the full story →](#)

## License

MIT — Use it freely in your practice. See [LICENSE](LICENSE).

---

**Made with 🤖 by [Ambientwork](https://ambientwork.ai)** — Built with AI, for healthcare.
