# AmbientCT UI Redesign — Design Spec

**Date:** 2026-03-29
**Status:** Approved
**Style:** Figma/Notion (Design C) — dark, file-tree sidebar, violet accents, menubar
**Scope:** Full — extension redesign + OHIF config + custom Orthanc file manager

---

## 1. Overview

Replace the current OHIF default UI with a clean, modern two-screen application:

1. **File Manager** — start screen, shown when no study is open
2. **Viewer** — dental CPR workspace, opened from the file manager

Both screens share the same shell (menubar + sidebar). Navigation: "Öffnen →" in the file manager loads a study into the viewer; "Schließen" in the viewer returns to the file manager.

---

## 2. Design Language

| Token | Value |
|-------|-------|
| Primary (violet) | `#a78bfa` |
| Accent (lighter violet) | `#c4b5fd` |
| Menubar bg | `#111115` |
| Sidebar bg | `#0d0d11` |
| Viewer bg | `#070709` |
| Online dot | `#22c55e` |
| CT badge | `#60a5fa` |
| DX badge | `#4ade80` |
| Border | `1px solid #1e1e25` |
| Radius | `6–10px` |
| Font | `Inter, -apple-system, sans-serif` |

---

## 3. Shell Layout

```
┌─────────────────────────────────────────────────────────┐
│ MENUBAR: [🦷 Ambient CT]  [Datei ▾] [Ansicht] [Werkzeuge] │ ← right: status dot
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│   SIDEBAR    │   MAIN AREA (File Manager or Viewer)    │
│   210px      │                                          │
│              │                                          │
└──────────────┴──────────────────────────────────────────┘
│ STATUS BAR                                               │
└─────────────────────────────────────────────────────────┘
```

### Menubar
- Left: `🦷 Ambient CT` logo + `Datei ▾` dropdown (Importieren, Exportieren, Schließen) + `Ansicht` + `Werkzeuge`
- Right: `● Orthanc 26.1 · N Studien` status badge

### Sidebar (file tree)
- Search field (`🔍 Suchen…`)
- Section **PATIENTEN**: expandable patient rows → study rows → series rows
- Bottom: `+ DICOM Importieren` button
- In viewer mode: active study highlighted; section label changes to **GEÖFFNET** + **ALLE STUDIEN**

### Status Bar
- File Manager: `N Patienten · N Studien · Letzter Import: …` (left) + `AmbientCT v0.x · MIT` (right)
- Viewer: `Patient · Modality · Datum · N Schichten · Voxelgröße` (left) + `75.3 / 142 mm` arc position (right)

---

## 4. Screen A — File Manager

Shown on load, when no study is active.

### Main Area
- **Breadcrumb-Title:** `Studien` + subtitle `Orthanc PACS · localhost:8042`
- **Tab bar:** Alle Studien | Zuletzt geöffnet | Importiert
- **Search bar** (full width) + `↑ Importieren` button + `⚙ Orthanc` button
- **Study table** columns: Patient · Datum · Modalität (badge) · Serien · Beschreibung · [Öffnen →]
- Clicking `Öffnen →` navigates to Viewer screen

### Data Source
- Orthanc REST API: `GET /dicom-web/studies` (DICOMweb) or `GET /studies` (native)
- Map response: PatientName, StudyDate, Modality, NumberOfStudyRelatedSeries, StudyDescription
- Polling interval: 30s or on focus

### DICOM Import
- `↑ Importieren` opens file picker (`.dcm`, `.zip`) → POST to `/instances`
- Drag-and-drop onto main area also triggers import
- Progress indicator inline in table row

---

## 5. Screen B — Viewer

Opened after clicking `Öffnen →`. Layout identical to current dental CPR viewer, with redesigned chrome.

### Toolbar (inline, top of main area)
- Breadcrumb: `Studien / Yoo 2023 · CBCT` (clicking "Studien" = Schließen)
- Tool buttons: `⌒ Bogen` | `📐 Messen` | `Slab ⟵●⟶ 10mm`
- Right: `✕ Schließen` → back to File Manager (does NOT delete from Orthanc)

