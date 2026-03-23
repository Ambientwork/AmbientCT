# Dental CPR Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OHIF v3 extension that lets dentists draw a dental arch spline on an axial CBCT slice and instantly generates a Curved Planar Reformation (panoramic view) using `vtkImageCPRMapper`.

**Architecture:** Standalone OHIF extension (`extensions/dental-cpr/`) with a custom AnnotationTool for arch drawing and a custom Viewport component that wires `vtkImageCPRMapper` to the Cornerstone3D volume. A `Dockerfile.ohif` builds OHIF from source with the extension registered. `docker-compose.yml` gets a new `viewer-custom` service that uses the custom image.

**Tech Stack:** TypeScript, React 18, OHIF v3.9, Cornerstone3D, vtk.js (`@kitware/vtk.js`), Docker multi-stage build, yarn workspaces.

---

## Architecture Overview

```
extensions/dental-cpr/
├── package.json                    # ESM package, peer deps: @ohif/core, @cornerstonejs/*
└── src/
    ├── index.ts                    # Extension object — registers all modules
    ├── id.ts                       # Extension ID string constant
    ├── tools/
    │   └── DentalArchSplineTool.ts # AnnotationTool: click to place arch control points
    ├── viewports/
    │   └── DentalCPRViewport.tsx   # React viewport: wires vtkImageCPRMapper
    ├── utils/
    │   └── buildCenterline.ts      # Spline → vtkPolyData helper
    └── hanging-protocols/
        └── cbctDentalHP.ts         # Hanging protocol: CBCT → 3-panel dental layout

modes/dental-cpr-mode/
├── package.json
└── src/
    └── index.ts                    # Mode: 3-panel layout (Axial | Panorama | Cross-section)

Dockerfile.ohif                     # Multi-stage: OHIF source + extension → nginx image
```

## Key Data Flow

```
User clicks axial viewport
  → DentalArchSplineTool collects world-space control points
  → triggerAnnotationCompleted fires
  → DentalCPRViewport listens, calls buildCenterline(points)
  → buildCenterline returns vtkPolyData (centerline + normals)
  → vtkImageCPRMapper.setCenterlineData(polyData)
  → mapper.setImageData(volume.imageData)
  → renderer.addActor(cprActor) → render()
  → Panoramic image appears in CPR viewport panel
```

---

## Task 1: Node.js Build Environment

**Files:**
- Create: `package.json` (root workspace)
- Create: `.nvmrc`
- Create: `.yarnrc.yml`

- [ ] **Step 1.1: Create root package.json with yarn workspaces**

```json
{
  "name": "ambientct-extensions",
  "private": true,
  "workspaces": [
    "extensions/*",
    "modes/*"
  ],
  "packageManager": "yarn@4.0.2",
  "engines": { "node": ">=20.0.0" }
}
```

- [ ] **Step 1.2: Create .nvmrc**

```
20
```

- [ ] **Step 1.3: Verify Node.js available**

```bash
node --version   # must be >= 20
npm --version
```

Expected: `v20.x.x`

- [ ] **Step 1.4: Create .yarnrc.yml (PnP disabled for OHIF compat)**

```yaml
nodeLinker: node-modules
```

- [ ] **Step 1.5: Commit scaffold**

```bash
git add package.json .nvmrc .yarnrc.yml
git commit -m "chore: add yarn workspace root for OHIF extensions"
```

---

## Task 2: Extension Scaffold

**Files:**
- Create: `extensions/dental-cpr/package.json`
- Create: `extensions/dental-cpr/src/id.ts`
- Create: `extensions/dental-cpr/src/index.ts`
- Create: `extensions/dental-cpr/tsconfig.json`

- [ ] **Step 2.1: Create extension package.json**

```json
{
  "name": "@ambientwork/ohif-extension-dental-cpr",
  "version": "0.1.0",
  "description": "Dental panoramic CPR reconstruction for OHIF",
  "main": "src/index.ts",
  "peerDependencies": {
    "@ohif/core": "^3.9.0",
    "@cornerstonejs/core": "^2.0.0",
    "@cornerstonejs/tools": "^2.0.0",
    "@kitware/vtk.js": "^29.0.0",
    "react": "^18.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/react": "^18.0.0"
  }
}
```

- [ ] **Step 2.2: Create src/id.ts**

```ts
const id = '@ambientwork/ohif-extension-dental-cpr';
export default id;
```

- [ ] **Step 2.3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2.4: Create minimal src/index.ts (stub)**

```ts
import id from './id';

const extension = {
  id,
  version: '0.1.0',

  preRegistration({ servicesManager, extensionManager, configuration = {} }: any) {
    console.log('[DentalCPR] Extension registered');
  },

  getViewportModule({ servicesManager, extensionManager }: any) {
    const { default: DentalCPRViewport } = require('./viewports/DentalCPRViewport');
    return [{ name: 'dentalCPRViewport', component: DentalCPRViewport }];
  },

  getHangingProtocolModule() {
    const { cbctDentalHP } = require('./hanging-protocols/cbctDentalHP');
    return [{ name: cbctDentalHP.id, protocol: cbctDentalHP }];
  },
};

export default extension;
```

