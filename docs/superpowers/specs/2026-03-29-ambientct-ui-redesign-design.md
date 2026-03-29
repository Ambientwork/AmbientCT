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

Both screens share the same shell (menubar + sidebar). Navigation: "Öffnen →" in the file manager loads a study into the Viewer; "Schließen" in the Viewer returns to the File Manager (does NOT delete from Orthanc).

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
| Offline dot | `#ef4444` |
| CT badge | `#60a5fa` |
| DX badge | `#4ade80` |
| Border | `1px solid #1e1e25` |
| Radius | `6–10px` |
| Font | `Inter, -apple-system, sans-serif` |

All color constants are exported from `src/utils/designTokens.ts`. All new components use **inline styles only** — no CSS files, no Tailwind.

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
- Left: `🦷 Ambient CT` logo + `Datei ▾` dropdown (Importieren, Exportieren†, —, Schließen) + `Ansicht` + `Werkzeuge`
- Right: `● Orthanc N Studien` status badge (green dot = reachable, red dot = unreachable)
- †Exportieren: out of scope for this iteration (rendered disabled)

### Sidebar
- Search field (`🔍 Suchen…`)
- **File Manager mode** — section label **PATIENTEN**: expandable patient → study → series rows
- **Viewer mode** — section label **GEÖFFNET**: active study highlighted; section **ALLE STUDIEN** below with other patients
- Bottom: `+ DICOM Importieren` button (always visible)

### Status Bar
- File Manager: `N Patienten · N Studien · Letzter Import: …` (left) + `AmbientCT v0.x · MIT` (right)
- Viewer: `Patient · Modality · Datum · N Schichten · Voxelgröße` (left) + `75.3 / 142 mm` arc position (right); arc position shows `— / — mm` when no arch drawn yet

### ⚙ Orthanc button
Opens `http://localhost:8042` in a new browser tab (direct link to Orthanc admin UI). No modal.

---

## 4. OHIF Integration — How `DentalFileManager` is surfaced

The existing integration point is `DentalViewRouter` (`src/viewports/DentalViewRouter.tsx`). This is the single registered OHIF viewport component for all panes. It already dispatches on `viewportId`.

**Changes to `DentalViewRouter`:**

1. Add local `appState: 'filemanager' | 'viewer'` state (React `useState`).
2. Add a `studyInstanceUID: string | null` state.
3. When `viewportId === 'dentalContainer'` **and** `appState === 'filemanager'`: render `DentalFileManager` instead of `DentalContainerViewport`.
4. `DentalFileManager` receives an `onOpen(studyInstanceUID: string)` callback → sets `appState = 'viewer'` and `studyInstanceUID`.
5. `DentalContainerViewport` receives an `onClose()` callback → sets `appState = 'filemanager'`.

**Viewer toolbar location:** The breadcrumb + tool buttons + Schließen toolbar is rendered **inside `DentalContainerViewport`** as its topmost child (a `<div>` above the existing flex column of CPR + cross-sections). This is the right location because `DentalContainerViewport` already owns the 67% right pane and its internal layout. `DentalViewRouter` does not need to render anything above the OHIF viewport grid.

**File Manager when no study is loaded:** When `showStudyList: false` and `appState === 'filemanager'`, OHIF renders the default two-pane grid. The axial pane (`cbctAxial`) shows the dark placeholder (existing `dentalEmpty` path in `DentalViewRouter`, line 48–50). The `dentalContainer` pane renders `DentalFileManager`, which fills the 67% right area. This is intentional — the user sees a dark left pane and the file manager on the right, which is acceptable for the initial release.

**OHIF config changes:**

- Set `showStudyList: false` in `ohif-config.js` — suppresses OHIF's built-in study list.
- No hanging-protocol changes needed; the router handles the screen switch internally.

**State location:** `DentalViewRouter` owns `appState`. This avoids a global context and keeps the state co-located with the dispatch logic.

---

## 5. Screen A — File Manager

Shown initially (when `appState === 'filemanager'`).

