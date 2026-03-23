# Changelog

All notable changes to AmbientCT will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0.0] - 2026-03-23

Initial public release — open-source DICOM viewer for dental and medical practices.

### Added
- **Orthanc PACS Server** with DICOMweb, C-STORE (DIMSE), and WADO support
- **OHIF Viewer v3.9.2** with Cornerstone3D for 3D volume rendering and MPR
- **Dental Window/Level presets**: Bone, Soft Tissue, Dental Implant, Mandibular Canal, Airway, Full Range
- **Dental hotkeys**: `L` (Length), `A` (Angle), `E` (Elliptical ROI)
- **Docker Compose deployment** — one-command setup on Mac, Linux, Windows
- **Setup wizard** (`scripts/setup.sh`) with Docker validation, `.env` generation, image pull
- **Smoke test suite** (`scripts/smoke-test.sh`) covering containers, REST API, DICOMweb, DICOM upload, OHIF
- **Backup script** (`scripts/backup.sh`) for Docker volume snapshots
- **DICOM import** (`scripts/import-dicom.sh`) with drag-and-drop, bulk, and CLI import
- **DSGVO log scrubbing** (`scripts/scrub.py`) to remove patient data from logs
- **GitHub Actions CI** — lint, smoke tests, and Docker Compose validation
- **GitHub Pages landing page** at `landing/`
- **Automated GitHub Release** workflow triggered by version tags
- **Comprehensive documentation**: Architecture, Setup Guide, Troubleshooting, Conventions

### Changed
- **docker-compose.yml**: credentials now sourced from `.env` instead of hardcoded (security fix)
- **docker-compose.yml**: ports configurable via `ORTHANC_HTTP_PORT`, `ORTHANC_DICOM_PORT`, `VIEWER_PORT` env vars

### Security
- Removed hardcoded Orthanc credentials from `docker-compose.yml`
- All secrets managed via `.env` file (gitignored)
- Orthanc Basic Auth enabled by default
- No `network_mode: host` — containers are network-isolated
