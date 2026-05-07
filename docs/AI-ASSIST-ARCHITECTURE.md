# AI Assist — Architektur & Entwicklungsplan

## TL;DR

AmbientCT AI Assist ist ein lokaler, optionaler Analyse-Layer für CBCT/DICOM-Daten, der dem Kliniker vorbereitete Befund-Vorschläge liefert.
Alle Inferenz läuft on-prem im selben Docker-Netzwerk wie Orthanc und der Viewer.
Es verlässt keine Patientendaten den Rechner, es gibt keine Cloud-Anbindung, kein Telemetrie-Feed.
**Das System ist kein autonomer Diagnose-Apparat** — jeder Befund-Vorschlag durchläuft einen verpflichtenden Human-Review-Schritt.
Nicht CE/FDA-zertifiziert. Kein Ersatz für klinische Entscheidungen durch lizenzierte Fachkräfte.

---

## Local-only Designprinzipien

| Prinzip | Begründung |
|---------|------------|
| **Kein PHI verlässt den Rechner** | DSGVO-Konformität ohne aufwendige DPA/Cloud-Verträge. Praxen können die Software deployen ohne Datenschutzfolgenabschätzung für Drittübermittlung. |
| **Inference-Service nur im internen Docker-Netzwerk** | Der `ai-inference`-Container bekommt keinen nach außen exponierten Host-Port. Kommunikation ausschließlich über das interne `pacs-net`. Kein direkter Browser-Zugriff auf den Inference-Service — Requests laufen durch den Viewer-Proxy. |
| **Keine externe Telemetrie** | Kein Modell-Performance-Reporting an einen zentralen Server. Konsistent mit dem Grundprinzip aus `ARCHITECTURE.md` ("kein externer Analytics/Tracking"). |
| **Modelle werden explizit vom Nutzer geladen** | Kein Auto-Download bei erstem Start. Der Admin legt Modell-Dateien in ein gemountetes Volume (`./data/ai-models/`). Das System gibt einen klaren Fehler aus, wenn kein Modell vorhanden ist, statt still einen Download zu initiieren. |
| **Audit-Logs PHI-frei** | Alle persistierten Logs durchlaufen die bestehende Scrub-Pipeline (`scripts/scrub.py`). Logs enthalten `studyInstanceUID` als opaken Identifier, aber keine Patientennamen, Geburtsdaten oder sonstigen DICOM-Tags mit direktem Personenbezug. |

---

## AI-Pipeline-Stages

```
 DICOM Volume (aus Orthanc via DICOMweb)
        │
        ▼
┌───────────────────┐
│  Input Quality    │  HU-Range, Voxel-Spacing, Scanner-Drift-Check,
│  Check            │  DICOM-Tag-Whitelist → Pass / Warn / Reject
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Normalisierung   │  HU-Clip, Spacing-Resampling, Orientation
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Anatomy          │  Mandibula, Maxilla, Tooth, Mandibular Canal,
│  Segmentation     │  Maxillary Sinus  →  DICOM SEG
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Measurement      │  Distanzen, Volumina aus Segmentation-Masks
│  Extraction       │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Finding          │  periodontal_bone_loss, periapical_radiolucency,
│  Suggestion       │  caries_suspected, sinus_opacity,
│                   │  tmj_degeneration_suspected
│                   │  + Confidence-Score + Uncertainty-Level
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Human Review     │  Kliniker akzeptiert / lehnt ab / editiert
│  Loop             │  → state: accepted | rejected | edited
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Structured       │  DICOM SR Draft — nur accepted/edited Findings
│  Report Draft     │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Audit Log        │  PHI-scrubbed via scripts/scrub.py
└───────────────────┘
```

| Stage | Input | Output | Implementierung |
|-------|-------|--------|-----------------|
| Input Quality Check | DICOM Volume | Pass/Warn/Reject + Reason | Python, Adapter-Layer |
| Normalisierung | Raw Volume | Normiertes NumPy Array | Python (SimpleITK) |
| Anatomy Segmentation | Normiertes Volume | DICOM SEG (Labelmap) | MONAI Label / nnU-Net / DentalSegmentator |
| Measurement Extraction | DICOM SEG | JSON mit Messwerten | Python, SimpleITK |
| Finding Suggestion | Messwerte + Segmentation | `Finding[]` mit Confidence | Modell-spezifisch |
| Human Review Loop | `Finding[]` | `ReviewedFinding[]` | OHIF AI Panel (React) |
| Structured Report Draft | `ReviewedFinding[]` | DICOM SR | dcmsr / pydicom |
| Audit Log | Job-Metadaten | PHI-scrubbed JSON | `scripts/scrub.py` |