### Main Area
- **Title:** `Studien` · subtitle `Orthanc PACS · localhost:8042`
- **Tab bar:** Alle Studien | Zuletzt geöffnet | Importiert
  - "Alle Studien" — fetched from Orthanc via `OrthancClient`
  - "Zuletzt geöffnet" — persisted in `localStorage` (key: `ambientct.recentStudies`, max 20 entries, format: `StudySummary[]`)
  - "Importiert" — same localStorage with `importedAt` timestamp filter (last 7 days)
- **Search bar** (full width, filters table client-side) + `↑ Importieren` button + `⚙ Orthanc` button
- **Study table** columns: Patient · Datum · Modalität (badge) · Serien · Beschreibung · [Öffnen →]
  - `Öffnen →` calls `onOpen(studyInstanceUID)` and stores entry in `recentStudies`

### Empty States
- **Loading:** Spinner centered in table area
- **Zero studies:** "Keine Studien vorhanden. DICOM-Dateien importieren, um zu beginnen." + `↑ Importieren` button
- **Orthanc unreachable:** "Orthanc nicht erreichbar (localhost:8042). Bitte stellen Sie sicher, dass Orthanc läuft." + Retry button

### DICOM Import
- `↑ Importieren` opens file picker (`.dcm`, `.zip`, multi-select)
- Drag-and-drop onto main area also triggers import
- Files POST to `/pacs/dicom-web` (Orthanc DICOMweb STOW-RS: `POST /pacs/dicom-web/studies`)
- Progress indicator: inline spinner in the import button + toast notification on completion
- On error: toast "Import fehlgeschlagen: [error message]" with retry option

---

## 6. Screen B — Viewer

Shown when `appState === 'viewer'`.

### Toolbar (top of main area, replaces OHIF top chrome)
- Breadcrumb: `Studien / [PatientName] · [Modality]` — clicking "Studien" = Schließen
- Tool buttons: `⌒ Bogen` | `📐 Messen` | `Slab ⟵●⟶ 10mm`
- Right: `✕ Schließen` → calls `onClose()`, returns to File Manager

### Viewport grid (existing layout, preserved as-is)
- Left 33%: Axial CBCT (`cbctAxial`) — Cornerstone3D standard viewport
- Right 67%: `dentalContainer` — `DentalContainerViewport`
  - Top 60%: Panorama CPR
  - Bottom 40%: 3× cross-section (Prev / Center / Next)
- The 33/67 split is enforced by the existing `dental-grid-col-override` `<style>` injection in `DentalContainerViewport` (lines 143–146) — **no change needed**.
- Labels: `AXIAL · CBCT` | `PANORAMA CPR` | `↙ PREV −8` | `↕ CENTER` | `↗ NEXT +8`

### Existing functionality preserved (no changes)
- DentalArchSplineTool (click to place, Enter/double-click to complete)
- Catmull-Rom smooth spline display
- Axial overlay rectangles (Prev/Center/Next, parallel, arc-length accurate)
- Arc-fraction navigation + `mm / total mm` position label

---

## 7. Component Architecture

### New components

| Component | File | Responsibility |
|-----------|------|----------------|
| `DentalFileManager` | `src/viewports/DentalFileManager.tsx` | Screen A — Orthanc study browser |
| `OrthancClient` | `src/utils/orthancClient.ts` | Typed Orthanc REST API wrapper |
| `StudyTable` | `src/components/StudyTable.tsx` | Study list with sorting + open button |
| `PatientTree` | `src/components/PatientTree.tsx` | Sidebar patient/study/series tree |
| `DicomImport` | `src/components/DicomImport.tsx` | File picker + drag-drop + progress |
| `designTokens` | `src/utils/designTokens.ts` | Color/spacing constants |

### Modified components

| Component | Change |
|-----------|--------|
| `DentalViewRouter.tsx` | Add `appState` + `studyInstanceUID` state; render `DentalFileManager` or `DentalContainerViewport` based on state |
| `DentalContainerViewport.tsx` | Accept and wire `onClose()` prop; apply updated toolbar/label styles |
| `DentalCPRViewport.tsx` | Apply updated button/label styles from `designTokens` |
| `DentalCrossSectionViewport.tsx` | Apply updated label styles |

### Untouched components

