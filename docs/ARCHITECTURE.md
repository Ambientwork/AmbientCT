# Architecture — AmbientCT

## Überblick

AmbientCT ist ein lokaler PACS-Server für Zahnarzt- und Arztpraxen.
Orthanc speichert und verwaltet DICOM-Bilder, OHIF zeigt sie im Browser an.
Alles läuft in Docker-Containern auf einem lokalen Rechner — keine Cloud.

## Stack

| Komponente | Image / Version | Rolle |
|------------|----------------|-------|
| **Orthanc** | `orthancteam/orthanc:latest` | PACS-Server: DICOM-Speicher, DICOMweb-API, DIMSE C-STORE |
| **OHIF Viewer** | `ohif/app:v3.9.2` | Web-basierter DICOM-Viewer (React, Cornerstone3D, WebGL) |
| **Nginx** | (Produktion) | Reverse Proxy, SSL-Terminierung |
| **Docker Compose** | — | Container-Orchestrierung |

## Architektur-Diagramm

```
┌─────────────────────────────────────────────────────┐
│                   Praxis-Netzwerk                   │
│                                                     │
│  ┌──────────┐        ┌──────────────────────────┐   │
│  │  Browser  │───────▶│  OHIF Viewer :3000       │   │
│  │  (Arzt)  │        │  React + Cornerstone3D   │   │
│  └──────────┘        │  WebGL 3D-Rendering      │   │
│                      └──────────┬───────────────┘   │
│                                 │ DICOMweb (REST)   │
│                                 ▼                   │
│  ┌──────────┐        ┌──────────────────────────┐   │
│  │ CBCT /   │──DIMSE─▶│  Orthanc PACS :8042     │   │
│  │ DVT /    │ C-STORE │  :4242 (DICOM)          │   │
│  │ Scanner  │        │  DICOMweb + REST API     │   │
│  └──────────┘        └──────────┬───────────────┘   │
│                                 │                   │
│                      ┌──────────▼───────────────┐   │
│                      │  SQLite + Dateisystem    │   │
│                      │  Docker Volume           │   │
│                      │  (orthanc-db)            │   │
│                      └──────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Produktions-Setup (optional, mit Nginx)

```
Browser → Nginx :443 (SSL) ──┬──▶ OHIF :3000  (statische React-App)
                             └──▶ Orthanc :8042 (DICOMweb-API)

Scanner → Orthanc :4242 (DICOM DIMSE, nur LAN)
```

## Datenfluss

### 1. Bild-Import
```
DICOM-Datei ──▶ Orthanc REST API (POST /instances)
                     │
                     ▼
              Orthanc speichert:
              - DICOM-Datei → Dateisystem (/var/lib/orthanc/db/)
              - Metadaten → SQLite-Index
              - Tags → Patient, Study, Series, Instance Hierarchie
```

### 2. Bild-Anzeige
```
OHIF Viewer ──QIDO-RS──▶ Orthanc: "Welche Studien gibt es?"
                              │
                              ▼
                         Studienliste (JSON)
                              │
OHIF Viewer ──WADO-RS──▶ Orthanc: "Gib mir Serie X"
                              │
                              ▼
                         DICOM Pixel-Daten
                              │
                    Cornerstone3D rendert:
                    - Axial / Sagittal / Koronal (MPR)
                    - 3D Volume Rendering
                    - Messungen, Annotationen
```

### 3. DICOM-Netzwerk (C-STORE)
```
CBCT-Scanner ──C-STORE──▶ Orthanc :4242
                              │
                              ▼
                         Empfängt DICOM-Dateien
                         Speichert automatisch
                         Erscheint sofort in OHIF
