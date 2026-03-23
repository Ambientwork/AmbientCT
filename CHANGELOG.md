# Changelog

All notable changes to AmbientCT will be documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] - 2026-03-23

Initial public release — open-source DICOM viewer for dental and medical practices.

### Added
- **Orthanc PACS Server** with DICOMweb, C-STORE (DIMSE), and WADO support
- **OHIF Viewer v3.9.2** with Cornerstone3D for 3D volume rendering and MPR
- **Dental Window/Level presets**: Bone, Soft Tissue, Dental Implant, Mandibular Canal, Airway, Full Range, Enamel/Dentin, Root Canal, Periapical, TMJ
- **Dental hanging protocols**: CBCT → MPR 3-panel, OPG → single 2D, Intraoral → 2×2 grid
- **Dental hotkeys**: measurement tools (`L`/`A`/`E`/`B`/`N`), navigation (`Z`/`P`/`W`/`S`/`C`), viewport controls (`R`/`H`/`V`/`I`), W/L preset switching (`1`–`6`)
- **Docker Compose deployment** — one-command setup on Mac, Linux, Windows
- **Setup wizard** (`scripts/setup.sh`) — interactive wizard with `--help`, `--non-interactive` for CI, secure password generation
- **Smoke test suite** (`scripts/smoke-test.sh`) — 14 checks: containers, REST API, DICOMweb, DIMSE, OHIF, DICOM upload, volumes; `--verbose` flag
- **Backup & restore** (`scripts/backup.sh`) — `--output-dir`, `--keep`, `--restore`, `--list` flags; configurable retention
- **Bulk DICOM import** (`scripts/import-dicom.sh`) — `--recursive`, `--dry-run`, progress tracking, `.env` credential loading
- **DSGVO log scrubbing** (`scripts/scrub.py`) to remove patient data from logs
- **GitHub Actions CI** — lint, smoke tests, Docker Compose validation
- **GitHub Pages landing page** at `landing/`
- **Automated GitHub Release** workflow triggered by version tags
- **Comprehensive documentation**: Architecture, Setup Guide, Troubleshooting, Conventions

### Infrastructure
- All `docker-compose.yml` values configurable via `.env` (ports, resources, versions, logging)
- Viewer healthcheck (`curl localhost:80`)
- JSON log driver with configurable rotation (`LOG_MAX_SIZE`, `LOG_MAX_FILE`)
- Commented-out Nginx reverse proxy template for production SSL
- OHIF config mounted as `app-config.js` into viewer container

### Security
- No hardcoded credentials — all secrets via `.env` file (gitignored)
- Orthanc Basic Auth enabled by default
- Ports bound to `127.0.0.1` (localhost only)
- No `network_mode: host` — containers are network-isolated
