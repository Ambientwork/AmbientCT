# Dental Tools OHIF Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom OHIF Docker image containing 3 working dental measurement tools (NerveCanalTool, ToothAnnotationTool, BoneThicknessTool) and 1 scaffold (ImplantPlanningTool) as an OHIF v3 extension.

**Architecture:** The project already has `Dockerfile.ohif` (for `dental-cpr` extension) and a root `package.json` with `workspaces: ["extensions/*", "modes/*"]`. Follow the exact same pattern: COPY extension → patch `platform/app/package.json` + `App.tsx` via Node.js scripts → `yarn install` → `yarn workspace @ohif/app run build`. A new `viewer-custom:` service is added to `docker-compose.yml` that uses the custom build, keeping the upstream `viewer:` service intact (opt-in swap).

**Tech Stack:** OHIF v3.9.2, Cornerstone3D v2.x (`@cornerstonejs/tools`), React 18, Node.js 20, Yarn 4.0.2 (corepack), nginx 1.27, Jest 29 (unit tests for pure-JS logic)

---

## Read First

Before starting, read these existing files to understand the established patterns:

- `Dockerfile.ohif` — existing build pattern (node:20-slim, corepack, App.tsx patching)
- `extensions/dental-cpr/package.json` — existing extension package.json pattern
- `docker-compose.yml` — existing services structure

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `docker-compose.yml` | Modify — add service | Add `viewer-custom:` service with build section |
| `extensions/dental-tools/package.json` | Create | Package metadata (`main: src/index.js`), Jest config |
| `extensions/dental-tools/src/index.js` | Create | OHIF extension entry: toolsModule, panelModule, toolbarModule |
| `extensions/dental-tools/src/utils/fdi.js` | Create | FDI 11–48 lookup table (pure data, no deps) |
| `extensions/dental-tools/src/utils/huSampling.js` | Create | HU sampling math (pure JS, Jest testable) |
| `extensions/dental-tools/src/tools/NerveCanalTool.js` | Create | Extends SplineROITool; open spline, length, safety margin |
| `extensions/dental-tools/src/tools/ToothAnnotationTool.js` | Create | Extends ArrowAnnotateTool; dispatches DENTAL_TOOTH_PICK event |
| `extensions/dental-tools/src/tools/BoneThicknessTool.js` | Create | Extends LengthTool; HU sampling along line |
| `extensions/dental-tools/src/tools/ImplantPlanningTool.js` | Create | Extends EllipticalROITool; Phase 5 scaffold |
| `extensions/dental-tools/src/panels/DentalToolsPanel.jsx` | Create | React panel: FDI picker, event listener |
| `extensions/dental-tools/tests/fdi.test.js` | Create | Jest unit tests for FDI lookup |
| `extensions/dental-tools/tests/boneThickness.test.js` | Create | Jest unit tests for HU sampling math |
| `extensions/dental-tools/README.md` | Create | What works, Phase 5+ table, build instructions |
| `.gitignore` | Modify | Add `extensions/dental-tools/node_modules/` |

---

## Task 1: docker-compose viewer-custom Service

**Files:**
- Modify: `docker-compose.yml`

### Background

The existing `Dockerfile.ohif` already targets `viewer-custom` (see its header comment). Add a `viewer-custom:` service that mirrors `viewer:` but uses the custom OHIF build. Users opt in by switching to this service. This preserves the upstream `viewer:` for users who do not need dental tools.

- [ ] **Step 1: Add `viewer-custom:` to `docker-compose.yml`**

Append after the `viewer:` service block (after line 88, before the `# nginx` comment block):

```yaml
  # ---------------------------------------------------------------------------
  # viewer-custom: OHIF built from source with dental tools extension.
  # Run `docker compose build viewer-custom` first (~10-15 min), then
  # replace 'viewer' with 'viewer-custom' in docker-compose.yml to use it.
  # ---------------------------------------------------------------------------
  viewer-custom:
    image: ambientct/ohif:latest
    build:
      context: .
      dockerfile: Dockerfile.ohif
    platform: linux/amd64
    container_name: ambientct-viewer-custom
    restart: unless-stopped
    mem_limit: ${VIEWER_MEM_LIMIT:-512m}
    cpus: ${VIEWER_CPUS:-1.0}
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    ports:
      - "127.0.0.1:${VIEWER_CUSTOM_PORT:-3001}:80"
    depends_on:
      orthanc:
        condition: service_healthy
    volumes:
      - ./config/ohif-config.js:/usr/share/nginx/html/app-config.js:ro
    tmpfs:
      - /tmp:noexec,nosuid,size=32m
      - /var/cache/nginx:noexec,nosuid,size=32m
      - /var/run:noexec,nosuid,size=1m
    networks:
      - pacs-net
    logging:
      driver: json-file
      options:
        max-size: "${LOG_MAX_SIZE:-10m}"
        max-file: "${LOG_MAX_FILE:-3}"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

Note: `VIEWER_CUSTOM_PORT` defaults to `3001` so it doesn't conflict with the upstream `viewer:` on `3000`. Set `VIEWER_MEM_LIMIT=512m` (custom build needs more memory for the larger bundle).

- [ ] **Step 2: Validate config**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
ORTHANC_PASSWORD=test docker compose config 2>&1 | grep -A3 "viewer-custom"
```

