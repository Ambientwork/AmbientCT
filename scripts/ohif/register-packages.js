#!/usr/bin/env node
/**
 * register-packages.js
 *
 * Adds AmbientCT dental extensions as file: dependencies in
 * platform/app/package.json so yarn install picks them up from
 * the monorepo workspace.
 *
 * Called during docker build — safe to run multiple times (idempotent).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// When run via Docker (copied to /tmp), cwd is WORKDIR = /build/ohif
const PKG_PATH = path.resolve(process.cwd(), 'platform/app/package.json');

if (!fs.existsSync(PKG_PATH)) {
  console.error(`[register-packages] ERROR: ${PKG_PATH} not found`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
pkg.dependencies = pkg.dependencies || {};

const additions = {
  '@ambientwork/ohif-extension-dental-cpr':
    'file:../../extensions/dental-cpr',
  '@ambientwork/ohif-extension-dental-tools':
    'file:../../extensions/dental-tools',
  '@ambientwork/ohif-mode-dental-cpr':
    'file:../../modes/dental-cpr-mode',
};

let changed = false;
for (const [name, spec] of Object.entries(additions)) {
  if (pkg.dependencies[name] !== spec) {
    pkg.dependencies[name] = spec;
    changed = true;
  }
}

if (changed) {
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n');
  console.log('[register-packages] Registered dental extensions in platform/app/package.json');
} else {
  console.log('[register-packages] Already registered — skipping');
}