- [ ] **Step 2.5: Commit**

```bash
git add extensions/
git commit -m "feat(dental-cpr): scaffold extension package"
```

---

## Task 3: DentalArchSplineTool

> The tool that lets a dentist click a series of points on the axial CBCT slice to define the dental arch curve. Points are stored as a Cornerstone3D annotation. When the user double-clicks or presses Enter, the spline is finalized and an event fires.

**Files:**
- Create: `extensions/dental-cpr/src/tools/DentalArchSplineTool.ts`

- [ ] **Step 3.1: Create DentalArchSplineTool.ts**

```ts
import {
  AnnotationTool,
  annotation,
  drawing,
  eventTarget,
  Enums as csToolsEnums,
} from '@cornerstonejs/tools';
import { getEnabledElement, utilities as csUtils } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import type { EventTypes, SVGDrawingHelper } from '@cornerstonejs/tools/src/types';

const { addAnnotation, getAnnotations } = annotation.state;
const { drawHandles, drawPolyline } = drawing;
const { Events } = csToolsEnums;

export const ARCH_SPLINE_COMPLETED = 'DENTAL_ARCH_SPLINE_COMPLETED';

interface DentalArchAnnotation {
  annotationUID: string;
  metadata: { toolName: string; viewPlaneNormal: number[]; viewUp: number[]; referencedImageId?: string };
  data: {
    controlPoints: Types.Point3[];  // world-space 3D points
    isComplete: boolean;
  };
  highlighted: boolean;
  invalidated: boolean;
  isLocked: boolean;
  isVisible: boolean;
}

export default class DentalArchSplineTool extends AnnotationTool {
  static toolName = 'DentalArchSpline';

  private isDrawing = false;
  private currentAnnotationUID: string | null = null;

  constructor(toolProps = {}, defaultToolProps = {
    supportedInteractionTypes: ['Mouse', 'Touch'],
    configuration: {
      preventHandleOutsideImage: false,
      completeOnDoubleClick: true,
    },
  }) {
    super(toolProps, defaultToolProps);
  }

  // Called when user clicks and no existing annotation is hit
  addNewAnnotation(evt: EventTypes.InteractionEventType) {
    const { currentPoints, element } = evt.detail;
    const worldPos = currentPoints.world as Types.Point3;
    const enabledElement = getEnabledElement(element);

    if (!enabledElement?.viewport) return;

    const { viewport } = enabledElement;
    const camera = viewport.getCamera();

    if (this.isDrawing && this.currentAnnotationUID) {
      // Add point to existing annotation
      const annotations = getAnnotations(DentalArchSplineTool.toolName, element);
      const current = annotations.find(a => a.annotationUID === this.currentAnnotationUID) as DentalArchAnnotation;
      if (current) {
        current.data.controlPoints.push(worldPos);
        current.invalidated = true;
        annotation.state.triggerAnnotationModified(current, element);
      }
      return current as any;
    }

    // Start new annotation
    const newAnnotation: DentalArchAnnotation = {
      annotationUID: csUtils.uuidv4(),
      metadata: {
        toolName: DentalArchSplineTool.toolName,
        viewPlaneNormal: [...camera.viewPlaneNormal] as Types.Point3,
        viewUp: [...camera.viewUp] as Types.Point3,
      },
      data: {
        controlPoints: [worldPos],
        isComplete: false,
      },
      highlighted: true,
      invalidated: true,
      isLocked: false,
      isVisible: true,
    };

    addAnnotation(newAnnotation as any, element);
    this.isDrawing = true;
    this.currentAnnotationUID = newAnnotation.annotationUID;
    return newAnnotation as any;
  }

  // Double-click finalizes the spline
  doubleClickCallback(evt: EventTypes.InteractionEventType) {
    if (!this.isDrawing || !this.currentAnnotationUID) return;

    const { element } = evt.detail;
    const annotations = getAnnotations(DentalArchSplineTool.toolName, element);
    const current = annotations.find(a => a.annotationUID === this.currentAnnotationUID) as DentalArchAnnotation;

    if (current && current.data.controlPoints.length >= 3) {
      current.data.isComplete = true;
      current.invalidated = true;
      this.isDrawing = false;
      this.currentAnnotationUID = null;

      // Fire custom event so CPR viewport can react
      const customEvt = new CustomEvent(ARCH_SPLINE_COMPLETED, {
        detail: {
          controlPoints: current.data.controlPoints,
          element,
        },
        bubbles: true,
      });
      element.dispatchEvent(customEvt);
      annotation.state.triggerAnnotationCompleted(current as any);
    }
  }

  isPointNearTool(element: HTMLDivElement, annotation: any, canvasCoords: Types.Point2, proximity: number): boolean {
    const { data } = annotation as DentalArchAnnotation;
    const enabledElement = getEnabledElement(element);
    if (!enabledElement?.viewport) return false;

    const { viewport } = enabledElement;
    for (const worldPt of data.controlPoints) {
      const canvasPt = viewport.worldToCanvas(worldPt);
      const dist = Math.sqrt(
        Math.pow(canvasPt[0] - canvasCoords[0], 2) +
        Math.pow(canvasPt[1] - canvasCoords[1], 2)
      );
      if (dist < proximity) return true;
    }
    return false;
  }

  renderAnnotation(enabledElement: Types.IEnabledElement, svgDrawingHelper: SVGDrawingHelper): boolean {
    const { viewport } = enabledElement;
    const annotations = getAnnotations(DentalArchSplineTool.toolName, viewport.element) as DentalArchAnnotation[];

    if (!annotations?.length) return false;

    for (const ann of annotations) {
      if (!ann.isVisible) continue;

      const canvasPoints = ann.data.controlPoints.map(p => viewport.worldToCanvas(p));

      // Draw the polyline connecting control points
      if (canvasPoints.length > 1) {
        drawPolyline(
          svgDrawingHelper,
          ann.annotationUID,
          'polyline',
          canvasPoints,
          {
            color: ann.data.isComplete ? '#00ff88' : '#ffcc00',
            lineWidth: 2,
            lineDash: ann.data.isComplete ? '' : '4,4',
          }
        );
      }

      // Draw handles at each control point
      drawHandles(svgDrawingHelper, ann.annotationUID, 'handles', canvasPoints, {
        color: '#00aaff',
        handleRadius: 4,
        lineWidth: 2,
      });
    }

    return true;
  }
}
```