Expected: shows `viewer-custom` service with `image: ambientct/ohif:latest` and `build:` section.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(docker): add viewer-custom service for custom OHIF build with dental tools"
```

---

## Task 2: Extension Package + Entry Point

**Files:**
- Create: `extensions/dental-tools/package.json`
- Create: `extensions/dental-tools/src/index.js`

### Background

Follow the exact pattern from `extensions/dental-cpr/package.json`. The root `package.json` already declares `workspaces: ["extensions/*"]`, so yarn will auto-discover this package. The `main` field points to `src/index.js` (plain JS, not TypeScript — OHIF's webpack handles transpilation of workspace packages).

No pre-compile step is needed. `Dockerfile.ohif` patches `platform/app/package.json` and `App.tsx` to register the extension, then runs a single `yarn install && yarn workspace @ohif/app run build`.

JSX inside `src/index.js` is valid — OHIF's webpack configuration uses Babel with `@babel/preset-react` for all workspace packages, and `@babel/preset-react` with `"runtime": "automatic"` auto-imports React, so no explicit `import React` is needed.

- [ ] **Step 1: Create `extensions/dental-tools/package.json`**

```json
{
  "name": "@ambientct/extension-dental-tools",
  "version": "1.0.0",
  "description": "Dental measurement tools for AmbientCT: nerve canal, tooth annotation, bone thickness",
  "main": "src/index.js",
  "peerDependencies": {
    "@ohif/core": "^3.9.0",
    "@cornerstonejs/core": "^2.0.0",
    "@cornerstonejs/tools": "^2.0.0",
    "react": "^18.0.0"
  },
  "devDependencies": {
    "jest": "^29.0.0",
    "babel-jest": "^29.0.0",
    "@babel/core": "^7.23.0",
    "@babel/preset-env": "^7.23.0",
    "@babel/preset-react": "^7.22.0"
  },
  "jest": {
    "transform": {
      "^.+\\.(js|jsx)$": ["babel-jest", {
        "presets": [
          ["@babel/preset-env", { "targets": { "node": "20" } }],
          ["@babel/preset-react", { "runtime": "automatic" }]
        ]
      }]
    },
    "testEnvironment": "node"
  },
  "keywords": ["ohif", "dicom", "dental", "cbct", "implant", "fdi"],
  "license": "MIT"
}
```

- [ ] **Step 2: Create `extensions/dental-tools/src/index.js`**

```javascript
import NerveCanalTool from './tools/NerveCanalTool';
import ToothAnnotationTool from './tools/ToothAnnotationTool';
import BoneThicknessTool from './tools/BoneThicknessTool';
import ImplantPlanningTool from './tools/ImplantPlanningTool';
import DentalToolsPanel from './panels/DentalToolsPanel';

/**
 * AmbientCT Dental Tools Extension for OHIF v3
 *
 * Working tools:
 *   NerveCanalTool     — SplineROI-based nerve canal marking with safety margin
 *   ToothAnnotationTool — FDI 11-48 tooth annotations with finding codes
 *   BoneThicknessTool  — LengthTool + HU sampling for bone thickness estimate
 *
 * Phase 5 scaffolds:
 *   ImplantPlanningTool — EllipticalROI placeholder, 3D cylinder coming in Phase 5
 */
const DentalToolsExtension = {
  id: '@ambientct/extension-dental-tools',
  version: '1.0.0',

  /**
   * Registers Cornerstone3D tool classes.
   * Tool group membership and activation happen in the mode definition.
   */
  getToolsModule: () => ({
    tools: [
      { name: 'NerveCanalTool',      toolClass: NerveCanalTool },
      { name: 'ToothAnnotationTool', toolClass: ToothAnnotationTool },
      { name: 'BoneThicknessTool',   toolClass: BoneThicknessTool },
      { name: 'ImplantPlanningTool', toolClass: ImplantPlanningTool },
    ],
    toolGroups: [
      {
        id: 'default',
        tools: [
          { toolName: 'NerveCanalTool',      bindings: [{ mouseButton: 1 }] },
          { toolName: 'ToothAnnotationTool', bindings: [{ mouseButton: 1 }] },
          { toolName: 'BoneThicknessTool',   bindings: [{ mouseButton: 1 }] },
          { toolName: 'ImplantPlanningTool', bindings: [{ mouseButton: 1 }] },
        ],
      },
    ],
  }),

  /**
   * Registers the dental tools right sidebar panel.
   * Shows FDI picker after a ToothAnnotation is placed.
   */
  getPanelModule: ({ servicesManager }) => [
    {
      name: 'dentalTools',
      iconName: 'tab-patient-info',
      iconLabel: 'Dental',
      label: 'Dental Tools',
      secondaryLabel: 'Dental Tools',
      // JSX in .js works: OHIF webpack uses Babel with @babel/preset-react for workspaces.
      // @babel/preset-react with runtime:"automatic" auto-imports React — no explicit import needed.
      component: (props) => <DentalToolsPanel {...props} servicesManager={servicesManager} />,
    },
  ],

  /**
   * Toolbar buttons for dental tools.
   * Toolbar config belongs here — window.config (ohif-config.js) has no toolbarService key.
   */
  getToolbarModule: () => [
    {
      name: 'primary',
      defaultContext: 'CORNERSTONE',
      generator: {
        hasFallback: true,
        generate: () => [
          {
            id: 'NerveCanalTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Nervkanal',
              icon: 'tool-length',
              tooltip: 'Nervkanal markieren — N. alv. inf. mit Sicherheitsabstand',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'NerveCanalTool' } }],
            },
          },
          {
            id: 'ToothAnnotationTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Zahn FDI',
              icon: 'tool-annotate',
              tooltip: 'FDI-Zahn markieren (11–48) mit Befund',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'ToothAnnotationTool' } }],
            },
          },
          {
            id: 'BoneThicknessTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Knochen',
              icon: 'tool-bidirectional',
              tooltip: 'Knochendicke messen — Linie setzen, HU-Sampling',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'BoneThicknessTool' } }],
            },
          },
          {
            id: 'ImplantPlanningTool',
            uiType: 'ohif.toolbarButton',
            props: {
              label: 'Implantat',
              icon: 'tool-ellipse',
              tooltip: 'Implantat planen [Phase 5 — noch kein 3D-Zylinder]',
              commands: [{ commandName: 'setToolActive', commandOptions: { toolName: 'ImplantPlanningTool' } }],
            },
          },
        ],
      },
    },
  ],
};

