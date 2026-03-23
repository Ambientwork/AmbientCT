# Dental Imaging Features — AmbientCT Roadmap

> Research date: 2026-03-23
> Basis: OHIF v3.9.2, Cornerstone3D latest, vtk.js, community issues

---

## Was OHIF + Cornerstone3D heute schon kann

AmbientCT bekommt diese Features **gratis** aus dem OHIF/Cornerstone3D-Stack — ohne Custom-Code.

### Viewer & Rendering
| Feature | Status | Wo |
|---------|--------|-----|
| Axial / Sagittal / Koronal MPR | ✅ Built-in | `VolumeViewport` |
| 3D Volume Rendering | ✅ Built-in | `VolumeViewport` + VTK |
| Window/Level mit Presets | ✅ Built-in | WindowLevelTool + ohif-config |
| Zoom, Pan, Stack Scroll | ✅ Built-in | ManipulationTools |
| Multi-Viewport-Layouts | ✅ Built-in | LayoutTemplate-Extension |
| Hanging Protocols | ✅ Built-in | HangingProtocol-Extension |
| Segmentation / Labelmap | ✅ Built-in | BrushTool, Scissors |
| RT STRUCT Overlay | ✅ Built-in | cornerstone-dicom-sr |
| 4D Imaging | ✅ Built-in | Stack + cine tool |

### Messungen (für Implantatplanung nutzbar)
| Feature | Status | Tool-Name |
|---------|--------|-----------|
| Längen-Messung | ✅ Built-in | `LengthTool` |
| Winkel-Messung | ✅ Built-in | `AngleTool` |
| Bidirektional (Breite × Höhe) | ✅ Built-in | `BidirectionalTool` |
| Elliptische ROI + Hounsfield-Werte | ✅ Built-in | `EllipticalROITool` |
| Probe (HU-Wert an Punkt) | ✅ Built-in | `ProbeTool` |
| Annotationen speichern (DICOM SR) | ✅ Built-in | measurement-tracking |

### Was fehlt für Dental (noch nicht vorhanden)
- ❌ Panoramalinie / Curved MPR / CPR
- ❌ Cross-Sectional Slices entlang einer Kurve
- ❌ Nervkanal-Markierung (Spline mit Sicherheitsabstand)
- ❌ Implantat-Overlay (3D-Zylinder in der Szene)
- ❌ Knochendicke-Messung entlang der Kurve
- ❌ Dental-spezifische Hanging Protocols (CBCT-Standard-Layout)
- ❌ Cephalometrische Landmarks

---

## Kernfrage: Panoramalinie (Curved MPR / CPR)

### Technische Realität

**Das Fundament ist vorhanden — aber nicht zusammengebaut.**

vtk.js (die Rendering-Engine unter Cornerstone3D) enthält `vtkImageCPRMapper` — einen GPU-basierten Curved Planar Reformation-Mapper. Er nimmt:
1. Ein CBCT-Volume (`vtkImageData`)
2. Eine Mittellinie / Zahnbogenspline (`vtkPolyData` mit Normalenvektoren)

→ und erzeugt daraus eine gestreckte oder gebogene Panoramaebene.

**Was 2025/2026 passiert ist:**
- Cornerstone3D Issue #1677: Erste Versuche, `vtkImageCPRMapper` in Cornerstone3D zu nutzen, schlugen fehl — der Mapper war nicht in der Rendering-Pipeline registriert.
- PR #1689: Fix gemergt — `ImageCPRMapper` ist jetzt nutzbar innerhalb eines Cornerstone3D-Viewports.
- Issue #2609 (Feb 2026, offen): Community-Feature-Request für einen First-Class CPR-Viewport in Cornerstone3D. **Noch nicht gebaut vom Core-Team.**

**Fazit:** Die Bausteine liegen bereit, aber niemand hat sie für Dental assembliert. Kein öffentliches OHIF-Extension für dentale Panorama-CBCT-Rekonstruktion gefunden.

### Drei Modi der CPR (vtk.js unterstützt alle)

| Modus | Beschreibung | Klinische Relevanz |
|-------|-------------|-------------------|
| **Straightened CPR** | Zahnbogen wird gerade gestreckt — klassisches Panoramabild-Äquivalent | Primär für Dental |
| **Stretched CPR** | Bogen wird auf eine Ebene ausgedehnt | Übersicht |
| **Projected CPR** | MIP/MinIP entlang der Kurve | Weichgewebe-Kontrast |

---

## Feature-Roadmap nach Phasen

### Phase 1 — Sofort (bereits vorhanden, nur konfigurieren)
*Aufwand: 0 — built-in, kein Code nötig*