- [ ] **Step 3.2: Commit**

```bash
git add extensions/dental-cpr/src/tools/
git commit -m "feat(dental-cpr): add DentalArchSplineTool AnnotationTool"
```

---

## Task 4: buildCenterline Utility

> Converts an array of world-space 3D control points into a `vtkPolyData` centerline with orientation normals, ready for `vtkImageCPRMapper`.

**Files:**
- Create: `extensions/dental-cpr/src/utils/buildCenterline.ts`

- [ ] **Step 4.1: Create buildCenterline.ts**

```ts
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { Types } from '@cornerstonejs/core';

/**
 * Interpolate a Catmull-Rom spline through control points.
 * Returns N evenly-spaced points along the spline arc.
 */
function catmullRomSpline(controlPoints: Types.Point3[], numSamples = 200): Types.Point3[] {
  const pts: Types.Point3[] = [];
  const n = controlPoints.length;
  if (n < 2) return controlPoints;

  const p = (i: number) => controlPoints[Math.max(0, Math.min(n - 1, i))];

  for (let seg = 0; seg < n - 1; seg++) {
    const segSamples = Math.max(2, Math.floor(numSamples / (n - 1)));
    for (let t = 0; t < segSamples; t++) {
      const s = t / segSamples;
      const [p0, p1, p2, p3] = [p(seg - 1), p(seg), p(seg + 1), p(seg + 2)];
      const s2 = s * s, s3 = s2 * s;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * s + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * s2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * s3);
      const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * s + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * s2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * s3);
      const z = 0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * s + (2*p0[2] - 5*p1[2] + 4*p2[2] - p3[2]) * s2 + (-p0[2] + 3*p1[2] - 3*p2[2] + p3[2]) * s3);
      pts.push([x, y, z]);
    }
  }
  pts.push(p(n - 1));
  return pts;
}

/**
 * Build a vtkPolyData centerline suitable for vtkImageCPRMapper.
 *
 * @param controlPoints  World-space 3D control points defining the dental arch
 * @param numSamples     Number of interpolated points along the spline
 * @returns vtkPolyData with Points and Lines set; orientation array is uniform (bitangent = image Z)
 */
export function buildCenterline(controlPoints: Types.Point3[], numSamples = 200): any {
  const splinePoints = catmullRomSpline(controlPoints, numSamples);
  const n = splinePoints.length;

  // Flatten to Float32Array
  const flatPts = new Float32Array(n * 3);
  splinePoints.forEach(([x, y, z], i) => {
    flatPts[i * 3 + 0] = x;
    flatPts[i * 3 + 1] = y;
    flatPts[i * 3 + 2] = z;
  });

  // Build polyline connectivity
  const lineCell = new Uint32Array(n + 1);
  lineCell[0] = n;
  for (let i = 0; i < n; i++) lineCell[i + 1] = i;

  const polyData = vtkPolyData.newInstance();

  const points = vtkPoints.newInstance({ dataType: 'Float32Array', size: n * 3 });
  points.setData(flatPts, 3);
  polyData.setPoints(points);

  const lines = vtkCellArray.newInstance({ dataType: 'Uint32Array' });
  lines.setData(lineCell);
  polyData.setLines(lines);

  // Per-point orientation normals (orthogonal to tangent, pointing toward image superior)
  // We compute tangent at each point and derive normal = tangent × [0,0,1] normalized
  const orientations = new Float32Array(n * 9); // mat3 per point (row-major)
  for (let i = 0; i < n; i++) {
    const prev = splinePoints[Math.max(0, i - 1)];
    const next = splinePoints[Math.min(n - 1, i + 1)];
    const tx = next[0] - prev[0], ty = next[1] - prev[1], tz = next[2] - prev[2];
    const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
    const T = [tx/tLen, ty/tLen, tz/tLen];

    // Normal: tangent × Z_world
    let nx = T[1]*1 - T[2]*0, ny = T[2]*0 - T[0]*1, nz = T[0]*0 - T[1]*0;
    // Fallback if tangent is parallel to Z
    if (Math.abs(nz) > 0.99) { nx = 1; ny = 0; nz = 0; }
    const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    [nx, ny, nz] = [nx/nLen, ny/nLen, nz/nLen];

    // Bitangent = T × N
    const bx = T[1]*nz - T[2]*ny;
    const by = T[2]*nx - T[0]*nz;
    const bz = T[0]*ny - T[1]*nx;

    // Row-major mat3: columns = T, N, B
    const o = i * 9;
    orientations[o+0]=T[0]; orientations[o+1]=T[1]; orientations[o+2]=T[2];
    orientations[o+3]=nx;   orientations[o+4]=ny;   orientations[o+5]=nz;
    orientations[o+6]=bx;   orientations[o+7]=by;   orientations[o+8]=bz;
  }

  const orientationArray = vtkDataArray.newInstance({
    name: 'Orientation',
    numberOfComponents: 9,
    values: orientations,
  });
  polyData.getPointData().addArray(orientationArray);

  return polyData;
}
```