export default DentalToolsExtension;
```

- [ ] **Step 3: Create placeholder stubs** so index.js imports resolve:

`extensions/dental-tools/src/tools/NerveCanalTool.js`:
```javascript
export default class NerveCanalTool {}
```

Same for `ToothAnnotationTool.js`, `BoneThicknessTool.js`, `ImplantPlanningTool.js`.

`extensions/dental-tools/src/panels/DentalToolsPanel.jsx`:
```jsx
export default function DentalToolsPanel() { return null; }
```

- [ ] **Step 4: Commit**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
git add extensions/dental-tools/
git commit -m "feat(dental-tools): add extension scaffold — package.json, index.js, tool stubs"
```

---

## Task 3: Update Dockerfile.ohif for dental-tools

**Files:**
- Modify: `Dockerfile.ohif`

### Background

The existing `Dockerfile.ohif` already handles `dental-cpr`. Add `dental-tools` to the same build by:
1. Adding a `COPY extensions/dental-tools/` line
2. Extending the `platform/app/package.json` patch to also add `@ambientct/extension-dental-tools`
3. Extending the `App.tsx` patch to also import and register `DentalToolsExtension`

- [ ] **Step 1: Read `Dockerfile.ohif` carefully** before editing (lines 36–110 contain the COPY + patch scripts)

- [ ] **Step 2: Add dental-tools COPY after dental-cpr COPY** (after line 37):

```dockerfile
COPY extensions/dental-tools/ extensions/dental-tools/
```

- [ ] **Step 3: Extend the `platform/app/package.json` patch** (the `node -e` script, lines 40–49).

Replace the `node -e` script with:

```dockerfile
RUN node -e "
const fs = require('fs');
const pkgPath = 'platform/app/package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies['@ambientwork/ohif-extension-dental-cpr'] = 'file:../../extensions/dental-cpr';
pkg.dependencies['@ambientwork/ohif-mode-dental-cpr'] = 'file:../../modes/dental-cpr-mode';
pkg.dependencies['@ambientct/extension-dental-tools'] = 'file:../../extensions/dental-tools';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log('[patch] Registered dental-cpr + dental-tools in platform/app/package.json');
"
```

- [ ] **Step 4: Extend the `App.tsx` patch** (the PATCH_SCRIPT heredoc, lines 53–110).

After the DentalCPRExtension import line (line 73–75), add DentalToolsExtension:

```javascript
const dentalImports = [
  "import DentalCPRExtension from '@ambientwork/ohif-extension-dental-cpr';",
  "import DentalCPRMode from '@ambientwork/ohif-mode-dental-cpr';",
  "import DentalToolsExtension from '@ambientct/extension-dental-tools';",
].join('\n');
```

And append `DentalToolsExtension` to the extensions array (after `DentalCPRExtension` in the array append logic):

```javascript
src = src.slice(0, arrayEnd) + ',\n    DentalCPRExtension,\n    DentalToolsExtension' + src.slice(arrayEnd);
```

- [ ] **Step 5: Verify Dockerfile syntax**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
docker build --no-cache -f Dockerfile.ohif . --target builder --progress=plain 2>&1 | head -30
```

Expected: first ~5 log lines show stage 1 starting. If Dockerfile syntax error: fix immediately.
Full build takes 10–15 min — run only in CI or explicitly.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile.ohif
git commit -m "feat(docker): add dental-tools extension to OHIF custom build"
```

---

## Task 4: FDI Utility + Tests

**Files:**
- Create: `extensions/dental-tools/src/utils/fdi.js`
- Create: `extensions/dental-tools/tests/fdi.test.js`

### Background

FDI (ISO 3950): first digit = quadrant (1=upper-right, 2=upper-left, 3=lower-left, 4=lower-right), second = position (1=central incisor → 8=wisdom tooth). All 4 files use `module.exports` for Jest compatibility.

- [ ] **Step 1: Write failing tests**