| Component | Reason |
|-----------|--------|
| `DentalMPRViewport.tsx` | Not part of dental CPR layout; no changes |
| `DentalArchSplineTool.ts` | Functionality preserved as-is |
| `dentalState.ts` | No changes |

### OHIF config changes

| File | Change |
|------|--------|
| `config/ohif-config.js` | Set `showStudyList: false` |

---

## 8. OrthancClient API

Base URL: `/pacs/dicom-web` (via Nginx proxy — works both in Docker and local dev via the same proxy).

```typescript
// GET /pacs/dicom-web/studies → StudySummary[]
interface StudySummary {
  studyInstanceUID: string; // DICOM StudyInstanceUID (e.g. 1.2.840.…)
  patientName: string;
  studyDate: string;        // YYYYMMDD
  modality: string;         // CT | DX | IO | …
  numSeries: number;
  description: string;
}

// Extended form stored in localStorage (recent / imported tabs):
interface StoredStudySummary extends StudySummary {
  lastOpenedAt?: string;    // ISO timestamp — for "Zuletzt geöffnet"
  importedAt?: string;      // ISO timestamp — for "Importiert" (last 7 days filter)
}

// POST /pacs/dicom-web/studies  (Content-Type: multipart/related; type=application/dicom)
// Returns: { ReferencedSOPSequence: [...] }

// Health check: GET /pacs/dicom-web/studies?limit=1
// Treat any HTTP response (even empty 200) as "online"; treat network error as "offline".
// This is more reliable than GET /pacs/ which may not be proxied.
```

DICOMweb STOW-RS is used for import (standard, works with Orthanc's DICOMweb plugin).
`onOpen(studyInstanceUID)` receives the DICOM `StudyInstanceUID` (not the Orthanc-internal hash).

---

## 9. Navigation Flow

```
App start
  └→ DentalViewRouter (appState = 'filemanager')
       └→ renders DentalFileManager
            ├→ [Öffnen →] clicked
            │    └→ appState = 'viewer', studyInstanceUID = <uid>
            │         └→ renders DentalContainerViewport
            │              └→ [Schließen] / breadcrumb "Studien"
            │                   └→ appState = 'filemanager'
            └→ [+ DICOM Importieren] / drag-drop
                 └→ POST /pacs/dicom-web/studies → refresh study list
```

---

## 10. Error Handling Summary

| Scenario | Display |
|----------|---------|
| Orthanc unreachable on load | Red status dot + inline error message + Retry button in study table area |
| Orthanc unreachable during browse | Status dot turns red; last-loaded list remains visible with stale indicator |
| Empty study list | "Keine Studien" empty state with import CTA |
| Import file error | Toast: "Import fehlgeschlagen: [message]" with retry |
| Import network error | Toast: "Netzwerkfehler beim Import" with retry |
| Volume load fails in viewer | `DentalCPRViewport` existing error state handles it (red overlay + message); `appState` stays `'viewer'`; user can click Schließen to return |

---

## 11. Out of Scope

- Authentication / user login
- Multi-user / role management
- DICOM Send (DIMSE C-STORE) and Export
- Reporting / annotation export
- Series-level viewer (non-dental modalities)
- Delete study from Orthanc (UI action "Schließen" only returns to file manager)

---

## 12. Success Criteria

1. File manager loads and lists studies from Orthanc via `/pacs/dicom-web/studies`
2. Clicking `Öffnen →` transitions to the dental CPR viewer with the correct study loaded
3. Clicking `Schließen` (or breadcrumb "Studien") returns to the file manager; study remains in Orthanc
4. DICOM import (file picker + drag-drop) posts to `/pacs/dicom-web/studies` and refreshes the list
5. Sidebar patient tree expands/collapses correctly; active study is highlighted in viewer mode
6. All existing CPR/cross-section/arch-spline functionality continues to work unchanged
7. The following OHIF default chrome elements are absent: OHIF top study-list bar, OHIF bottom measurement toolbar, OHIF left panel, OHIF mode selector
8. Orthanc unreachable state shows red status dot + error message (not a blank screen or crash)
9. "Zuletzt geöffnet" tab shows studies from `localStorage` correctly after re-open