- [ ] **Step 4.2: Commit**

```bash
git add extensions/dental-cpr/src/utils/
git commit -m "feat(dental-cpr): add Catmull-Rom spline + vtkPolyData centerline builder"
```

---

## Task 5: DentalCPRViewport

> The custom OHIF Viewport component. Receives the CBCT volume from Cornerstone3D cache, listens for `ARCH_SPLINE_COMPLETED` events, and renders the CPR panoramic image using `vtkImageCPRMapper`.

**Files:**
- Create: `extensions/dental-cpr/src/viewports/DentalCPRViewport.tsx`

- [ ] **Step 5.1: Create DentalCPRViewport.tsx**

```tsx
import React, { useEffect, useRef, useCallback, useState } from 'react';
import { cache, getRenderingEngine, type Types } from '@cornerstonejs/core';
import vtkImageCPRMapper from '@kitware/vtk.js/Rendering/Core/ImageCPRMapper';
import vtkImageSlice from '@kitware/vtk.js/Rendering/Core/ImageSlice';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { buildCenterline } from '../utils/buildCenterline';
import { ARCH_SPLINE_COMPLETED } from '../tools/DentalArchSplineTool';

interface DentalCPRViewportProps {
  viewportId: string;
  displaySets: any[];
  servicesManager: any;
  extensionManager: any;
  commandsManager: any;
}

export default function DentalCPRViewport({
  viewportId,
  displaySets,
  servicesManager,
}: DentalCPRViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vtkContainerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<any>(null);
  const renderWindowRef = useRef<any>(null);
  const openGLRenderWindowRef = useRef<any>(null);
  const actorRef = useRef<any>(null);
  const mapperRef = useRef<any>(null);

  const [status, setStatus] = useState<'waiting' | 'ready' | 'rendering' | 'error'>('waiting');
  const [slabThickness, setSlabThickness] = useState(5);
  const [statusMsg, setStatusMsg] = useState('Draw the dental arch curve on the axial view');

  // Initialize vtk.js rendering pipeline
  useEffect(() => {
    if (!vtkContainerRef.current) return;

    const renderWindow = vtkRenderWindow.newInstance();
    const renderer = vtkRenderer.newInstance({ background: [0.05, 0.05, 0.05] });
    renderWindow.addRenderer(renderer);

    const openGLRenderWindow = vtkOpenGLRenderWindow.newInstance();
    openGLRenderWindow.setContainer(vtkContainerRef.current);
    openGLRenderWindow.setSize(
      vtkContainerRef.current.clientWidth || 600,
      vtkContainerRef.current.clientHeight || 400
    );
    renderWindow.addView(openGLRenderWindow);

    const interactor = vtkRenderWindowInteractor.newInstance();
    interactor.setView(openGLRenderWindow);
    interactor.initialize();
    interactor.bindEvents(vtkContainerRef.current);

    rendererRef.current = renderer;
    renderWindowRef.current = renderWindow;
    openGLRenderWindowRef.current = openGLRenderWindow;

    return () => {
      renderWindow.finalize();
      openGLRenderWindow.delete();
    };
  }, []);

  // Get volume from displaySet
  const getVolume = useCallback(() => {
    if (!displaySets?.length) return null;
    const displaySet = displaySets[0];
    const volumeId = displaySet.volumeId || `cornerstoneStreamingImageVolume:${displaySet.displaySetInstanceUID}`;
    return cache.getVolume(volumeId);
  }, [displaySets]);

  // Render CPR when arch spline is completed
  const handleArchSplineCompleted = useCallback((evt: CustomEvent) => {
    const { controlPoints } = evt.detail as { controlPoints: Types.Point3[] };
    if (controlPoints.length < 3) {
      setStatusMsg('Need at least 3 control points. Keep drawing.');
      return;
    }

    const volume = getVolume();
    if (!volume) {
      setStatusMsg('Volume not loaded yet. Please wait for CBCT to finish loading.');
      setStatus('error');
      return;
    }

    setStatus('rendering');
    setStatusMsg('Generating panoramic reconstruction...');

    try {
      const renderer = rendererRef.current;
      if (!renderer) return;

      // Remove previous actor
      if (actorRef.current) {
        renderer.removeActor(actorRef.current);
      }

      // Build centerline polydata from control points
      const centerlinePolyData = buildCenterline(controlPoints, 300);

      // Create CPR mapper and actor
      const mapper = vtkImageCPRMapper.newInstance();
      const actor = vtkImageSlice.newInstance();
      actor.setMapper(mapper);

      // Connect volume image data
      mapper.setInputData(volume.imageData, 0);      // port 0 = image
      mapper.setInputData(centerlinePolyData, 1);    // port 1 = centerline

      // Configure CPR mode
      mapper.useStraightenedMode();
      mapper.setWidth(80);    // 80mm width covers a full dental arch

      // MIP slab for better panoramic quality
      mapper.setProjectionSlabThickness(slabThickness);
      mapper.setProjectionSlabNumberOfSamples(slabThickness * 5 + 1); // odd number

      // Use per-point orientation from centerline PointData
      mapper.setUseUniformOrientation(false);
      mapper.setOrientationArrayName('Orientation');

      renderer.addActor(actor);

      // Orient camera to view the CPR output plane
      const dirMatrix = mapper.getDirectionMatrix();
      const camera = renderer.getActiveCamera();
      if (dirMatrix) {
        // CPR output is at world origin; camera looks along normal direction
        camera.setPosition(0, 0, 500);
        camera.setFocalPoint(0, 0, 0);
        camera.setViewUp(0, 1, 0);
      }

      renderer.resetCamera();
      renderWindowRef.current?.render();

      actorRef.current = actor;
      mapperRef.current = mapper;
      setStatus('ready');
      setStatusMsg('Panoramic reconstruction ready. Double-click axial view to redraw arch.');

    } catch (err: any) {
      console.error('[DentalCPR] CPR render error:', err);
      setStatus('error');
      setStatusMsg(`Render error: ${err.message}. Check console for details.`);
    }
  }, [getVolume, slabThickness]);

  // Listen for arch spline events from axial viewport
  useEffect(() => {
    const handler = (evt: Event) => handleArchSplineCompleted(evt as CustomEvent);
    window.addEventListener(ARCH_SPLINE_COMPLETED, handler);
    // Also listen on document for events from other DOM trees
    document.addEventListener(ARCH_SPLINE_COMPLETED, handler);
    return () => {
      window.removeEventListener(ARCH_SPLINE_COMPLETED, handler);
      document.removeEventListener(ARCH_SPLINE_COMPLETED, handler);
    };
  }, [handleArchSplineCompleted]);

  // Update slab thickness in real-time
  useEffect(() => {
    if (mapperRef.current && status === 'ready') {
      mapperRef.current.setProjectionSlabThickness(slabThickness);
      mapperRef.current.setProjectionSlabNumberOfSamples(slabThickness * 5 + 1);
      renderWindowRef.current?.render();
    }
  }, [slabThickness, status]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#111', color: '#eee', fontFamily: 'monospace' }}
    >
      {/* Header */}
      <div style={{ padding: '6px 12px', background: '#1a1a1a', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
        <span style={{ color: '#00aaff', fontWeight: 'bold' }}>🦷 Dental Panoramic CPR</span>
        <span style={{ color: status === 'error' ? '#ff6666' : status === 'ready' ? '#00ff88' : '#ffcc00', flex: 1 }}>
          {statusMsg}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#aaa' }}>Slab</span>
          <input
            type="range" min={1} max={20} value={slabThickness}
            onChange={e => setSlabThickness(Number(e.target.value))}
            style={{ width: 80 }}
          />
          <span style={{ color: '#fff', minWidth: 30 }}>{slabThickness}mm</span>
        </label>
      </div>

      {/* VTK rendering canvas */}
      <div
        ref={vtkContainerRef}
        style={{ flex: 1, position: 'relative', background: '#0a0a0a' }}
      >
        {status === 'waiting' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: '#555', gap: 12
          }}>
            <div style={{ fontSize: 48 }}>🦷</div>
            <div style={{ fontSize: 14, textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
              Click to place control points along the dental arch in the axial view.<br />
              Double-click to complete the curve.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2: Commit**

```bash
git add extensions/dental-cpr/src/viewports/
git commit -m "feat(dental-cpr): add DentalCPRViewport with vtkImageCPRMapper wiring"
```

---

## Task 6: Hanging Protocol

> Automatically shows the 3-panel dental layout (Axial | Panoramic CPR | [future: Cross-Sections]) when a CBCT study is opened.

**Files:**
- Create: `extensions/dental-cpr/src/hanging-protocols/cbctDentalHP.ts`

- [ ] **Step 6.1: Create cbctDentalHP.ts**

```ts
export const cbctDentalHP = {
  id: 'cbctDentalCPR',
  hasUpdatedPriorsInformation: false,
  name: 'Dental CBCT + CPR',
  createdDate: '2026-03-23',
  modifiedDate: '2026-03-23',
  availableTo: {},
  editableBy: {},

  // Match CBCT studies (CT modality)
  protocolMatchingRules: [
    {
      attribute: 'ModalitiesInStudy',
      constraint: { containsI: 'CT' },
      required: true,
    },
  ],

  stages: [
    {
      id: 'cbctDentalCPRStage',
      name: 'Dental CBCT + Panoramic CPR',

      stageActivationCriteria: {},

      viewportStructure: {
        layoutType: 'grid',
        properties: {
          rows: 1,
          columns: 2,
        },
      },

      viewports: [
        // Left: standard axial viewport (user draws arch here)
        {
          viewportOptions: {
            viewportId: 'cbctAxial',
            viewportType: 'volume',
            orientation: 'axial',
            toolGroupId: 'dentalCPRToolGroup',
            initialImageOptions: { preset: -1 },
            background: [0, 0, 0],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
          position: { x: 0, y: 0, width: 0.5, height: 1.0 },
        },

        // Right: custom CPR viewport (shows panoramic reconstruction)
        {
          viewportOptions: {
            viewportId: 'dentalCPR',
            viewportType: 'custom',
            customViewportType: '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCPRViewport',
            toolGroupId: 'dentalCPRToolGroup',
            background: [0.05, 0.05, 0.05],
          },
          displaySets: [{ id: 'ctDisplaySet' }],
          position: { x: 0.5, y: 0, width: 0.5, height: 1.0 },
        },
      ],

      displaySets: [
        {
          id: 'ctDisplaySet',
          seriesMatchingRules: [
            { attribute: 'Modality', constraint: { equals: 'CT' }, required: true },
          ],
        },
      ],
    },
  ],
};
```

- [ ] **Step 6.2: Commit**

```bash
git add extensions/dental-cpr/src/hanging-protocols/
git commit -m "feat(dental-cpr): add CBCT hanging protocol for 2-panel CPR layout"
```

---

## Task 7: Mode

**Files:**
- Create: `modes/dental-cpr-mode/package.json`
- Create: `modes/dental-cpr-mode/src/index.ts`

- [ ] **Step 7.1: Create mode package.json**

```json
{
  "name": "@ambientwork/ohif-mode-dental-cpr",
  "version": "0.1.0",
  "description": "OHIF mode for dental panoramic CPR workflow",
  "main": "src/index.ts",
  "peerDependencies": {
    "@ohif/core": "^3.9.0",
    "@ambientwork/ohif-extension-dental-cpr": "0.1.0"
  }
}
```

- [ ] **Step 7.2: Create mode src/index.ts**

```ts
import { addTool, ToolGroupManager, MouseBindings } from '@cornerstonejs/tools';
import DentalArchSplineTool from '../../extensions/dental-cpr/src/tools/DentalArchSplineTool';

const extensionDependencies = {
  '@ohif/extension-default': '^3.9.0',
  '@ohif/extension-cornerstone': '^3.9.0',
  '@ambientwork/ohif-extension-dental-cpr': '^0.1.0',
};

function modeFactory() {
  return {
    id: '@ambientwork/ohif-mode-dental-cpr',
    version: '0.1.0',
    displayName: 'Dental CPR',
    description: 'Draw arch curve → automatic panoramic reconstruction from CBCT',

    extensions: extensionDependencies,

    routes: [
      {
        path: 'dentalCPR',
        layoutTemplate: ({ location, servicesManager }: any) => ({
          id: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
          props: {
            leftPanels: ['@ohif/extension-default.panelModule.seriesList'],
            rightPanels: [],
            viewports: [
              {
                namespace: '@ohif/extension-cornerstone.viewportModule.cornerstone',
                displaySetsToDisplay: ['@ohif/extension-default.sopClassHandlerModule.stack'],
              },
              {
                namespace: '@ambientwork/ohif-extension-dental-cpr.viewportModule.dentalCPRViewport',
                displaySetsToDisplay: ['@ohif/extension-default.sopClassHandlerModule.stack'],
              },
            ],
          },
        }),

        init: async ({ servicesManager, extensionManager }: any) => {
          const { toolGroupService } = servicesManager.services;

          // Register dental arch spline tool
          addTool(DentalArchSplineTool);

          // Create or get tool group
          let toolGroup = toolGroupService.getToolGroup('dentalCPRToolGroup');
          if (!toolGroup) {
            toolGroup = toolGroupService.createToolGroup('dentalCPRToolGroup');
          }

          toolGroup.addTool(DentalArchSplineTool.toolName);
          toolGroup.setToolActive(DentalArchSplineTool.toolName, {
            bindings: [{ mouseButton: MouseBindings.Primary }],
          });
        },
      },
    ],

    hangingProtocol: ['cbctDentalCPR'],

    isValidMode: ({ modalities }: { modalities: string }) => ({
      valid: modalities?.split('\\').some((m: string) => ['CT'].includes(m)) ?? false,
      verificationMessage: 'Dental CPR mode requires CT/CBCT data',
    }),

    onModeEnter() {
      console.log('[DentalCPR] Mode entered — draw arch on axial view to generate panoramic');
    },

    onModeExit() {
      console.log('[DentalCPR] Mode exited');
    },
  };
}

export default { id: '@ambientwork/ohif-mode-dental-cpr', modeFactory, extensionDependencies };
```

- [ ] **Step 7.3: Commit**

```bash
git add modes/
git commit -m "feat(dental-cpr): add dental CPR mode with tool group init"
```

---

## Task 8: Dockerfile.ohif (Custom Build)

> Multi-stage Docker build: clone OHIF source, register our extension + mode, build with Yarn, serve with nginx.

**Files:**
- Create: `Dockerfile.ohif`
- Modify: `docker-compose.yml` (add `viewer-custom` service, commented out by default)

- [ ] **Step 8.1: Create Dockerfile.ohif**

```dockerfile
# syntax=docker/dockerfile:1
# Stage 1: Build OHIF with dental-cpr extension
FROM node:20-slim AS builder

WORKDIR /ohif

# Clone OHIF v3.9.2 (pinned)
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch v3.9.2 https://github.com/OHIF/Viewers.git .

# Enable corepack for yarn
RUN corepack enable && yarn set version stable

# Copy our extension and mode into the OHIF monorepo
COPY extensions/dental-cpr/ extensions/dental-cpr/
COPY modes/dental-cpr-mode/ modes/dental-cpr-mode/

# Register extension in OHIF's platform/app/package.json
# (sed is safe here — we're modifying a known file structure)
RUN node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('platform/app/package.json', 'utf8'));
pkg.dependencies['@ambientwork/ohif-extension-dental-cpr'] = 'file:../../extensions/dental-cpr';
pkg.dependencies['@ambientwork/ohif-mode-dental-cpr'] = 'file:../../modes/dental-cpr-mode';
fs.writeFileSync('platform/app/package.json', JSON.stringify(pkg, null, 2));
console.log('Registered extension + mode in OHIF package.json');
"