Create `extensions/dental-tools/tests/fdi.test.js`:
```javascript
const { getToothInfo, getAllTeeth, isValidFDI } = require('../src/utils/fdi');

test('isValidFDI rejects out-of-range', () => {
  expect(isValidFDI(10)).toBe(false);   // position 0
  expect(isValidFDI(49)).toBe(false);   // quadrant 4 position 9
  expect(isValidFDI(19)).toBe(false);   // position 9 does not exist
  expect(isValidFDI(0)).toBe(false);
});

test('isValidFDI accepts valid FDI numbers', () => {
  expect(isValidFDI(11)).toBe(true);
  expect(isValidFDI(48)).toBe(true);
  expect(isValidFDI(36)).toBe(true);
  expect(isValidFDI(28)).toBe(true);
});

test('getToothInfo returns correct data for 36', () => {
  const info = getToothInfo(36);
  expect(info.quadrant).toBe(3);
  expect(info.position).toBe(6);
  expect(info.name).toBe('Erster Molar');
  expect(info.jaw).toBe('lower');
  expect(info.side).toBe('left');
});

test('getAllTeeth returns 32 entries', () => {
  expect(getAllTeeth()).toHaveLength(32);
});

test('getAllTeeth has 8 teeth per quadrant', () => {
  const teeth = getAllTeeth();
  [1, 2, 3, 4].forEach(q => {
    expect(teeth.filter(t => t.quadrant === q)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw/extensions/dental-tools
npm install --save-dev jest babel-jest @babel/core @babel/preset-env @babel/preset-react 2>&1 | tail -3
npx jest tests/fdi.test.js 2>&1 | tail -8
```

Expected: `Cannot find module '../src/utils/fdi'`

- [ ] **Step 3: Implement `src/utils/fdi.js`**

```javascript
/**
 * FDI World Dental Federation tooth numbering (ISO 3950).
 * Two digits: quadrant (1-4) × position (1-8).
 * Quadrants: 1=upper-right, 2=upper-left, 3=lower-left, 4=lower-right
 * Positions: 1=central incisor … 8=wisdom tooth
 */

const POSITION_NAMES = {
  1: 'Mittlerer Schneidezahn',
  2: 'Seitlicher Schneidezahn',
  3: 'Eckzahn',
  4: 'Erster Prämolar',
  5: 'Zweiter Prämolar',
  6: 'Erster Molar',
  7: 'Zweiter Molar',
  8: 'Weisheitszahn',
};

const QUADRANT_META = {
  1: { jaw: 'upper', side: 'right', label: 'Oben rechts' },
  2: { jaw: 'upper', side: 'left',  label: 'Oben links'  },
  3: { jaw: 'lower', side: 'left',  label: 'Unten links' },
  4: { jaw: 'lower', side: 'right', label: 'Unten rechts'},
};

function isValidFDI(fdi) {
  const q = Math.floor(fdi / 10);
  const p = fdi % 10;
  return q >= 1 && q <= 4 && p >= 1 && p <= 8;
}

function getToothInfo(fdi) {
  if (!isValidFDI(fdi)) return null;
  const quadrant = Math.floor(fdi / 10);
  const position = fdi % 10;
  const { jaw, side, label: quadrantLabel } = QUADRANT_META[quadrant];
  return {
    fdi, quadrant, position,
    name: POSITION_NAMES[position],
    jaw, side, quadrantLabel,
    label: `${fdi} — ${POSITION_NAMES[position]}`,
  };
}

function getAllTeeth() {
  const teeth = [];
  for (const q of [1, 2, 3, 4]) {
    for (let p = 1; p <= 8; p++) {
      teeth.push(getToothInfo(q * 10 + p));
    }
  }
  return teeth;
}

module.exports = { isValidFDI, getToothInfo, getAllTeeth, POSITION_NAMES, QUADRANT_META };
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/fdi.test.js 2>&1 | tail -5
```

Expected: `Tests: 5 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
git add extensions/dental-tools/src/utils/fdi.js extensions/dental-tools/tests/fdi.test.js
git commit -m "feat(dental-tools): add FDI tooth numbering utility with 5 passing tests"
```

---

## Task 5: NerveCanalTool

**Files:**
- Create: `extensions/dental-tools/src/tools/NerveCanalTool.js` (replaces stub)

### Background

`SplineROITool` draws a CatmullRom spline through clicked points with total length. Set `closed: false` for an open canal path (not a closed polygon). Safety margin requires scanning for `ImplantPlanningTool` annotations on the same viewport element.

- [ ] **Step 1: Implement `src/tools/NerveCanalTool.js`**