```

## Architektur-Entscheidungen

| Entscheidung | Wahl | Warum | Alternativen verworfen |
|-------------|------|-------|----------------------|
| **Datenbank** | SQLite | Eine Praxis = ein Server. Kein DBA nötig, kein Postgres-Setup. Backup = eine Datei. | PostgreSQL (zu komplex für Einzelpraxis) |
| **OHIF-Datenquelle** | DICOMweb | Industriestandard, flexibel, kompatibel mit allen DICOM-Viewern | DICOM JSON (proprietär) |
| **Authentifizierung** | Orthanc Basic Auth | Ausreichend für LAN. Einfach zu konfigurieren. | Keycloak (Overkill für lokales Setup) |
| **SSL** | Self-signed (optional) | Für LAN ausreichend. Let's Encrypt für externe Zugänge. | Immer SSL erzwingen (verhindert schnellen Start) |
| **Container-Runtime** | Docker Compose | Einfachstes Deployment. Kein Kubernetes nötig. | K8s (Overkill), Native Install (nicht portabel) |
| **Speicher** | Docker Volume | Persistiert über Container-Neustarts. Einfaches Backup. | Bind Mount (OS-abhängig) |
| **Import-Methode** | Drag & Drop + CLI + DIMSE | Drei Wege für drei Nutzertypen: Arzt, Admin, Scanner | Nur CLI (nicht für Zahnärzte) |

## Dental-Kontext

### Window/Level-Presets

Zahnmedizinische Bildgebung (CBCT, DVT) braucht andere Fenstereinstellungen als allgemeine Radiologie. AmbientCT liefert optimierte Presets in `config/ohif-config.js`:

| Preset | Window | Level | Anwendung |
|--------|--------|-------|-----------|
| **Bone (Standard)** | 2000 | 500 | Knochenstrukturen, Standard-Ansicht |
| **Soft Tissue** | 400 | 40 | Weichgewebe, Schleimhäute |
| **Dental Implant** | 4000 | 1000 | Implantate, Metallrestaurationen |
| **Mandibular Canal** | 2500 | 700 | Nervus alveolaris inferior (Implantatplanung) |
| **Airway** | 1600 | -600 | Atemwege (Kieferorthopädie, Schlafmedizin) |
| **Full Range** | 4096 | 1024 | Kompletter Hounsfield-Bereich |

### Typische Anwendungsfälle

1. **Implantatplanung:** CBCT laden → Mandibular Canal Preset → Nervkanal identifizieren → Messen (Length-Tool)
2. **Weisheitszahn-OP:** DVT laden → Bone Preset → Lagebeziehung zum Nerv beurteilen
3. **KFO-Diagnostik:** CBCT laden → Airway Preset → Atemwegsdurchmesser messen
4. **Endodontie:** CBCT laden → Bone Preset → Wurzelkanäle und periapikale Läsionen darstellen

### Hotkeys

| Taste | Funktion |
|-------|----------|
| `L` | Längen-Messung |
| `A` | Winkel-Messung |
| `E` | Elliptische ROI |

## Ressourcen-Limits

| Container | RAM | CPU | Begründung |
|-----------|-----|-----|-----------|
| Orthanc | 512 MB | 1.0 | DICOM-Parsing, Index-Operationen |
| OHIF Viewer | 256 MB | 0.5 | Statische Dateien, Nginx-Auslieferung |

> Das Rendering passiert im Browser (WebGL/GPU), nicht auf dem Server.
> Server-Ressourcen sind primär für Speichern und Ausliefern.

## Netzwerk

```
┌─────────────────────┐
│    pacs-net          │  Docker Bridge Network
│                     │
│  orthanc ◄──────► viewer
│  :8042, :4242       :80 (intern) → :3000 (host)
└─────────────────────┘
```

- Orthanc und OHIF kommunizieren über das interne Docker-Netzwerk `pacs-net`
- OHIF startet erst, wenn Orthanc `healthy` ist (`depends_on: condition: service_healthy`)
- Von außen erreichbar: Port 3000 (Viewer), Port 8042 (Orthanc-API), Port 4242 (DICOM)

## Sicherheit

- Kein `network_mode: host` — Container sind isoliert
- Orthanc Basic Auth ist aktiviert — kein anonymer Zugriff
- Credentials in `.env` (gitignored) — nicht im Code
- Kein externer Analytics/Tracking
- DSGVO: Scrubbing-Skript für Logs (`scripts/scrub.py`)

## Dateien

| Datei | Zweck |
|-------|-------|
| `docker-compose.yml` | Container-Definition, Ports, Volumes, Netzwerk |
| `.env.example` | Vorlage für Umgebungsvariablen |
| `config/orthanc.json` | Orthanc-Konfiguration (Ports, Plugins, DICOMweb) |
| `config/ohif-config.js` | OHIF-Konfiguration (Datenquelle, Presets, Hotkeys) |
| `scripts/setup.sh` | Erstinstallation (Docker-Check, .env, Image-Pull) |
| `scripts/backup.sh` | DICOM-Daten-Backup (Docker Volume → tar.gz) |
| `scripts/smoke-test.sh` | Automatischer Funktionstest aller Komponenten |
| `scripts/scrub.py` | DSGVO-Log-Scrubbing (entfernt Patientendaten) |

## Brand-Kontext

- Teil des Ambientwork-Ökosystems
- Kostenlose Giveaway-Software für Praxis-Leadgenerierung
- **Nicht** als Medizinprodukt zertifiziert (kein CE/FDA)
- Disclaimer erforderlich auf allen nutzergerichteten Oberflächen