---

## Boundary: OSS-Research vs. Regulated Clinical

| Bereich | Bleibt im OSS-Repo (AmbientCT MIT) | Ausgegliedert als Regulated Module (zukünftig) |
|---------|--------------------------------------|------------------------------------------------|
| AI-Panel-UI | Vollständig — Frontend-Komponenten, Store, Adapter-Interface, Mock | Nein |
| Inference-Adapter API | Vollständig — Interface-Definition, Mock-Implementierung | Nein |
| Qualitätschecks (Spacing, HU-Range) | Vollständig | Nein |
| Anatomy Segmentation (Research-Modelle) | Modell-Integrationsglue + Beispiel-Pipeline | Validiertes Modell mit klinischer Performance-Studie (CE-Technische Dokumentation) |
| Finding Suggestion | Logik + Demo-Fixtures + Wording-Regeln | Klinisch validierter Classifier mit 510(k)/CE-IVD-Dossier |
| Structured Report Draft | Template-Code, DICOM SR Struktur | Klinisch geprüftes Report-Format (regulatory sign-off) |
| Human Review Loop | Vollständig — alle Review-UI-Komponenten | Nein (Review-Pflicht ist Safeguard, kein Regulated Device) |
| Audit Trail | `scripts/scrub.py` + Log-Schema | Erweiterte Audit-Chain für reguliertes Umfeld |
| Regulierte Klinische Ausgabe | Nicht im OSS-Repo | Separates, zertifiziertes Modul; Referenz: FDA 510(k) K251514 (Overjet CBCT Assist), K212519, K231678, K241684, K241681 |

**Anmerkung zu K251514:** Overjet's FDA-Clearance für CBCT-basierte Knochenanalyse (2025) belegt, dass dieser Anwendungsfall grundsätzlich regulierbar ist. AmbientCT bleibt bewusst auf der Research-Preview-Seite dieser Grenze. Die Architektur ist so designed, dass ein reguliertes Modul den `ai-inference`-Endpunkt implementieren kann, ohne Frontend-Änderungen zu erfordern.

---

## Roadmap

### Phase 0–3 Monate — Foundation (aktuell)

Ziel: stabile Architektur, kein echtes Modell nötig, Demo-fähig.

- **Data Model** — TypeScript-Interfaces für `Finding`, `ReviewedFinding`, `AIJob`, `AuditEntry` in `extensions/dental-cpr/src/ai/types.ts`
- **Mock-Adapter** — Browser-seitiger Mock (`MockAIAdapter`) spiegelt die Inference-Adapter-API vollständig via `localStorage`; kein Backend nötig
- **AI-Panel-UI** — React-Panel in OHIF-Extension: Job-Trigger, Fortschrittsanzeige, Finding-Liste mit Review-Controls (Accept/Reject/Edit)
- **Demo-Fixtures** — realistische Fixture-Findings für Mandibular-Canal + periapical_radiolucency, geladen wenn `AI_ASSIST_DEMO_MODE=true`
- **Feature Flags** — `AI_ASSIST_ENABLED`, `AI_ASSIST_DEMO_MODE` in `.env.example`
- **Tests** — Unit-Tests für Adapter, Store, Scrub-Pipeline-Integration
- **Docs** — dieses Dokument

### Phase 3–6 Monate — Erstes echtes Modell

Ziel: lokale Anatomy-Segmentation, Mandibular-Canal als High-Value-Einstiegspunkt.

