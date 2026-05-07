#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [, , distDir, brandingDir] = process.argv;

if (!distDir || !brandingDir) {
  console.error('Usage: node brand-dist.js <distDir> <brandingDir>');
  process.exit(1);
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function write(filePath, content) {
  fs.writeFileSync(filePath, content);
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function replaceAll(source, replacements) {
  return replacements.reduce(
    (content, [pattern, replacement]) => content.replace(pattern, replacement),
    source
  );
}

const indexPath = path.join(distDir, 'index.html');
const appPath = path.join(distDir, 'app.js');
const manifestPath = path.join(distDir, 'manifest.json');
const assetsDir = path.join(distDir, 'assets', 'images');

copy(path.join(brandingDir, 'manifest.json'), manifestPath);
copy(path.join(brandingDir, 'ambientct-mark.svg'), path.join(assetsDir, 'ambientct-mark.svg'));
copy(path.join(brandingDir, 'logo-ohif-small.svg'), path.join(assetsDir, 'logo-ohif-small.svg'));
copy(
  path.join(brandingDir, 'ohif-logo-color-darkbg.svg'),
  path.join(assetsDir, 'ohif-logo-color-darkbg.svg')
);
copy(path.join(brandingDir, 'ohif-logo.svg'), path.join(assetsDir, 'ohif-logo.svg'));

const indexHtml = replaceAll(read(indexPath), [
  [/content="OHIF Viewer"/g, 'content="AmbientCT"'],
  [/content="@ohif\/app"/g, 'content="AmbientCT"'],
  [/<title>OHIF Viewer<\/title>/g, '<title>AmbientCT</title>'],
  [/href="\/assets\/favicon\.ico"/g, 'href="/assets/images/ambientct-mark.svg"'],
  [/href="\/assets\/favicon-16x16\.png"/g, 'href="/assets/images/ambientct-mark.svg"'],
  [/href="\/assets\/favicon-32x32\.png"/g, 'href="/assets/images/ambientct-mark.svg"'],
]);
write(indexPath, indexHtml);

const appJs = replaceAll(read(appPath), [
  [/About OHIF Viewer/g, 'About AmbientCT Viewer'],
  [/The OHIF Viewer/g, 'AmbientCT Viewer'],
  [/OHIF Viewer/g, 'AmbientCT Viewer'],
  [/OHIF Viewer is/g, 'AmbientCT is'],
  [/Learn more about OHIF Viewer/g, 'Learn more about AmbientCT'],
  [/Open Health Imaging Foundation/g, 'Ambientwork'],
  [/https:\/\/ohif\.org\//g, 'https://github.com/Ambientwork/AmbientCT'],
]);
write(appPath, appJs);

console.log('[brand-dist] Applied AmbientCT branding to dist output');