```javascript
import { SplineROITool, annotation } from '@cornerstonejs/tools';

// Safety margin thresholds (mm)
const MARGIN_GREEN  = 2.0;
const MARGIN_ORANGE = 1.0;

/**
 * NerveCanalTool
 *
 * Marks the Nervus alveolaris inferior on axial CBCT slices.
 * Extends SplineROITool (CatmullRom, open path — not PlanarFreehandROITool
 * which draws closed polygons and computes area, not length).
 *
 * Features:
 *   - Open spline path with total length label
 *   - Color-coded dashed line to nearest ImplantPlanningTool annotation:
 *       green ≥2mm, orange 1–2mm, red <1mm
 *
 * Phase 5+: 3D canal tracing across axial slices, CPR rendering
 */
class NerveCanalTool extends SplineROITool {
  static toolName = 'NerveCanalTool';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super(
      {
        ...toolProps,
        configuration: {
          splineType: 'CatmullRomSpline',
          closed: false,
          ...toolProps.configuration,
        },
      },
      defaultToolProps
    );
  }

  renderAnnotation(enabledElement, svgDrawingHelper) {
    super.renderAnnotation(enabledElement, svgDrawingHelper);

    const { element, viewport } = enabledElement;

    const canalAnnotations = annotation.state.getAnnotations(
      NerveCanalTool.toolName, element
    ) || [];
    const implantAnnotations = annotation.state.getAnnotations(
      'ImplantPlanningTool', element
    ) || [];

    if (implantAnnotations.length === 0) return;

    canalAnnotations.forEach(canalAnn => {
      const canalPoints = canalAnn.data?.contour?.polyline || [];
      if (!canalPoints.length) return;

      implantAnnotations.forEach(implantAnn => {
        const implantCenter = implantAnn.data?.handles?.points?.[0];
        if (!implantCenter) return;

        // Find nearest canal point
        let minDist = Infinity;
        let nearestPt = canalPoints[0];
        canalPoints.forEach(pt => {
          const dx = pt[0] - implantCenter[0];
          const dy = pt[1] - implantCenter[1];
          const dz = pt[2] - implantCenter[2];
          const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (d < minDist) { minDist = d; nearestPt = pt; }
        });

        const color = minDist >= MARGIN_GREEN  ? 'rgb(0,220,80)'
                    : minDist >= MARGIN_ORANGE ? 'rgb(255,165,0)'
                    : 'rgb(255,40,40)';

        const from = viewport.worldToCanvas(nearestPt);
        const to   = viewport.worldToCanvas(implantCenter);
        const uid  = `nc-${canalAnn.annotationUID}-${implantAnn.annotationUID}`;

        svgDrawingHelper.drawLine('NerveCanalTool', uid, from, to, {
          color, lineWidth: 1.5, lineDash: [4, 4],
        });

        svgDrawingHelper.drawTextBox(
          'NerveCanalTool', `${uid}-lbl`,
          [(from[0] + to[0]) / 2 + 4, (from[1] + to[1]) / 2],
          [`${minDist.toFixed(1)} mm`],
          { color, fontSize: 12 }
        );
      });
    });
  }
}

export default NerveCanalTool;
```

- [ ] **Step 2: Commit**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
git add extensions/dental-tools/src/tools/NerveCanalTool.js
git commit -m "feat(dental-tools): implement NerveCanalTool — SplineROI + safety margin color coding"
```

---

## Task 6: ToothAnnotationTool + DentalToolsPanel

**Files:**
- Create: `extensions/dental-tools/src/tools/ToothAnnotationTool.js` (replaces stub)
- Create: `extensions/dental-tools/src/panels/DentalToolsPanel.jsx` (replaces stub)

### Background

⚠️ Import is `ArrowAnnotateTool`, NOT `ArrowAnnotationTool`. Using the wrong name causes a silent runtime failure.

The tool–React bridge: tool dispatches `CustomEvent('DENTAL_TOOTH_PICK')` on Cornerstone3D's `eventTarget` → `DentalToolsPanel` listens → calls `UIDialogService` or renders inline FDI picker → writes back to annotation data via `annotation.state.getAnnotation()` → calls `triggerAnnotationModified()`.

FDI anatomical grid order (facing patient): upper-right Q1, upper-left Q2 (top row), lower-left Q3, lower-right Q4 (bottom row). Both rows mirror left-right from the patient's perspective.

- [ ] **Step 1: Implement `src/tools/ToothAnnotationTool.js`**

```javascript
import { ArrowAnnotateTool, annotation, triggerAnnotationModified, eventTarget } from '@cornerstonejs/tools';

// Note: ArrowAnnotateTool (no "ion") — the correct Cornerstone3D class name.
// import { ArrowAnnotationTool } from '@cornerstonejs/tools'  ← WRONG, will fail silently.

export const DENTAL_TOOTH_PICK_EVENT = 'DENTAL_TOOTH_PICK';

const FINDING_COLORS = {
  none:      'rgb(255,255,255)',
  caries:    'rgb(255,220,0)',
  crown:     'rgb(180,100,255)',
  implant:   'rgb(60,160,255)',
  missing:   'rgb(150,150,150)',
  rootCanal: 'rgb(255,80,80)',
};

class ToothAnnotationTool extends ArrowAnnotateTool {
  static toolName = 'ToothAnnotationTool';

  mouseUpCallback(evt) {
    super.mouseUpCallback(evt);

    const { element } = evt.detail;
    const annotations = annotation.state.getAnnotations(
      ToothAnnotationTool.toolName, element
    ) || [];
    if (!annotations.length) return;

    const latest = annotations[annotations.length - 1];

    // Fire event — DentalToolsPanel listens and shows the FDI picker
    eventTarget.dispatchEvent(
      new CustomEvent(DENTAL_TOOTH_PICK_EVENT, {
        bubbles: true,
        detail: {
          annotationUID: latest.annotationUID,
          canvasPos: evt.detail.currentPoints?.canvas || [0, 0],
          element,
        },
      })
    );
  }

  getLinkedTextBoxStyle(settings, ann) {
    const finding = ann.data?.finding || 'none';
    const color = FINDING_COLORS[finding] ?? FINDING_COLORS.none;
    return { ...super.getLinkedTextBoxStyle(settings, ann), color };
  }
}

export default ToothAnnotationTool;
```

- [ ] **Step 2: Implement `src/panels/DentalToolsPanel.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import { annotation, triggerAnnotationModified, eventTarget } from '@cornerstonejs/tools';
import { DENTAL_TOOTH_PICK_EVENT } from '../tools/ToothAnnotationTool';
import { getAllTeeth } from '../utils/fdi';