- **Lokaler FastAPI-Inference-Container** (`ai-inference/`) nach `mar-processor/main.py`-Vorlage: async Job-Queue, Progress-Callbacks, Pydantic-Schemas, Health-Endpoint
- **Modell-Kandidaten:**
  - **DentalSegmentator** (3D Slicer Extension, nnU-Net-basiert) — gut dokumentiertes Anatomy-Segmentation-Modell für Zahn-CBCT; Mandibula, Maxilla, Zähne, Mandibular Canal. Bevorzugter Einstiegspunkt wegen Dental-Spezifität.
  - **MONAI Label** — flexibler Active-Learning-Workflow, breite Modellbibliothek; sinnvoll wenn eigene Trainingsdata vorhanden
  - Beide Optionen schließen sich nicht aus — Adapter-Interface bleibt gleich
- **Mandibular-Canal-Detection** — höchster klinischer Wert für Implantatplanung (bereits in `DENTAL-FEATURES-ROADMAP.md` als Phase 4b priorisiert); gut durch DentalSegmentator abgedeckt
- **DICOM SEG Output** — Segmentation-Ergebnis als DICOM SEG in Orthanc speichern; Cornerstone3D rendert Overlays nativ
- **Scanner-Whitelist** — erste OOD-Heuristik: bekannte Hersteller/Modelle aus DICOM-Tags; unbekannte Scanner → `input_quality: warn`

### Phase 6–12 Monate — Clinical Workflow Integration

Ziel: vollständiger Review-Workflow, persistente Audit-Logs, erste klinisch nützliche Finding-Typen.

- **Implant Safety Assist** — Distanz-Marker vom geplanten Implantat zum segmentierten Mandibular Canal; baut auf CPR-Viewport aus `dental-cpr`-Extension auf
- **Periodontal Bone Loss Heatmap** — Visualisierung der Knochenabbau-Regionen als Heatmap-Overlay auf MPR
- **Strukturierter Befund-Draft** — DICOM SR (TID 1500-kompatibel) aus accepted/edited Findings; Python-seitig mit `pydicom`/`highdicom`
- **Reviewer-Workflow** — Audit-Log-Persistenz in Orthanc-Metadata (Attachment API); Review-State, Timestamps, anonymisierte Reviewer-ID
- **Performance-Tracking pro Scanner-Hersteller** — DICOM-Header-basiert; separates CSV-Log (PHI-scrubbed) für spätere Modell-Evaluation

---

## Komponenten-Layout

```
AmbientCT/
├── extensions/
│   └── dental-cpr/
│       └── src/
│           └── ai/
│               ├── types.ts          # AiJob, AiFinding, AiSegmentationMask, ReviewerState …
│               ├── findingsStore.ts  # Singleton-Store + Subscribe-Pattern + localStorage-Persistenz
│               ├── inferenceClient.ts# Adapter-Klasse (Mock heute, HTTP später)
│               └── fixtures.ts       # Demo-Findings/-Segmentations (isDemo: true)
│           └── components/
│               └── AiAssistPanel.tsx # Right-Panel-UI mit Confidence/Uncertainty/Review
│
├── ai-inference/                     # Zukünftiger Top-Level-Ordner (Phase 3–6)
│   ├── main.py                       # FastAPI — nach mar-processor-Pattern
│   ├── pipeline/
│   │   ├── quality_check.py
│   │   ├── normalize.py
│   │   ├── segmentation.py           # DentalSegmentator / MONAI Label Wrapper
│   │   ├── measurements.py
│   │   └── findings.py
│   ├── models/                       # Leer im Repo — Modelle via Volume-Mount
│   │   └── .gitkeep
│   ├── Dockerfile
│   └── requirements.txt
│
├── docker-compose.yml
│   # Späterer ai-inference-Service:
│   #   ai-inference:
│   #     build: ./ai-inference
│   #     networks: [pacs-net]        # kein ports: mapping → kein Host-Port
│   #     volumes:
│   #       - ./data/ai-models:/models:ro
│   #     environment:
│   #       - ORTHANC_URL=http://orthanc:8042
│
└── scripts/
    └── scrub.py                      # PHI-Scrub — bereits vorhanden, AI Logs durchlaufen sie
```

**Persistenz:**
- Segmentation-Ergebnisse → DICOM SEG in Orthanc (native DICOMweb-Speicherung)
- Structured Report Draft → DICOM SR in Orthanc
- Audit-Logs → Orthanc Attachment API (PHI-scrubbed JSON) oder lokale Log-Datei (scrubbed)
- Review-States → DICOM SR oder Orthanc-Metadata (Attachment), nicht im Browser-State