| Feature | Aktion |
|---------|--------|
| Standard MPR-Layout für CBCT | Hanging Protocol in ohif-config.js anlegen |
| Dentale Window/Level-Presets | ✅ Bereits in config/ohif-config.js |
| Länge / Winkel / Knochenbreite messen | ✅ Built-in Tools aktiv |
| Implantatabstand schätzen (2× Längen-Tool) | ✅ Built-in |

---

### Phase 2 — Kurzfristig (Custom OHIF Extension, kein neues Primitiv)
*Aufwand: 1–2 Wochen / ~5 min CC+gstack*

#### 2a. Dental-CBCT Hanging Protocol
Standard-Layout wenn ein CBCT geladen wird:
- Oben links: Axial
- Oben rechts: Koronal
- Unten links: Sagittal
- Unten rechts: 3D Volume Rendering

```js
// config/ohif-config.js — HangingProtocol
{
  id: 'cbctDental',
  protocolMatchingRules: [{ attribute: 'StudyDescription', constraint: { contains: 'CBCT' } }],
  stages: [{ viewports: [
    { type: 'AXIAL' }, { type: 'CORONAL' },
    { type: 'SAGITTAL' }, { type: 'VOLUME_3D' }
  ]}]
}
```

**Aufwand:** 2–4 h. Rein konfigurativ.

#### 2b. Nervkanal-Annotation (Spline Tool)
Nutzung des bestehenden `SplineROITool` aus Cornerstone3D:
- Zahnarzt zeichnet Spline entlang des Canalis mandibularis
- Annotation wird als DICOM SR gespeichert
- Sicherheitsabstand (1–2 mm Buffer) als zweite gestrichelte Linie

**Aufwand:** 1–2 Tage. Custom AnnotationTool, baut auf `SplineROITool` auf.

#### 2c. Knochendicke entlang einer Linie
Messungs-Tool, das entlang einer Linie HU-Werte sampelt und die „Knochendicke" (HU > 300) berechnet.

**Aufwand:** 1 Tag. Custom Tool, baut auf `ProbeTool`-API auf.

---

### Phase 3 — Mittelfristig (Custom Viewport Extension, hohe Komplexität)
*Aufwand: 3–6 Wochen / ~2–4 h CC+gstack mit Cornerstone3D-Expertise*

#### 3a. Panorama-Viewport (Curved MPR / CPR)

