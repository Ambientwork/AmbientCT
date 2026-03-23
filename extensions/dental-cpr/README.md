# @ambientwork/ohif-extension-dental-cpr

> **World's first open-source OHIF extension for dental panoramic CBCT reconstruction.**

Draw a dental arch curve on an axial CBCT slice → instantly generate a panoramic reconstruction (Curved Planar Reformation) using `vtkImageCPRMapper`.

---

## What it does

| Step | Action |
|------|--------|
| 1 | Open a CBCT study — CBCT hanging protocol fires automatically |
| 2 | Click on the axial view to place control points along the dental arch |
| 3 | Double-click to finalise the curve |
| 4 | The right panel renders a **Straightened CPR** — a classic panoramic equivalent |
| 5 | Adjust the **Slab** slider (1–20 mm MIP) for better contrast |

---

## Status

| Component | Status |
|-----------|--------|
| `DentalArchSplineTool` — click to place arch control points | ✅ |
| Catmull-Rom spline interpolation (300 samples) | ✅ |
| Quaternion orientation array per spline point | ✅ |
| `vtkImageCPRMapper` wiring — Straightened CPR | ✅ |
| MIP slab thickness slider | ✅ |
| CBCT Hanging Protocol (2-panel auto-layout) | ✅ |
| OHIF Mode with tool group | ✅ |
| Custom Docker build (`Dockerfile.ohif`) | ✅ |
| Cross-sectional slices along the arch | 🔜 Phase 2 |
| Nerve canal annotation layer | 🔜 Phase 2 |
| Auto arch detection (ML) | 🔜 Phase 3 |

---

## Known Limitations

### 1. Docker build time
Building OHIF from source takes ~10–15 minutes. The pre-built `ohif/app` image does not support runtime extension loading — a full source build is required.

### 2. App.tsx patching
`Dockerfile.ohif` patches OHIF's `App.tsx` using string-search replacement. If OHIF changes the file structure in future versions, the patch fails loudly (`process.exit(1)`) — fix by manually editing `platform/app/src/App.tsx` to import the extension.

### 3. Camera orientation
`vtkImageCPRMapper` places its output plane at world origin `(0,0,0)`. The camera is positioned at `(0, 0, arcLength × 2)` — this works for axially-oriented CBCT. For non-standard DICOM orientations, the panoramic may appear blank; try adjusting the camera distance or rotation in `DentalCPRViewport.tsx`.

### 4. Coordinate system
The Catmull-Rom spline operates in Cornerstone3D world coordinates. The CBCT volume should be loaded as a VolumeViewport (not a Stack) for the volume cache lookup to succeed.

---

## Technical Foundation

| Building block | Notes |
|----------------|-------|
| `vtkImageCPRMapper` (vtk.js) | GPU-based CPR, ships with vtk.js |
| Cornerstone3D PR #1689 | Merged fix enabling CPR mapper inside CS3D viewports |
| Cornerstone3D Issue #2609 (Feb 2026, open) | Feature request for first-class CPR — this extension is the community answer |
| OHIF Extension System | `getViewportModule`, `getHangingProtocolModule`, `getCommandsModule` |

---

## Development

```bash
# From AmbientCT repo root — requires Node.js >= 20
node --version   # must be v20.x
corepack enable
yarn install

# Type-check extension in isolation
cd extensions/dental-cpr
npx tsc --noEmit
```

## Build custom OHIF image

```bash
# From repo root — builds OHIF + extension (~10 min first run)
docker compose build viewer-custom

# Switch to custom image:
# 1. Comment out 'viewer' in docker-compose.yml
# 2. Uncomment 'viewer-custom'
# 3. docker compose up -d
```

---

## License

MIT — © Ambientwork. Part of AmbientCT.