---

## Inference-Adapter-API

Der Mock-Adapter im Browser und der spätere echte FastAPI-Service implementieren dieselbe HTTP-Schnittstelle. Die Migration von Mock zu Real ist ein Konfigurationswechsel (`VITE_AI_ADAPTER=mock | http`), kein Code-Rewrite.

```
POST /api/ai/jobs
  Body:  { "studyInstanceUID": "1.2.840..." }
  Resp:  { "jobId": "uuid", "status": "queued" }

GET  /api/ai/jobs/:jobId
  Resp:  {
           "jobId": "uuid",
           "status": "queued | running | review_required | completed | failed",
           "progress": 0.0–1.0,
           "error": "string | null"
         }

GET  /api/ai/findings/:studyInstanceUID
  Resp:  {
           "findings": [
             {
               "findingId": "uuid",
               "jobId": "uuid",
               "studyInstanceUID": "1.2.840…",
               "findingClass": "periapical_radiolucency | periodontal_bone_loss | caries_suspected | sinus_opacity | tmj_degeneration_suspected",
               "anatomyClass": "mandible | maxilla | tooth | mandibular_canal | maxillary_sinus | null",
               "confidence": 0.0,
               "uncertainty": "low | medium | high",
               "reviewerState": "unreviewed | accepted | rejected | edited",
               "measurement": {
                 "distance_mm":      0,
                 "area_mm2":         0,
                 "volume_mm3":       0,
                 "tooth_number":     36,
                 "canal_distance_mm": 0
               },
               "source": {
                 "modelId":          "string",
                 "modelVersion":     "semver",
                 "createdAt":        "ISO-8601",
                 "studyInstanceUID": "1.2.840…",
                 "seriesInstanceUID": "1.2.840…?"
               },
               "isDemo": false,
               "description": "string?"
             }
           ]
         }

POST /api/ai/findings/:findingId/review
  Body:  { "state": "accepted | rejected | edited" }
  Resp:  { "findingId": "uuid", "reviewerState": "accepted | rejected | edited" }
```

> **Schema-Hinweis:** Die Felder oben spiegeln 1:1 `extensions/dental-cpr/src/ai/types.ts` (`AiFinding`). Tooth-Bezug läuft über `measurement.tooth_number` (`number`), nicht über ein verschachteltes `region`-Objekt — das ist die Phase-0-Source-of-Truth. Echte Voxel-Koordinaten und Bounding-Boxen kommen mit DICOM SEG/SR in Phase 3 und sind in den "Known Limitations" am Ende dieses Dokuments markiert.

**Status-Werte:**

| Status | Bedeutung |
|--------|-----------|
| `queued` | Job angenommen, noch nicht gestartet |
| `running` | Inference läuft, `progress` 0.0–1.0 |
| `review_required` | Inference abgeschlossen, Findings warten auf Review |
| `completed` | Review abgeschlossen, Report-Draft erstellt |
| `failed` | Fehler in der Pipeline; `error`-Feld gesetzt |

**Mock-Implementierung:** `MockAIAdapter.ts` speichert Jobs und Findings in `localStorage` mit derselben JSON-Shape. Beim Wechsel zu einem echten Service ändert sich nur die Adapter-Implementierung — der OHIF-Store, das Panel und alle Tests bleiben unberührt.

---

## Risk Controls

