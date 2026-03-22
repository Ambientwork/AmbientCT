# Architecture — AmbientCT

## Stack
- **Orthanc** `orthancteam/orthanc:24.12.2` — PACS server, DICOMweb, DIMSE
- **OHIF Viewer** `ohif/app:v3.9.2` — React, Cornerstone3D, WebGL rendering
- **Nginx** — Reverse proxy, SSL (production only)
- **Docker Compose** — Orchestration

## Data flow
```
Browser → Nginx :443 → OHIF :3000 (static React)
                     → Orthanc :8042 (DICOMweb API)
                     → Orthanc :4242 (DICOM DIMSE, LAN only)

Storage: Orthanc → SQLite + filesystem (./data/orthanc-db/)
```

## Key decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Database | SQLite (not Postgres) | Single-practice simplicity |
| OHIF data source | DICOMweb (not DICOM JSON) | Standard-compliant, flexible |
| Auth | Orthanc Basic Auth | Sufficient for LAN, no Keycloak overhead |
| SSL | Self-signed (setup.sh) | Real cert optional via Let's Encrypt |
| DICOM import | Drag&drop in OHIF + CLI script | Non-technical users + power users |

## Dental-specific
Window/Level presets in `config/ohif-config.js`:
- Bone: W2000/L500
- Soft Tissue: W400/L40
- Dental Implant: W4000/L1000
- Mandibular Canal: W2500/L700
- Airway: W1600/L-600

## Brand context
Part of Ambientwork ecosystem. Giveaway for dental practice lead generation.
Not FDA/CE certified. Disclaimer required in all user-facing surfaces.
