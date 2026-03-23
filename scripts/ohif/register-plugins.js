#!/usr/bin/env node
/**
 * register-plugins.js
 *
 * Two-step OHIF v3 extension registration (idempotent):
 *
 * Step A: Modify platform/app/pluginConfig.json
 *   The official OHIF v3 way. When the build runs `generate-plugin-config`,
 *   this JSON is used to generate the extension import list automatically.
 *
 * Step B: Patch platform/app/src/App.tsx
 *   Fallback for OHIF versions where the pluginConfig.json generate step
 *   does not auto-run. Uses anchor-based insertion (not line numbers) so
 *   it survives minor App.tsx refactors.
 *
 * Step B is non-fatal when Step A succeeds — pluginConfig.json is the
 * primary registration path for OHIF v3.9+.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ── Step A: pluginConfig.json ─────────────────────────────────────────────────

// When run via Docker (copied to /tmp), cwd is WORKDIR = /build/ohif
const PLUGIN_CFG = path.resolve(process.cwd(), 'platform/app/pluginConfig.json');

let stepAOk = false;

if (fs.existsSync(PLUGIN_CFG)) {
  const cfg = JSON.parse(fs.readFileSync(PLUGIN_CFG, 'utf8'));

  const wantExtensions = [
    { packageName: '@ambientwork/ohif-extension-dental-cpr' },
    { packageName: '@ambientwork/ohif-extension-dental-tools' },
  ];
  const wantModes = [
    { packageName: '@ambientwork/ohif-mode-dental-cpr' },
  ];

  const extNames = new Set((cfg.extensions || []).map(e => e.packageName));
  const modeNames = new Set((cfg.modes || []).map(m => m.packageName));

  let changed = false;
  for (const ext of wantExtensions) {
    if (!extNames.has(ext.packageName)) {
      cfg.extensions = [...(cfg.extensions || []), ext];
      changed = true;
    }
  }
  for (const mode of wantModes) {
    if (!modeNames.has(mode.packageName)) {
      cfg.modes = [...(cfg.modes || []), mode];
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(PLUGIN_CFG, JSON.stringify(cfg, null, 2) + '\n');
    console.log('[register-plugins] Updated pluginConfig.json');
  } else {
    console.log('[register-plugins] pluginConfig.json already up to date');
  }
  stepAOk = true;
} else {
  console.warn('[register-plugins] pluginConfig.json not found — skipping Step A');
}

// If Step A succeeded, Step B is a fallback — failures are warnings, not fatal.
// If Step A failed (no pluginConfig.json), Step B is the only path and is fatal.
const stepBFatal = !stepAOk;

// ── Step B: App.tsx patch ─────────────────────────────────────────────────────

const APP_TSX = path.resolve(process.cwd(), 'platform/app/src/App.tsx');

if (!fs.existsSync(APP_TSX)) {
  const msg = `[register-plugins] App.tsx not found at ${APP_TSX}`;
  if (stepBFatal) { console.error(msg); process.exit(1); }
  console.warn(msg + ' — skipping Step B (pluginConfig.json registration is active)');
  process.exit(0);
}

let src = fs.readFileSync(APP_TSX, 'utf8');

// Already patched?
if (src.includes('@ambientwork/ohif-extension-dental-cpr')) {
  console.log('[register-plugins] App.tsx already patched — skipping Step B');
  process.exit(0);
}

// ── Insert import statements after the last @ohif/extension-* import ──────────
const importAnchor = src.lastIndexOf("from '@ohif/extension-");
if (importAnchor === -1) {
  const msg = '[register-plugins] No @ohif/extension-* import found in App.tsx — skipping Step B';
  if (stepBFatal) { console.error('[register-plugins] FATAL: ' + msg.split('— ')[1]); process.exit(1); }
  console.warn(msg + ' (pluginConfig.json registration is active)');
  process.exit(0);
}
const importLineEnd = src.indexOf('\n', importAnchor);

const dentalImports = [
  "import DentalCPRExtension from '@ambientwork/ohif-extension-dental-cpr';",
  "import DentalCPRMode from '@ambientwork/ohif-mode-dental-cpr';",
  "import DentalToolsExtension from '@ambientwork/ohif-extension-dental-tools';",
].join('\n');

src =
  src.slice(0, importLineEnd + 1) +
  dentalImports + '\n' +
  src.slice(importLineEnd + 1);

// ── Append to extensions array ────────────────────────────────────────────────
const knownExt = src.indexOf('OHIFDefaultExtension');
if (knownExt === -1) {
  const msg = '[register-plugins] Could not locate extensions array in App.tsx — skipping Step B';
  if (stepBFatal) { console.error('[register-plugins] FATAL: ' + msg.split('— ')[1]); process.exit(1); }
  console.warn(msg + ' (pluginConfig.json registration is active)');
  process.exit(0);
}
const extArrayEnd = src.indexOf(']', knownExt);
src =
  src.slice(0, extArrayEnd) +
  ',\n    DentalCPRExtension,\n    DentalToolsExtension' +
  src.slice(extArrayEnd);

// ── Append to modes array ─────────────────────────────────────────────────────
const knownMode =
  src.indexOf('longitudinalTimePointMode') !== -1
    ? src.indexOf('longitudinalTimePointMode')
    : src.indexOf('OHIFDicomTagBrowserMode');

if (knownMode !== -1) {
  const modeArrayEnd = src.indexOf(']', knownMode);
  src =
    src.slice(0, modeArrayEnd) +
    ',\n    DentalCPRMode' +
    src.slice(modeArrayEnd);
} else {
  console.warn('[register-plugins] WARNING: Could not locate modes array — DentalCPRMode not registered via App.tsx');
}

fs.writeFileSync(APP_TSX, src);
console.log('[register-plugins] App.tsx patched successfully');