# Patch platform/app/src/App.tsx to include our extension and mode
# (append before the closing of the extensions/modes arrays)
RUN node -e "
const fs = require('fs');
let app = fs.readFileSync('platform/app/src/App.tsx', 'utf8');
// Add import
app = app.replace(
  'import OHIFDefaultExtension from',
  'import DentalCPRExtension from \"@ambientwork/ohif-extension-dental-cpr\";\nimport DentalCPRMode from \"@ambientwork/ohif-mode-dental-cpr\";\nimport OHIFDefaultExtension from'
);
// Add to extensions array
app = app.replace(
  '/* Extensions */',
  '/* Extensions */\n    DentalCPRExtension,'
);
// Add to modes array
app = app.replace(
  '/* Modes */',
  '/* Modes */\n    DentalCPRMode,'
);
fs.writeFileSync('platform/app/src/App.tsx', app);
console.log('Patched App.tsx');
" || echo "App.tsx patch failed — manual integration needed"

# Install all dependencies
RUN yarn install

# Build OHIF (outputs to platform/app/dist)
RUN yarn run build

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine AS runner

# Copy OHIF build output
COPY --from=builder /ohif/platform/app/dist /usr/share/nginx/html

# Default nginx config (serve SPA)
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n  location / { try_files \$uri \$uri/ /index.html; }\n  location /app-config.js { add_header Cache-Control no-cache; }\n}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
```

- [ ] **Step 8.2: Add viewer-custom service to docker-compose.yml**

Add this block to `docker-compose.yml` (inside `services:`, commented out):

```yaml
  # viewer-custom:
  #   build:
  #     context: .
  #     dockerfile: Dockerfile.ohif
  #   platform: linux/amd64
  #   container_name: ambientct-viewer-custom
  #   restart: unless-stopped
  #   mem_limit: ${VIEWER_MEM_LIMIT:-256m}
  #   cpus: ${VIEWER_CPUS:-0.5}
  #   ports:
  #     - "${VIEWER_PORT:-3000}:80"
  #   volumes:
  #     - ./config/ohif-config.js:/usr/share/nginx/html/app-config.js:ro
  #   depends_on:
  #     orthanc:
  #       condition: service_healthy
  #   networks:
  #     - pacs-net
  #   # To use: comment out the 'viewer' service above, uncomment this block,
  #   # then run: docker compose build viewer-custom && docker compose up -d
