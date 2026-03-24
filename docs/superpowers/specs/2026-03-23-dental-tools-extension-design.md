# Dental Tools OHIF Extension — Design Spec

**Date**: 2026-03-23
**Author**: Claude (brainstorming session)
**Branch**: Ambientwork/dental-tools-extension
**Decision**: Option A — custom OHIF Docker image built from source
**Review**: Spec reviewed, 10 issues resolved (3 CRITICAL, 5 IMPORTANT, 2 suggestions)

---

## Problem

AmbientCT deploys `ohif/app:v3.9.2` as a pre-built Docker image. OHIF built-in tools cover general radiology but lack dental-specific tools:

- No nerve canal marking with safety margins
- No implant planning overlay
- No FDI tooth numbering annotations
- No bone thickness measurement

Custom OHIF extensions cannot be injected at runtime — they require building OHIF from source.

---

## Architecture

### Custom Docker Image

A `Dockerfile.ohif` multi-stage build:

**Stage 1 — Builder** (node:18-alpine):
1. Clone OHIF v3.9.2 source
2. `COPY extensions/dental-tools/` into the OHIF workspace
3. Pre-compile the extension: `yarn workspace @ambientct/extension-dental-tools build`
   - Extension `package.json` must have a `build` script outputting `dist/index.js`
   - `main` field in `package.json` must point to `dist/index.js`, not `src/index.ts`
4. `COPY config/ohif/pluginConfig.json platform/app/pluginConfig.json` (replaces upstream config)
5. `yarn install && yarn run build` for the full OHIF app

**Stage 2 — Serve** (nginx:1.25-alpine):
- Copy `platform/app/dist/` to nginx html root
- Copy `config/nginx/ohif.conf` for serving static files

`docker-compose.yml` change:
```yaml
viewer:
  image: ambientct/ohif:latest
  build:
    context: .
    dockerfile: Dockerfile.ohif
  # Keep the volume mount for ohif-config.js (runtime config, not webpack config):
  volumes:
    - ./config/ohif-config.js:/usr/share/nginx/html/app-config.js:ro
```

> **Note**: There is no `scripts/register-extension.js` in OHIF v3.9.2. Extension registration is done by replacing `pluginConfig.json` with a pre-authored file via `COPY`.

---

## Extension Structure

```
extensions/dental-tools/
├── package.json                   # name: @ambientct/extension-dental-tools
│                                  # main: dist/index.js (compiled output)
│                                  # build script: tsc or babel → dist/
├── index.js                       # OHIF extension entry point (ES module)
├── src/
│   ├── tools/
│   │   ├── NerveCanalTool.js      # v1: Working — SplineROI-based
│   │   ├── ToothAnnotationTool.js # v1: Working — ArrowAnnotateTool-based
│   │   ├── ImplantPlanningTool.js # Phase 5: Scaffold — EllipticalROI-based
│   │   └── BoneThicknessTool.js   # v1: Working — LengthTool + HU sampling
│   ├── panels/
│   │   └── DentalToolsPanel.jsx   # Right sidebar panel (FDI picker, implant config)
│   └── utils/
│       └── fdi.js                 # FDI 11–48 tooth number lookup table
└── README.md
```

---

## Extension Registration

### config/ohif/pluginConfig.json

```json
{
  "extensions": [
    { "packageName": "@ohif/extension-default" },
    { "packageName": "@ohif/extension-cornerstone" },
    { "packageName": "@ohif/extension-measurement-tracking" },
    { "packageName": "@ohif/extension-cornerstone-dicom-sr" },
    { "packageName": "@ambientct/extension-dental-tools" }
  ],
  "modes": [
    { "packageName": "@ohif/mode-longitudinal" }
  ]
}
```

> Bare strings (e.g. `"@ohif/extension-default"`) are silently ignored in OHIF 3.9.x. Each entry must be an object with `packageName`.

### Extension Modules (index.js)

The extension exposes two modules:

- **`toolsModule`** — registers all 4 tools with Cornerstone3D's ToolGroupManager via the `tools` array. Tool group membership is declared here and activated within the mode definition, not via `customizationModule`.
- **`panelModule`** — registers `DentalToolsPanel` in the right sidebar.