**Komponenten:**
1. **Arch Spline Tool** — Custom `AnnotationTool`, der im Axial-View Kontrollpunkte für die Zahnbogenkurve aufnimmt (Klick-to-define oder automatisch via Bone-Segmentation)
2. **CPR Viewport Extension** — Custom OHIF `Viewport` Modul (React-Komponente), das:
   - Die Bogenkurve als `vtkPolyData` (Mittellinie + Normalen) aufbereitet
   - `vtkImageCPRMapper` mit dem CBCT-Volume verdrahtet (gemäß CS3D PR #1689)
   - Straightened CPR rendert: klassisches Panoramaäquivalent
3. **Slab-Dicke-Slider** — UI-Control für MIP über N mm Dicke (für besseren Weichgewebekontrast)

**Layout:**
```
┌─────────────────┬──────────────────────────────────┐
│  Axial View     │  Panorama-CPR (Straightened)      │
│  + Bogenlinie   │  ← klassisches Panoramaäquivalent │
├─────────────────┤                                  │
│  Sagittal       │  Slab-Dicke: [──●──────] 5 mm    │
└─────────────────┴──────────────────────────────────┘
```

**Voraussetzungen:**
- vtk.js `vtkImageCPRMapper` (verfügbar, PR #1689)
- OHIF Viewport Extension (Custom React Component)
- Cornerstone3D AnnotationTool API für Spline-Zeichnung

**Aufwand human:** 3–5 Wochen (Senior Frontend + Cornerstone3D-Kenntnisse)
**Aufwand CC+gstack:** ~4–8 h (mit Referenz-Implementierungen aus Issue #1677 + vtk.js-Doku)

---

#### 3b. Cross-Sectional Slices entlang der Kurve

Perpendikular-Schnitte an N gleichmäßigen Punkten entlang der Zahnbogenkurve — wie in klinischer Implantatsoftware (exoplan, CoDiagnostiX).

```
Panorama-View:
   |   |   |   |   |   |   |   |   |  ← Schnittmarker
   ↓   ↓   ↓   ↓   ↓   ↓   ↓   ↓   ↓
[Querschnitt-Grid: 9 × kleine Viewports]
```

**Technisch:** `vtkImageCPRMapper` per Point entlang der Kurve mit Rotation = 90°, oder direkt über VolumeViewport mit manuell gesetzter Oblique-Ebene.

**Aufwand human:** 2–3 Wochen (zusätzlich zu 3a)
**Aufwand CC+gstack:** ~2–4 h (baut direkt auf 3a auf)

---

### Phase 4 — Längerfristig (hohe klinische Komplexität)
*Aufwand: 2–4 Monate (human) / 1–2 Tage (CC+gstack)*

#### 4a. Implantat-Overlay / Implantat-Planung

3D-Zylinder (Implantat-Geometrie) in den Viewport platzieren, entlang des Nervkanals ausrichten, Bone-Clearance automatisch berechnen.

- Implantat-Bibliothek (Lengths/Diameters nach Hersteller: Straumann, Nobel, Camlog)
- Kollisions-Check mit Nervkanal-Annotation
- Export als DICOM RTSTRUCT oder proprietary format

**Aufwand human:** 6–12 Wochen
**Aufwand CC+gstack:** 2–3 Tage

**Benchmark:** CoDiagnostiX, exoplan, Blue Sky Plan (alle kommerziell, closed source)

---

#### 4b. Nervkanal-Auto-Segmentation

Automatische Erkennung des Canalis mandibularis mittels ML-Modell (z.B. nnU-Net pretrained auf dental CBCT).

- ONNX/TensorFlow.js-Modell im Browser ausführen (Cornerstone3D unterstützt WebGL-basierte Segmentation)
- Oder: serverseitiger Inference-Endpoint (Python FastAPI + nnU-Net)

**Aufwand human:** 3–6 Monate (inkl. Modell-Training/fine-tuning)
**Aufwand CC+gstack (Integration, kein Training):** 3–5 Tage

**Referenz:** Mehrere Paper auf PubMed (2022–2025) zu Auto-Segmentation des Mandibularkanals.

---

#### 4c. Cephalometrische Landmark-Erkennung

Für KFO: automatische oder semi-automatische Messung von cephalometrischen Punkten (S, N, A, B, ANS, PNS, Go, Gn...).

- MORDENT.AI (kommerziell) integriert sich mit OHIF für genau diesen Use Case
- OHIF Extension-Punkt: Custom Panel + Annotation Layer
- AI-gestützte Landmark-Detektion via ONNX

**Aufwand human:** 3–6 Monate
**Aufwand CC+gstack (Integration, kein Training):** 3–5 Tage

---

## Zusammenfassung: Aufwand pro Feature

| Feature | Phase | Human | CC+gstack | Status |
|---------|-------|-------|-----------|--------|
| Dental CBCT Hanging Protocol | 2 | 2–4 h | 30 min | ✅ **Shipped** (cbctDentalHP.ts) |
| Nervkanal-Spline-Annotation | 2 | 1–2 Tage | 2–3 h | ✅ **Shipped** (NerveCanalTool.js) |
| Knochendicke-Messung | 2 | 1 Tag | 1–2 h | ✅ **Shipped** (BoneThicknessTool.js) |
| FDI Zahn-Nummerierung | 2 | 1 Tag | 2 h | ✅ **Shipped** (ToothAnnotationTool.js + fdi.js) |
| **Panorama CPR Viewport** | **3** | **3–5 Wochen** | **4–8 h** | ✅ **Shipped** (DentalCPRViewport.tsx) |
| **Cross-Sectional Slices** | **3** | **+2–3 Wochen** | **+2–4 h** | ✅ **Shipped** (DentalCrossSectionViewport.tsx) |
| **3-Panel Layout** | **3** | 1 Tag | 1 h | ✅ **Shipped** (cbctDentalHP 2×2 grid) |
| **Custom OHIF Docker Build** | **3** | 3–5 Tage | 2 h | ✅ **Shipped** (Dockerfile.ohif, node:22) |
| Implantat-Overlay (3D-Zylinder) | 4 | 6–12 Wochen | 2–3 Tage | 🔶 Scaffold (Phase 5 in ImplantPlanningTool.js) |
| Nervkanal Auto-Seg | 4 | 3–6 Monate | 3–5 Tage | 🔶 Phase 4 |
| Cephalometrie-Landmarks | 4 | 3–6 Monate | 3–5 Tage | 🔶 Phase 4 |
| Auto Arch Detection (ML) | 5 | 6–12 Monate | 2–4 Wochen | 🔮 Phase 5 |

## Docker Build Status

> **Letzter Build: 2026-03-24 — `webpack 5.94.0 compiled with 14 warnings, 0 errors`**
> Image: `ambientct/ohif:latest` — 194 MB nginx (OHIF dist)

| Component | Build-Status | Verifiziert |
|-----------|-------------|-------------|
| `Dockerfile.ohif` (node:22, pluginConfig.json) | ✅ Gebaut | ✅ 2026-03-24 |
| `scripts/ohif/register-packages.js` | ✅ Gebaut | ✅ process.cwd() fix |
| `scripts/ohif/register-plugins.js` | ✅ Gebaut | ✅ non-fatal Step B |
| `scripts/ohif/compile-extensions.js` | ✅ Gebaut | ✅ JSX/TSX → ESM |
| DentalCPRViewport (vtkImageCPRMapper) | ✅ Webpack-Build OK | ⚠️ Runtime nicht verifiziert |
| DentalCrossSectionViewport (vtkImageReslice) | ✅ Webpack-Build OK | ⚠️ Runtime nicht verifiziert |
| DentalArchSplineTool | ✅ 6 Tests + Webpack OK | ✅ |
| NerveCanalTool, BoneThicknessTool, etc. | ✅ 17 Tests + Webpack OK | ✅ |
| Hanging Protocol (3-Panel CBCT) | ✅ Webpack-Build OK | ⚠️ Runtime nicht verifiziert |

**Build-Fixes (2026-03-24):**
- `ca-certificates` + `python3 make g++` — SSL + node-gyp native modules
- `process.cwd()` statt `__dirname` in Registrierungs-Scripts (Docker `/tmp` Copy)
- `compile-extensions.js` — Babel pre-compilation mit `modules: false` (ESM erhalten)
  → OHIF's webpack babel-loader excludes workspace symlinks; pre-compile löst das

**Bekannte offene Punkte (Runtime-Verifikation):**
- `vtkImageReslice` Importpfad: `@kitware/vtk.js/Imaging/Core/ImageReslice` — nur Webpack-Build OK, Runtime-Test mit echten CBCT-Daten steht aus
- DentalCPRViewport + vtkImageCPRMapper: Webpack-Build OK, vtk.js Runtime-Bindung zu verifizieren
- Hanging Protocol 3-Panel-Layout: Webpack-Build OK, OHIF-Layout-Engine Runtime zu testen

---

## Empfehlung für AmbientCT

### Was sofort in v1.1 sinnvoll ist (Phase 2)

1. **Dental Hanging Protocol** — 30 Minuten, hoher UX-Gewinn, CBCT öffnet direkt im richtigen Layout
2. **Nervkanal-Spline** — 2–3 h CC, differenziert AmbientCT von generischen Viewern
3. **Knochendicke** — 1–2 h CC, für Implantatplanung ohne CPR bereits wertvoll

### CPR als Phase-3-Meilenstein (v1.5 oder v2.0)

Der Panorama-CPR-Viewport ist **das** dentale Killer-Feature — kein anderer Open-Source OHIF-basierter Viewer hat es gebaut. Die technischen Bausteine (`vtkImageCPRMapper` + CS3D PR #1689) sind vorhanden; was fehlt, ist die Integration.

**Strategisch:** Wer das als erster Open-Source OHIF-Extension shipped, bekommt Community-Aufmerksamkeit und GitHub-Stars. Das ist AmbientCTs "moat" gegenüber generischen OHIF-Deployments.

**Vorgehensweise:**
1. Issue #2609 in Cornerstone3D beobachten — falls Core-Team es baut, rebase darauf
2. Wenn nicht: Custom Extension entwickeln (CC+gstack: ~1 Arbeitstag mit dem richtigen Prompt)
3. Als `@ambientwork/ohif-extension-dental-panoramic` auf npm publizieren

---

## Referenzen

- [OHIF Extensions Documentation](https://docs.ohif.org/platform/extensions/)
- [Cornerstone3D Tools](https://www.cornerstonejs.org/docs/concepts/cornerstone-tools/tools)
- [vtk.js ImageCPRMapper API](https://kitware.github.io/vtk-js/api/Rendering_Core_ImageCPRMapper.html)
- [CS3D Issue #1677 — CPR bug fix (merged)](https://github.com/cornerstonejs/cornerstone3D/issues/1677)
- [CS3D Issue #2609 — CPR feature request (open, Feb 2026)](https://github.com/cornerstonejs/cornerstone3D/issues)
- [SlicerSandbox CurvedPlanarReformat (Python reference)](https://github.com/PerkLab/SlicerSandbox)
- [lassoan gist — Dental CBCT panoramic in 3D Slicer](https://gist.github.com/lassoan)