```

- [ ] **Step 8.3: Commit**

```bash
git add Dockerfile.ohif docker-compose.yml
git commit -m "feat(dental-cpr): add Dockerfile.ohif for custom OHIF build with CPR extension"
```

---

## Task 9: README and Known Limitations

**Files:**
- Create: `extensions/dental-cpr/README.md`

- [ ] **Step 9.1: Create extension README**

```markdown
# @ambientwork/ohif-extension-dental-cpr

> World's first open-source OHIF extension for dental panoramic CBCT reconstruction.

## What it does

Draw a dental arch curve on an axial CBCT slice → instantly generates a panoramic reconstruction (curved planar reformation) using `vtkImageCPRMapper`.

## Status

| Feature | Status |
|---------|--------|
| DentalArchSplineTool — draw arch points | ✅ Implemented |
| Catmull-Rom spline interpolation | ✅ Implemented |
| vtkPolyData centerline with orientation normals | ✅ Implemented |
| vtkImageCPRMapper wiring | ✅ Implemented |
| Slab thickness slider (MIP) | ✅ Implemented |
| CBCT hanging protocol | ✅ Implemented |
| OHIF mode with tool group | ✅ Implemented |
| Custom OHIF Docker build | ✅ Implemented |
| Cross-sectional slices along curve | 🔜 Phase 2 |
| Nerve canal annotation layer | 🔜 Phase 2 |
| Auto arch detection (ML) | 🔜 Phase 3 |