Toolbar buttons (tool activation) are defined in the extension's **`toolbarModule`**, not in `window.config` / `ohif-config.js`. The runtime `window.config` in `ohif-config.js` does not have a `toolbarService` key.

---

## Tools — v1 (Fully Working)

### 1. NerveCanalTool

**Purpose**: Mark the Nervus alveolaris inferior path with an open spline. Show total length and safety margin distance to the nearest implant annotation.

**Implementation**: Extends `SplineROITool` from `@cornerstonejs/tools` (correct class for open-path splines with length — not `PlanarFreehandROITool` which draws closed polygons and computes area).

- User clicks successive points; CatmullRom spline is drawn through them
- Rendered as open path (not closed polygon)
- Label: `"N. alv. inf. — 38.2 mm"`
- Annotation data: `{ points: [...], length: mm }`
- If an `ImplantPlanningTool` annotation exists in the same viewport: compute minimum Euclidean distance using `annotation.state.getAnnotations()`. Render a dashed connecting line color-coded by safety margin:
  - ≥ 2mm → green
  - 1–2mm → orange
  - < 1mm → red

**Limitation**: 2D per-slice only. True 3D CPR (following the canal through axial slices) is Phase 5+.

---

### 2. ToothAnnotationTool

**Purpose**: Place FDI-numbered tooth annotations with optional finding codes.

**Implementation**: Extends `ArrowAnnotateTool` from `@cornerstonejs/tools`.
> ⚠️ The correct class name is `ArrowAnnotateTool` — not `ArrowAnnotationTool`. Import: `import { ArrowAnnotateTool } from '@cornerstonejs/tools'`.

**FDI picker UI bridge** (non-trivial, ~40% of implementation effort):
Cornerstone3D tools render on a canvas overlay, not in the React DOM. Bridging to a React picker UI requires:
1. Tool's `mouseUpCallback` dispatches a custom event via `eventTarget.dispatchEvent(new CustomEvent('DENTAL_TOOTH_PICK', { detail: { annotationUID, canvasPos } }))`
2. `DentalToolsPanel.jsx` (React) listens to this event and calls `UIDialogService.show()` to open a floating FDI picker dialog near `canvasPos`
3. On FDI number + finding selection, the React component calls `annotation.state.getAnnotation(annotationUID)` and mutates `annotation.data.toothNumber` + `annotation.data.finding`, then calls `triggerAnnotationModified()`

**FDI picker**: Grid of 11–48 (FDI schema, 4 quadrants × 8 teeth). Finding dropdown: none / caries / crown / implant / missing / root canal.

**Annotation rendering**: Arrow + label `"36 [Impl.]"`. Color by finding:
- No finding: white
- Caries: yellow
- Implant: blue
- Crown: purple
- Missing: gray
- Root canal: red

---

### 3. BoneThicknessTool

**Purpose**: User places two endpoints; tool measures distance and samples HU values along the line to estimate bone thickness.

**Implementation**: Extends `LengthTool` from `@cornerstonejs/tools`. Adds HU sampling via Cornerstone3D's `utilities.getVoxelManager` or `cache.getVolume()` pixel access.

- After endpoints placed: iterate N=20 equidistant points along the line
- Sample HU value at each point using `imageData.getScalarValueFromWorld(worldPos)`
- Count points with HU > 400 (cortical bone threshold)
- Bone thickness = (count / N) × total length
- Label: `"12.4 mm total | ~7.2 mm bone (HU>400)"`

> This is promoted from Phase 5+ to v1 because the HU sampling is feasible with Cornerstone3D's voxel API and adds meaningful dental value over the raw `LengthTool`.

**Note**: "Automatic bukko-lingual measurement perpendicular to bone surface" (requiring surface normal estimation via gradient) remains Phase 5+. This v1 tool requires manual endpoint placement.

---

## Tools — Phase 5+ (Structural Scaffold Only)

### 4. ImplantPlanningTool

**Why Phase 5+**: Clinically useful implant planning requires:
- 3D cylinder rendering in MPR viewports (VTK.js actor injection via `viewport.addActor()`)
- Rotation handles in 3D space
- Diameter/length persistence via DICOM SR