### Viewport grid
- Left 33%: Axial CBCT + arch spline overlay (existing)
- Right 67%: top 60% = Panorama CPR, bottom 40% = 3× cross-section (Prev / Center / Next)
- Labels: `AXIAL · CBCT` | `PANORAMA CPR` | `↙ PREV −8` | `↕ CENTER` | `↗ NEXT +8`

### Existing functionality preserved
- DentalArchSplineTool (click to place, Enter/double-click to complete)
- Catmull-Rom smooth spline display
- Axial overlay rectangles (Prev/Center/Next, parallel, arc-length accurate)
- Arc-fraction navigation + mm position label

---

## 6. Component Architecture

### New components

| Component | File | Responsibility |
|-----------|------|----------------|
| `AppShell` | `src/components/AppShell.tsx` | Menubar + sidebar + status bar wrapper |
| `DentalFileManager` | `src/viewports/DentalFileManager.tsx` | Orthanc study browser (Screen A) |
| `OrthancClient` | `src/utils/orthancClient.ts` | Typed Orthanc REST API wrapper |
| `StudyTable` | `src/components/StudyTable.tsx` | Study list with sorting + open button |
| `PatientTree` | `src/components/PatientTree.tsx` | Sidebar patient/study/series tree |
| `DicomImport` | `src/components/DicomImport.tsx` | File picker + drag-drop + progress |

### Modified components

| Component | Change |
|-----------|--------|
| `DentalContainerViewport.tsx` | Adopt AppShell toolbar, add Schließen callback |
| `DentalCPRViewport.tsx` | Toolbar button styles, breadcrumb integration |
| `DentalCrossSectionViewport.tsx` | Label style update |

### OHIF config changes

| File | Change |
|------|--------|
| `config/ohif-config.js` | Register `DentalFileManager` as default viewport when no study active; set custom layout |
| `extensions/dental-cpr/src/index.tsx` | Export new components, register `AppShell` |

---

## 7. OrthancClient API

```typescript
// GET /studies → StudySummary[]
interface StudySummary {
  id: string;               // Orthanc study UID
  patientName: string;
  studyDate: string;        // YYYYMMDD
  modality: string;         // CT | DX | IO | …
  numSeries: number;
  description: string;
}

// POST /instances  (multipart/form-data, file=<dcm>)
// Returns: { ID, Status }
```

---

## 8. Navigation Flow

```
App start
  └→ DentalFileManager (Screen A)
       ├→ [Öffnen →] clicked
       │    └→ DentalContainerViewport (Screen B)
       │         └→ [Schließen] clicked
       │              └→ DentalFileManager (Screen A)
       └→ [+ DICOM Importieren] / drag-drop
            └→ POST /instances → refresh study list
```

State: `appState = 'filemanager' | 'viewer'` managed in a top-level React context or OHIF layout component. No router needed.

---

## 9. Styling Strategy

- All new components use **inline styles** (consistent with existing dental viewport components)
- Color constants exported from `src/utils/designTokens.ts`
- No new CSS framework; no Tailwind (not available in OHIF extension context)
- Existing OHIF grid override CSS (`dental-grid-col-override`) retained

---

## 10. Out of Scope

- Authentication / user login
- Multi-user / role management
- DICOM Send (DIMSE C-STORE)
- Reporting / annotation export
- Series-level viewer (non-dental modalities)

---

## 11. Success Criteria

1. File manager loads and lists studies from Orthanc on `localhost:8042`
2. Clicking `Öffnen →` transitions to the dental CPR viewer with the correct study
3. Clicking `Schließen` returns to the file manager without data loss
4. DICOM import (file picker + drag-drop) uploads to Orthanc and refreshes the list
5. Sidebar patient tree expands/collapses correctly
6. All existing CPR/cross-section/arch-spline functionality continues to work
7. No OHIF default chrome visible (no top-bar, no bottom toolbar from OHIF)