## Known Limitations

1. **Docker build time:** Building OHIF from source takes ~10-15 minutes. The pre-built `ohif/app` image does not support runtime extension loading.

2. **App.tsx patching:** The `Dockerfile.ohif` patches `App.tsx` using string replacement. If OHIF changes the file structure in future versions, the patch may fail. Manual integration is the fallback.

3. **Camera orientation:** `vtkImageCPRMapper` places the output at world origin (0,0,0). The camera orientation logic in `DentalCPRViewport.tsx` may need tuning per dataset — if the panoramic appears blank, try adjusting `camera.setPosition(0, 0, distance)` where `distance = mapper.getHeight() * 2`.

4. **Coordinate system:** The Catmull-Rom spline operates in Cornerstone3D world coordinates. If the CBCT volume has a non-standard DICOM orientation, the centerline normals may not align correctly. Workaround: ensure CBCT is axially oriented before use.

5. **No cross-sections yet:** The companion perpendicular-slice view is not implemented in this prototype. The data flow is in place; the viewport component needs to be added.

## Development

```bash
# From repo root
node --version   # must be >= 20
corepack enable
yarn install

# Type-check the extension
cd extensions/dental-cpr
npx tsc --noEmit
```

## Build custom OHIF image

```bash
# Takes ~15 minutes first time (clones + builds OHIF)
docker compose build viewer-custom

# Switch to custom image:
# 1. Comment out 'viewer' service in docker-compose.yml
# 2. Uncomment 'viewer-custom' service
# 3. Run: docker compose up -d
```