**v1 Scaffold**: Extends `EllipticalROITool`. Draws a circle (cross-section) with configurable diameter. A second drag defines length drawn as a rectangle. Labeled `"Impl. ⌀3.5mm × 10mm"`. Displays `[Phase 5 — no 3D cylinder]` tooltip when activated.

---

## Dockerfile.ohif

```dockerfile
# Stage 1: Build OHIF with dental-tools extension
FROM node:18-alpine AS builder
WORKDIR /ohif

RUN apk add --no-cache git python3 make g++

# Clone OHIF source (pinned to v3.9.2)
RUN git clone --depth 1 --branch v3.9.2 https://github.com/OHIF/Viewers.git .

# Copy dental-tools extension into workspace
COPY extensions/dental-tools/ extensions/dental-tools/

# Pre-compile extension (main must point to dist/index.js, not src/index.ts)
RUN yarn workspace @ambientct/extension-dental-tools build

# Replace pluginConfig with our version (includes @ambientct/extension-dental-tools)
COPY config/ohif/pluginConfig.json platform/app/pluginConfig.json

# Install all dependencies including the new extension
RUN yarn install --frozen-lockfile

# Build OHIF app
RUN yarn run build

# Stage 2: Serve
FROM nginx:1.25-alpine
COPY --from=builder /ohif/platform/app/dist /usr/share/nginx/html
COPY config/nginx/ohif.conf /etc/nginx/conf.d/default.conf
```

**Build times**:
- First build: ~8–12 min (yarn install + webpack)
- Rebuild after extension change: ~3–5 min (Docker layer cache skips git clone + install)
- Image size: ~350 MB

---

## config/nginx/ohif.conf

Required file (missing would cause `docker build` failure):

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # SPA routing: all non-file requests → index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|ico|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## What Works in v1

| Tool | Status | Functionality |
|------|--------|--------------|
| NerveCanalTool | ✅ **Working** | Open spline, length, safety margin color coding |
| ToothAnnotationTool | ✅ **Working** | FDI picker via UIDialogService, finding codes, color labels |
| BoneThicknessTool | ✅ **Working** | Manual two-point + HU sampling along line |
| ImplantPlanningTool | ⚠️ **Scaffold** | Circle + length line only, no 3D cylinder |

---

## What's Phase 5+

| Feature | Blocker |
|---------|---------|
| CPR / Panoramalinie | vtk.js CPR mapper integration (3–6 weeks) |
| 3D Implant Cylinder | VTK actor injection in MPR viewports |
| Auto bone thickness (perpendicular to surface) | Surface normal + ray casting |
| Cross-sectional slices along nerve canal | Requires CPR first |
| DICOM SR persistence | OHIF measurement-tracking integration |
| 3D spline across axial slices | Volumetric spline math |
| Cephalometric landmarks | Phase 6 |

---

## File Deliverables

1. `Dockerfile.ohif` — multi-stage build
2. `config/ohif/pluginConfig.json` — extension registration (object format)
3. `config/nginx/ohif.conf` — nginx SPA config for static OHIF serving
4. `extensions/dental-tools/package.json` — `main: dist/index.js`, build script
5. `extensions/dental-tools/index.js` — OHIF extension entry (toolsModule, panelModule, toolbarModule)
6. `extensions/dental-tools/src/tools/NerveCanalTool.js` — SplineROITool-based
7. `extensions/dental-tools/src/tools/ToothAnnotationTool.js` — ArrowAnnotateTool-based + UIDialogService bridge
8. `extensions/dental-tools/src/tools/BoneThicknessTool.js` — LengthTool + HU sampling
9. `extensions/dental-tools/src/tools/ImplantPlanningTool.js` — EllipticalROI scaffold
10. `extensions/dental-tools/src/utils/fdi.js` — FDI 11–48 lookup table
11. `extensions/dental-tools/src/panels/DentalToolsPanel.jsx` — FDI picker + event listener
12. `extensions/dental-tools/README.md` — what works and what's Phase 5+
13. Update `docker-compose.yml` — add `build:` section to viewer service