| Control | Beschreibung | Status |
|---------|-------------|--------|
| **Uncertainty Display** | Jedes Finding zeigt `confidence` (0–1) und `uncertaintyLevel` (low / medium / high) sichtbar im Panel. Kliniker sieht immer das Konfidenz-Niveau. | Phase 0–3 (Data Model) |
| **Out-of-Distribution Detection** | Stub in Phase 0–3: Voxel-Spacing-Range-Check (z.B. < 0.1 mm oder > 1.0 mm → Warn), Scanner-Tag-Whitelist (bekannte Hersteller/Protokolle). Echte OOD-Detektion (Mahalanobis-Distanz o.ä.) in Phase 6–12. | Stub Phase 0–3, Real Phase 6–12 |
| **Scanner/Protocol Drift Notes** | DICOM-Header-Felder (`Manufacturer`, `ManufacturerModelName`, `KVP`, `ExposureTime`) werden job-seitig geloggt (PHI-scrubbed). Modell-Performance wird pro Hersteller-Gruppe separat getrackt. | Phase 3–6 |
| **PHI-safe Logs** | Alle persistierten Logs durchlaufen `scripts/scrub.py`. Kein Patientenname, kein Geburtsdatum, kein `PatientID`-Klartext in Log-Files. `StudyInstanceUID` bleibt als opaker Identifier. | Phase 0–3 (bestehende Pipeline) |
| **Feature Flags** | `AI_ASSIST_ENABLED` (default: false) und `AI_ASSIST_DEMO_MODE` (default: false) in `.env.example`. Demo-Mode lädt Fixture-Findings, kein echtes Modell nötig. | Phase 0–3 |
| **Research Preview Badge** | Sichtbares Badge "Research Preview · Demo Data" im AI Panel, solange `AI_ASSIST_DEMO_MODE=true` oder kein validiertes Modell geladen ist. Nicht ausblendbar per CSS — hartcodiert im Panel-Header. | Phase 0–3 |
| **Reviewer-State vor Report** | Ein Finding wandert nur dann in den Report Draft, wenn `reviewerState === "accepted" || "edited"`. `pending` und `rejected` Findings werden nicht exportiert. Diese Prüfung findet server-seitig statt, nicht nur im Frontend. | Phase 3–6 |

---

## Wording-Regeln

Was wir schreiben:

- "AI Assist" — als Feature-Name
- "suggested finding" — für Modell-Output
- "requires clinician confirmation" — in jedem Panel-Header und Report-Draft-Preamble
- "research preview" — auf allen AI-bezogenen UI-Elementen solange nicht reguliert
- "confidence: 0.82" / "uncertainty: medium" — statt vager Qualitätsaussagen
- "possible periapical radiolucency at tooth 36" — mit Modalpartikel

Was wir vermeiden:

- "diagnose" / "diagnosis" — das System stellt keine Diagnosen
- "detect all pathology" — keine Vollständigkeitsgarantie
- "clinical-grade" — nicht ohne Validierungsstudie
- "FDA approved" / "CE certified" — solange nicht zutreffend
- "automatically identifies" — suggeriert Fehlerfreiheit
- "AI finds" — bevorzuge "AI suggests"

---

## Verweise

**Regulatorische Referenzpunkte:**
- FDA 510(k) K251514 — Overjet CBCT Assist (2025), CBCT-basierte Knochenanalyse
- FDA 510(k) K212519, K231678, K241684, K241681 — weitere dental AI Clearances als Benchmarks