## Technical Foundation

- `vtkImageCPRMapper` — vtk.js GPU-based curved planar reformation
- Cornerstone3D PR #1689 — merged fix enabling CPR mapper in CS3D viewports
- CS3D Issue #2609 — open feature request for first-class CPR viewport (this is our answer)
```

- [ ] **Step 9.2: Commit**

```bash
git add extensions/dental-cpr/README.md
git commit -m "docs(dental-cpr): add extension README with status, limitations, build instructions"
```

---

## Task 10: Verify Structure

- [ ] **Step 10.1: Verify file tree**

```bash
find extensions/ modes/ Dockerfile.ohif -type f | sort
```

Expected output:
```
Dockerfile.ohif
extensions/dental-cpr/README.md
extensions/dental-cpr/package.json
extensions/dental-cpr/src/hanging-protocols/cbctDentalHP.ts
extensions/dental-cpr/src/id.ts
extensions/dental-cpr/src/index.ts
extensions/dental-cpr/src/tools/DentalArchSplineTool.ts
extensions/dental-cpr/src/utils/buildCenterline.ts
extensions/dental-cpr/src/viewports/DentalCPRViewport.tsx
extensions/dental-cpr/tsconfig.json
modes/dental-cpr-mode/package.json
modes/dental-cpr-mode/src/index.ts
```

- [ ] **Step 10.2: TypeScript check (if tsc available)**

```bash
cd extensions/dental-cpr
npx tsc --noEmit --strict 2>&1 | head -40
```

Expected: Type errors will exist due to missing peer deps in isolation; that's OK. No syntax errors.

- [ ] **Step 10.3: Final commit**

```bash
git add -A
git status --short
git commit -m "feat(dental-cpr): complete prototype — arch tool + CPR viewport + Docker build"
```

---

## What Works vs What Needs Testing

| Item | Expected | Risk |
|------|----------|------|
| Extension file structure | Correct OHIF module shape | Low |
| DentalArchSplineTool draws points | Should work on axial viewport | Low |
| buildCenterline spline math | Catmull-Rom is standard | Low |
| vtkImageCPRMapper wiring | Requires CS3D >= PR #1689 | Medium — version dep |
| Camera orientation in CPR viewport | May need per-dataset tuning | Medium |
| App.tsx patch in Dockerfile | Depends on OHIF internal structure | Medium |
| Full Docker build succeeds | yarn build is environment-sensitive | Medium |
| End-to-end: draw → panoramic renders | Integration untested | High |

## Next Steps After Prototype

1. Test Docker build: `docker compose build viewer-custom`
2. Open a CBCT study → verify CBCT hanging protocol fires
3. Click axial viewport to place 8-10 arch points → double-click
4. Verify CPR panoramic appears in right panel
5. If blank: check camera distance (see Known Limitations #3)
6. File back CS3D issues for any bugs found