const FINDINGS = [
  { value: 'none',      label: 'Kein Befund' },
  { value: 'caries',    label: 'Karies'      },
  { value: 'crown',     label: 'Krone'       },
  { value: 'implant',   label: 'Implantat'   },
  { value: 'missing',   label: 'Fehlend'     },
  { value: 'rootCanal', label: 'WK-Behandlung'},
];

const ALL_TEETH = getAllTeeth();

export default function DentalToolsPanel({ servicesManager }) {
  const [pending, setPending] = useState(null);
  const [selectedTooth, setSelectedTooth] = useState(null);
  const [finding, setFinding] = useState('none');

  useEffect(() => {
    const handler = (evt) => {
      setPending(evt.detail);
      setSelectedTooth(null);
      setFinding('none');
    };
    eventTarget.addEventListener(DENTAL_TOOTH_PICK_EVENT, handler);
    return () => eventTarget.removeEventListener(DENTAL_TOOTH_PICK_EVENT, handler);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!pending || !selectedTooth) return;

    const ann = annotation.state.getAnnotation(pending.annotationUID);
    if (!ann) return;

    const findingLabel = FINDINGS.find(f => f.value === finding)?.label ?? '';
    const suffix = finding !== 'none' ? ` [${findingLabel.substring(0, 5).trimEnd()}]` : '';

    ann.data.toothNumber = selectedTooth.fdi;
    ann.data.finding = finding;
    ann.data.text = `${selectedTooth.fdi}${suffix}`;

    triggerAnnotationModified(ann, pending.element);
    setPending(null);
  }, [pending, selectedTooth, finding]);

  // FDI anatomical grid (patient view): Q1 Q2 top row, Q3 Q4 bottom row.
  // Within each row: Q1 right-to-left (tooth 18→11), Q2 left-to-right (21→28).
  // Lower: Q3 right-to-left facing patient (38→31), Q4 left-to-right (41→48).
  const renderGrid = () => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      {[1, 2, 3, 4].map(q => {
        // Anatomical order: Q1/Q3 are on patient's right (rendered right-to-left on screen)
        const teethInQ = ALL_TEETH.filter(t => t.quadrant === q);
        const orderedTeeth = (q === 1 || q === 4)
          ? [...teethInQ].reverse()  // patient's right → screen left
          : teethInQ;
        const meta = ALL_TEETH.find(t => t.quadrant === q);
        return (
          <div key={q}>
            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>
              {meta?.quadrantLabel}
            </div>
            <div style={{ display: 'flex', gap: 2 }}>
              {orderedTeeth.map(tooth => (
                <button
                  key={tooth.fdi}
                  onClick={() => setSelectedTooth(tooth)}
                  title={tooth.label}
                  style={{
                    width: 26, height: 26, fontSize: 9, padding: 0,
                    background: selectedTooth?.fdi === tooth.fdi ? '#2563eb' : '#1e293b',
                    color: selectedTooth?.fdi === tooth.fdi ? '#fff' : '#94a3b8',
                    border: '1px solid #334155', borderRadius: 3, cursor: 'pointer',
                  }}
                >
                  {tooth.fdi}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (!pending) {
    return (
      <div style={{ padding: 12, color: '#94a3b8', fontSize: 12 }}>
        <strong style={{ color: '#e2e8f0' }}>Dental Tools</strong>
        <p style={{ marginTop: 8 }}>Zahn-Annotation setzen → FDI-Picker erscheint hier.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      <h3 style={{ color: '#e2e8f0', fontSize: 13, marginBottom: 10 }}>Zahn (FDI)</h3>
      {renderGrid()}
      <div style={{ marginTop: 10 }}>
        <label style={{ color: '#94a3b8', fontSize: 11 }}>Befund: </label>
        <select
          value={finding}
          onChange={e => setFinding(e.target.value)}
          style={{
            marginLeft: 6, background: '#1e293b', color: '#e2e8f0',
            border: '1px solid #334155', padding: '2px 6px', fontSize: 11,
          }}
        >
          {FINDINGS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>
      {selectedTooth && (
        <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 11 }}>
          {selectedTooth.label}
        </div>
      )}
      <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
        <button
          onClick={handleConfirm}
          disabled={!selectedTooth}
          style={{
            padding: '5px 14px', fontSize: 12,
            background: selectedTooth ? '#2563eb' : '#334155',
            color: '#fff', border: 'none', borderRadius: 4,
            cursor: selectedTooth ? 'pointer' : 'default',
          }}
        >
          Bestätigen
        </button>
        <button
          onClick={() => setPending(null)}
          style={{
            padding: '5px 10px', fontSize: 12,
            background: 'transparent', color: '#94a3b8',
            border: '1px solid #334155', borderRadius: 4, cursor: 'pointer',
          }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
git add extensions/dental-tools/src/tools/ToothAnnotationTool.js \
        extensions/dental-tools/src/panels/DentalToolsPanel.jsx
git commit -m "feat(dental-tools): implement ToothAnnotationTool (ArrowAnnotateTool) + FDI picker panel"
```

---

## Task 7: BoneThicknessTool + Tests

**Files:**
- Create: `extensions/dental-tools/src/utils/huSampling.js`
- Create: `extensions/dental-tools/tests/boneThickness.test.js`
- Create: `extensions/dental-tools/src/tools/BoneThicknessTool.js` (replaces stub)

- [ ] **Step 1: Write failing tests**

Create `extensions/dental-tools/tests/boneThickness.test.js`:
```javascript
const { samplePoints, estimateBoneThickness } = require('../src/utils/huSampling');

test('samplePoints produces N equidistant points', () => {
  const pts = samplePoints([0,0,0], [10,0,0], 11);
  expect(pts).toHaveLength(11);
  expect(pts[0]).toEqual([0,0,0]);
  expect(pts[5][0]).toBeCloseTo(5);
  expect(pts[10]).toEqual([10,0,0]);
});

test('estimateBoneThickness counts points above threshold', () => {
  const huValues = [200, 500, 300, 600, 100, 450, 150, 700, 250, 800];
  const result = estimateBoneThickness(huValues, 20, 400);
  // 5 of 10 values > 400 → 50% → 10mm bone
  expect(result.boneThicknessMm).toBeCloseTo(10.0, 1);
  expect(result.totalLengthMm).toBe(20);
  expect(result.bonePercent).toBeCloseTo(50, 0);
});

test('estimateBoneThickness returns 0 when all below threshold', () => {
  const result = estimateBoneThickness([100, 200, 300], 15, 400);
  expect(result.boneThicknessMm).toBe(0);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw/extensions/dental-tools
npx jest tests/boneThickness.test.js 2>&1 | tail -5
```

Expected: `Cannot find module '../src/utils/huSampling'`

- [ ] **Step 3: Implement `src/utils/huSampling.js`**

```javascript
/**
 * Pure HU sampling utilities — no Cornerstone3D dependencies.
 * Used by BoneThicknessTool and testable in Jest.
 */

/**
 * Returns N equidistant 3D world-space points along a line from start to end.
 */
function samplePoints(start, end, n) {
  if (n < 2) return [start.slice()];
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [
      start[0] + t * (end[0] - start[0]),
      start[1] + t * (end[1] - start[1]),
      start[2] + t * (end[2] - start[2]),
    ];
  });
}

/**
 * Estimates bone thickness from sampled HU values.
 * @param {number[]} huValues      - HU values at equidistant sample points
 * @param {number}   totalLengthMm - mm distance between the two endpoints
 * @param {number}   threshold     - HU threshold for bone (default 400 = cortical)
 */
function estimateBoneThickness(huValues, totalLengthMm, threshold = 400) {
  const boneCount = huValues.filter(hu => hu > threshold).length;
  const bonePercent = (boneCount / huValues.length) * 100;
  const boneThicknessMm = (bonePercent / 100) * totalLengthMm;
  return { boneThicknessMm, totalLengthMm, bonePercent };
}

module.exports = { samplePoints, estimateBoneThickness };
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx jest tests/boneThickness.test.js 2>&1 | tail -5
```

Expected: `Tests: 3 passed`

- [ ] **Step 5: Implement `src/tools/BoneThicknessTool.js`**

```javascript
import { LengthTool, annotation } from '@cornerstonejs/tools';
import { cache } from '@cornerstonejs/core';
import { samplePoints, estimateBoneThickness } from '../utils/huSampling';

const NUM_SAMPLES = 20;
const BONE_HU_THRESHOLD = 400;

/**
 * BoneThicknessTool
 *
 * Extends LengthTool. User places two endpoints. After placement, samples
 * HU values along the line from the loaded CT volume and estimates bone
 * thickness as the fraction of points above HU 400.
 *
 * Label: "12.4 mm gesamt | ~7.2 mm Knochen (HU>400)"
 *
 * Only works in volume viewports (requires a loaded volume in cache).
 * On stack viewports or when volumeId is unavailable, falls back to
 * standard LengthTool label with a note "(HU: nur Volume-Viewport)".
 *
 * Phase 5+: automatic perpendicular-to-surface measurement via HU gradient.
 */
class BoneThicknessTool extends LengthTool {
  static toolName = 'BoneThicknessTool';

  mouseUpCallback(evt) {
    super.mouseUpCallback(evt);
    this._computeBoneThickness(evt.detail.element);
  }

  _computeBoneThickness(element) {
    const annotations = annotation.state.getAnnotations(
      BoneThicknessTool.toolName, element
    ) || [];
    if (!annotations.length) return;

    const ann = annotations[annotations.length - 1];
    const points = ann.data?.handles?.points;
    if (!points || points.length < 2) return;

    const [start, end] = points;

    // volumeId is stored in annotation metadata for volume viewports
    const volumeId = ann.metadata?.volumeId;
    if (!volumeId) {
      console.info('[BoneThicknessTool] No volumeId — stack viewport, HU sampling skipped');
      ann.data._boneLabel = '(HU-Sampling: nur Volume-Viewport)';
      return;
    }

    const volume = cache.getVolume(volumeId);
    if (!volume?.imageData) {
      ann.data._boneLabel = '(Volume nicht geladen)';
      return;
    }

    const pts = samplePoints(start, end, NUM_SAMPLES);
    const huValues = pts.map(pt => {
      try { return volume.imageData.getScalarValueFromWorld(pt) ?? -1000; }
      catch { return -1000; }
    });

    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dz = end[2] - start[2];
    const totalLengthMm = Math.sqrt(dx*dx + dy*dy + dz*dz);

    const { boneThicknessMm } = estimateBoneThickness(huValues, totalLengthMm, BONE_HU_THRESHOLD);

    ann.data._boneLabel =
      `${totalLengthMm.toFixed(1)} mm gesamt | ~${boneThicknessMm.toFixed(1)} mm Knochen (HU>${BONE_HU_THRESHOLD})`;
  }

  // Note: correct two-argument signature — pass targetId to super for proper fallback
  getTextLines(data, targetId) {
    if (data?._boneLabel) return [data._boneLabel];
    return super.getTextLines(data, targetId);
  }
}

export default BoneThicknessTool;
```

- [ ] **Step 6: Run all tests**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw/extensions/dental-tools
npx jest 2>&1 | tail -5
```

Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 7: Commit**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
git add extensions/dental-tools/src/tools/BoneThicknessTool.js \
        extensions/dental-tools/src/utils/huSampling.js \
        extensions/dental-tools/tests/boneThickness.test.js
git commit -m "feat(dental-tools): implement BoneThicknessTool — LengthTool + HU sampling (8 tests passing)"
```

---

## Task 8: ImplantPlanningTool Scaffold + README + .gitignore

**Files:**
- Create: `extensions/dental-tools/src/tools/ImplantPlanningTool.js` (replaces stub)
- Create: `extensions/dental-tools/README.md`
- Modify: `.gitignore`

- [ ] **Step 1: Implement `src/tools/ImplantPlanningTool.js`**

```javascript
import { EllipticalROITool } from '@cornerstonejs/tools';

/**
 * ImplantPlanningTool — Phase 5 Scaffold
 *
 * Extends EllipticalROITool to represent an implant cross-section.
 * v1: renders as a labeled circle (diameter visible as ellipse axes).
 *
 * Phase 5+ requires:
 *   - 3D cylinder via viewport.addActor(vtkCylinderSource)
 *   - Rotation handles in all three MPR planes
 *   - Diameter/length persistence via DICOM SR
 *
 * TODO Phase 5: see vtk.js vtkCylinderSource + Cornerstone3D viewport.addActor() API
 */
class ImplantPlanningTool extends EllipticalROITool {
  static toolName = 'ImplantPlanningTool';

  constructor(toolProps = {}, defaultToolProps = {}) {
    super({
      ...toolProps,
      configuration: {
        implantDiameter: 3.5,
        implantLength: 10.0,
        ...toolProps.configuration,
      },
    }, defaultToolProps);
  }

  getTextLines(data, targetId) {
    const { implantDiameter, implantLength } = this.configuration;
    return [
      `Impl. \u00d8${implantDiameter}mm \u00d7 ${implantLength}mm`,
      '[Phase 5 \u2014 kein 3D-Zylinder]',
    ];
  }
}

export default ImplantPlanningTool;
```

- [ ] **Step 2: Create `extensions/dental-tools/README.md`**

```markdown
# @ambientct/extension-dental-tools

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

## Key Architecture Notes

- **`ArrowAnnotateTool`** — correct class name (not `ArrowAnnotationTool`, which does not exist)
- **Toolbar buttons** in `getToolbarModule()` in `src/index.js` — not in `ohif-config.js`
- **`pluginConfig.json`** uses `{ "packageName": "..." }` objects — bare strings are ignored in OHIF 3.9.x
- **BoneThicknessTool** requires a volume viewport — silently falls back on stack viewports
- **FDI picker bridge**: tool fires `CustomEvent('DENTAL_TOOTH_PICK')` → `DentalToolsPanel` listens → writes back via `annotation.state.getAnnotation()` + `triggerAnnotationModified()`
```

- [ ] **Step 3: Add `dist/` to `.gitignore`**

Append to `.gitignore` in project root:
```
# Extension compiled output
extensions/dental-tools/node_modules/
extensions/dental-tools/dist/
```

- [ ] **Step 4: Final test run**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw/extensions/dental-tools
npx jest 2>&1 | tail -5
```

Expected: `Tests: 8 passed, 8 total`

- [ ] **Step 5: Final commit**

```bash
cd /Users/john/conductor/workspaces/AmbientCT/warsaw
git add extensions/dental-tools/src/tools/ImplantPlanningTool.js \
        extensions/dental-tools/README.md \
        .gitignore
git commit -m "feat(dental-tools): add ImplantPlanningTool scaffold + README + Phase 5+ table"
```

---

## Verification Checklist

Run after all tasks complete:

- [ ] `npx jest` in `extensions/dental-tools/` passes (8 tests)
- [ ] `ORTHANC_PASSWORD=test docker compose config` no errors
- [ ] `docker compose build viewer-custom` completes (~10–15 min)
- [ ] `docker compose up -d viewer-custom orthanc` starts successfully
- [ ] http://localhost:3001 loads OHIF
- [ ] Dental toolbar buttons visible: Nervkanal, Zahn FDI, Knochen, Implantat
- [ ] **NerveCanalTool**: spline draws on axial CBCT, length label shown
- [ ] **ToothAnnotationTool**: arrow placed → FDI grid appears in right panel → confirm sets label
- [ ] **BoneThicknessTool**: line placed on CBCT → `X mm gesamt | ~Y mm Knochen (HU>400)` shown
- [ ] **ImplantPlanningTool**: circle drawn → `Impl. ⌀3.5mm × 10mm [Phase 5]` label shown
- [ ] NerveCanalTool + ImplantPlanningTool on same slice → colored dashed line appears