**Modell- und Framework-Referenzen:**
- [DentalSegmentator](https://github.com/gaudot/SlicerDentalSegmentator) — 3D Slicer Extension, nnU-Net-basierte Dental-CBCT-Segmentation (Mandibula, Maxilla, Zähne, Mandibular Canal)
- [MONAI Label](https://github.com/Project-MONAI/MONAILabel) — Active-Learning-Framework für medizinische Bildsegmentation
- [nnU-Net](https://github.com/MIC-DKFZ/nnUNet) — Self-configuring segmentation framework, Basis für DentalSegmentator und viele dental AI Modelle

**Upstream-Stack:**
- [OHIF Viewer v3](https://github.com/OHIF/Viewers) — Basis des AmbientCT-Viewers (Fork v3.9.2)
- [Cornerstone3D](https://github.com/cornerstonejs/cornerstone3D) — 3D-Rendering-Engine, Annotation-Tools, Segmentation-Overlays
- [vtk.js](https://github.com/Kitware/vtk-js) — Rendering-Primitives inkl. `vtkImageCPRMapper` (CPR-Viewport)
- [Orthanc](https://www.orthanc-server.com/) — PACS-Server, DICOMweb, DIMSE, Attachment-API für Persistenz

---

> **Disclaimer:** AmbientCT AI Assist ist nicht CE/FDA-zertifiziert. Es handelt sich um ein Research-Preview-Feature ohne autonome Diagnostik-Funktion. Klinische Entscheidungen erfordern einen lizenzierten Kliniker und zertifizierte Software.

---

## Known Limitations & Follow-up Tasks (Phase 0)

Diese Punkte sind in Phase 0 bewusst nicht implementiert. Sie sind als eigene Issues / Follow-ups aufzunehmen, bevor die nächste Phase startet.

### Tooling & CI

- **Add TypeScript typecheck pipeline for `dental-cpr` extension** — Babel-Jest stripped Typen ohne Prüfung; ein dediziertes `tsconfig.json` + `tsc --noEmit`-Script wird gebraucht, sonst sind TS-Fehler unsichtbar bis zum OHIF-Build. (Reviewer-Finding C1.)
- Pre-Commit-Hook für PHI-Scrub vor Logs commit (existiert in `scripts/scrub.py`, aber kein Hook-Wiring).
- `tsc`-Strict-Check als CI-Gate, getrennt von Jest.

### Data Model & Persistence

- **Voxel-Koordinaten / Bounding-Boxen auf `AiFinding`** — fehlen, weil Phase 0 keine Annotation-Render-Pipeline hat. Nötig sobald Findings in den Viewport overlaid werden (Phase 3+).
- **`inferenceHash` / Modell-Hash auf `AiSourceMetadata`** — für Reproduzierbarkeit und Audit.
- **Reproduktion-Seed** für deterministische Inference (Debugging realer Modelle).
- **`seriesInstanceUID`-Direktzugriff auf `AiFinding`** statt nur via `source.seriesInstanceUID` — Schema-Konsistenz mit `studyInstanceUID`.
- **Zod-Runtime-Validierung** an der `localStorage`-Grenze (Top-Level-Hydration heute defensiv, Werte werden aber nicht tief geprüft).
- **Persistenz nach Orthanc-Metadata / DICOM SEG/SR** — heute ausschließlich in-memory + `localStorage`. Geplant für Phase 3+ (siehe Roadmap-Sektion "Komponenten-Layout").

### UI & UX

- **`edited`-Reviewer-State ohne UI-Pfad** — Type-System unterstützt es, Mock-Adapter setzt es, aber das Panel hat keinen Edit-Button und kein Notes-Textarea. Folgeaufgabe: Inline-Edit-Form für Findings.
- **`note?`-Parameter im Review-Endpoint** — im Arch-Doc als optional dokumentiert, aktuell nicht im Mock-Adapter implementiert.
- **`data-testid`-Attribute auf Panel und Finding-Cards** — E2E-Selektoren nutzen Text-Matches, fragiler als testid-basierte Locators.
- **Job-Cancel** — `setTimeout`-Handle wird nicht gespeichert, ein laufender Mock-Job kann nicht abgebrochen werden. Wird relevant sobald Jobs Sekunden bis Minuten brauchen.
- **Out-of-Distribution-Detection** — heute Stub, real geplant für Phase 3+ (Voxel-Spacing-Range-Check, Scanner-Tag-Whitelist).

### Tests

- **Verhaltens-Asserts statt Aufzählungs-Tests in `aiTypes.test.ts`** — die aktuellen Tests prüfen Array-Längen gegen ein hartcodiertes Test-Array, nicht die TS-Type-Vollständigkeit. Mit echtem `tsc`-Check (s. Tooling) wird das obsolet.
- **E2E: Selektoren auf Panel-Scope einschränken** — der PHI-Check liest aktuell `body.innerText` der ganzen Seite; ein OHIF-Banner mit "FDA" würde fälschlich rot. Scope auf das AI-Panel via `data-testid`.

### Architecture / Open Decisions

- **Performance-Indizes im Store** — `updateReview` ist O(studies × findings). Tolerable für Phase 0, wird relevant bei vielen Studies und vielen Findings → `findingId → studyInstanceUID`-Lookup-Map einführen.
- **Audit-Log-Persistenz** — heute nur als Logging-Pfad konzeptionell beschrieben; tatsächliche Persistenz nach Orthanc Attachment API ist Phase-3-Arbeit.
- **HTTP-Backend-Adapter** — heute `throw new Error('HTTP backend not implemented yet')`. Implementierung folgt der `mar-processor`-FastAPI-Vorlage in Phase 3 (siehe Roadmap-Sektion).
