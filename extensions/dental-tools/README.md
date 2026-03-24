# @ambientwork/ohif-extension-dental-tools

Dental measurement tools for AmbientCT (OHIF v3.9.2 + Cornerstone3D).

## What Works in v1

| Tool | Status | Description |
|------|--------|-------------|
| **NerveCanalTool** | ✅ Working | CatmullRom spline for N. alveolaris inferior. Length label. Color-coded safety margin to nearest implant: green ≥2mm, orange 1–2mm, red <1mm |
| **ToothAnnotationTool** | ✅ Working | Place FDI annotations (11–48). FDI picker + finding codes appear in right sidebar after placement |
| **BoneThicknessTool** | ✅ Working | Two-point measurement + HU sampling. Label: `12.4 mm gesamt | ~7.2 mm Knochen (HU>400)`. Requires volume viewport |
| **ImplantPlanningTool** | ⚠️ Scaffold | EllipticalROI circle with `Impl. ⌀3.5mm × 10mm [Phase 5]`. No 3D cylinder |

## Phase 5+ (Not Yet Implemented)

| Feature | Blocker |
|---------|---------|
| CPR / Panoramalinie | vtk.js `vtkImageCPRMapper` integration (~3–6 weeks) |
| 3D Implant Cylinder | `viewport.addActor(vtkCylinderSource)` — VTK actor API |
| Auto perpendicular bone thickness | Surface normal via HU gradient |
| Cross-sectional slices along canal | Requires CPR rendering first |
| DICOM SR persistence | OHIF measurement-tracking integration |
| 3D canal spline across axial slices | Volumetric spline math |

## Build

```bash
# Build the custom OHIF image (10–15 min first time, ~3 min after)
docker compose build viewer-custom

# Run with custom viewer on port 3001
docker compose up -d viewer-custom orthanc
# Open http://localhost:3001
```

## Unit Tests

```bash
cd extensions/dental-tools
npm install
npx jest
# Expected: 8 tests passing (5 FDI + 3 bone thickness)
```

## Architecture Notes

- **`ArrowAnnotateTool`** — correct class name (not `ArrowAnnotationTool`, which does not exist)
- **Toolbar buttons** in `getToolbarModule()` in `src/index.js` — not in `ohif-config.js`
- **BoneThicknessTool** requires a volume viewport — silently falls back on stack viewports
- **FDI picker bridge**: tool fires `CustomEvent('DENTAL_TOOTH_PICK')` → `DentalToolsPanel` listens → writes back via `annotation.state.getAnnotation()` + `triggerAnnotationModified()`
