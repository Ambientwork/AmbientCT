#!/usr/bin/env node
/**
 * compile-extensions.js
 *
 * Pre-compiles AmbientCT dental extensions (JSX/TSX → plain JS)
 * using @babel/core from OHIF's node_modules, so OHIF's webpack does
 * not need to transpile workspace packages.
 *
 * Run AFTER yarn install, BEFORE yarn workspace @ohif/app run build.
 * When run via Docker (copied to /tmp), cwd is WORKDIR = /build/ohif
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const cwd = process.cwd(); // /build/ohif

// Load @babel/core and presets from OHIF's hoisted node_modules
let babel;
try {
  babel = require(path.join(cwd, 'node_modules/@babel/core'));
} catch (e) {
  console.error('[compile-extensions] FATAL: @babel/core not found in', path.join(cwd, 'node_modules'));
  process.exit(1);
}

function resolvePreset(name) {
  return require.resolve(path.join(cwd, 'node_modules', name));
}

const presetEnv        = resolvePreset('@babel/preset-env');
const presetReact      = resolvePreset('@babel/preset-react');
const presetTypeScript = resolvePreset('@babel/preset-typescript');

// modules: false → keep ESM import/export so webpack resolves packages correctly.
// Without this, preset-env converts import→require() which breaks packages
// that have ESM-only "exports" fields (e.g. @cornerstonejs/tools).
const ENV_OPTS = { targets: { esmodules: true }, modules: false };

/**
 * Recursively gather all source files matching the given extensions.
 */
function gatherFiles(dir, exts, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      gatherFiles(full, exts, files);
    } else if (exts.some(e => entry.name.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

const extensions = [
  {
    name: 'dental-tools',
    src:  path.join(cwd, 'extensions/dental-tools/src'),
    dist: path.join(cwd, 'extensions/dental-tools/dist'),
    pkg:  path.join(cwd, 'extensions/dental-tools/package.json'),
    exts: ['.js', '.jsx'],
    presets: [[presetEnv, ENV_OPTS], [presetReact, { runtime: 'automatic' }]],
    mainEntry: 'index.jsx',
  },
  {
    name: 'dental-cpr',
    src:  path.join(cwd, 'extensions/dental-cpr/src'),
    dist: path.join(cwd, 'extensions/dental-cpr/dist'),
    pkg:  path.join(cwd, 'extensions/dental-cpr/package.json'),
    exts: ['.js', '.jsx', '.ts', '.tsx'],
    presets: [[presetEnv, ENV_OPTS], [presetReact, { runtime: 'automatic' }], presetTypeScript],
    mainEntry: 'index.ts',
  },
  {
    name: 'dental-cpr-mode',
    src:  path.join(cwd, 'modes/dental-cpr-mode/src'),
    dist: path.join(cwd, 'modes/dental-cpr-mode/dist'),
    pkg:  path.join(cwd, 'modes/dental-cpr-mode/package.json'),
    exts: ['.js', '.jsx', '.ts', '.tsx'],
    presets: [[presetEnv, ENV_OPTS], [presetReact, { runtime: 'automatic' }], presetTypeScript],
    mainEntry: 'index.ts',
  },
];

let allOk = true;

for (const ext of extensions) {
  if (!fs.existsSync(ext.src)) {
    console.warn(`[compile-extensions] ${ext.name}: src not found — skipping`);
    continue;
  }

  const files = gatherFiles(ext.src, ext.exts);
  console.log(`[compile-extensions] ${ext.name}: compiling ${files.length} file(s)...`);

  let extOk = true;
  for (const file of files) {
    const rel      = path.relative(ext.src, file);
    // Output as .js regardless of input extension
    const outRel   = rel.replace(/\.(jsx?|tsx?)$/, '.js');
    const outFile  = path.join(ext.dist, outRel);

    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    try {
      const result = babel.transformFileSync(file, {
        filename: file,
        presets: ext.presets,
        plugins: [],
        configFile: false,
        babelrc: false,
        sourceMaps: false,
      });
      fs.writeFileSync(outFile, result.code);
    } catch (err) {
      console.error(`[compile-extensions] ${ext.name}: failed on ${rel} — ${err.message}`);
      extOk = false;
      allOk = false;
      break; // stop on first error per extension
    }
  }

  if (extOk) {
    // Update package.json main to point to compiled output (always index.js)
    const pkg = JSON.parse(fs.readFileSync(ext.pkg, 'utf8'));
    const newMain = 'dist/index.js';
    if (pkg.main !== newMain) {
      pkg.main = newMain;
      fs.writeFileSync(ext.pkg, JSON.stringify(pkg, null, 2) + '\n');
      console.log(`[compile-extensions] ${ext.name}: package.json main → ${newMain}`);
    }
    console.log(`[compile-extensions] ${ext.name}: OK`);
  }
}

if (!allOk) {
  process.exit(1);
}
console.log('[compile-extensions] All extensions compiled successfully');
