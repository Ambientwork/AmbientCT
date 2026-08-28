const { test, expect } = require('playwright/test');
const fs = require('fs');
const path = require('path');

// host.docker.internal does not resolve when Playwright itself runs on the
// host (only inside a Linux container talking to a host-run stack) — default
// to a plain localhost URL that works for the common case: Playwright on the
// host, AmbientCT in Docker with published ports. Override BASE_URL for any
// other topology (isolated stack: http://localhost:3100; containerized
// Playwright: http://host.docker.internal:3000).
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Only the isolated test stack (docker-compose.test.yml, viewer on :3100) is
// allowed to receive mutating traffic (DICOM import, MAR job creation) — see
// plan §9 P2.3. Read-only navigation tests may run against any stack.
const IS_ISOLATED_STACK = (() => {
  try {
    return new URL(BASE_URL).port === '3100';
  } catch {
    return false;
  }
})();

// Repo-relative default so the suite works out of the box on any checkout
// without hard-coding a host path. This directory is gitignored (no real or
// synthetic DICOM is ever committed) — populate it locally before running
// the import/MAR tests, or point SAMPLE_DICOM at any anonymized/synthetic
// fixture on disk.
const DEFAULT_SAMPLE_DICOM = path.join(
  __dirname, '..', 'dicom-test-data', 'dental_cbct_synthetic', 'slice_0000.dcm'
);
const SAMPLE_DICOM = process.env.SAMPLE_DICOM || DEFAULT_SAMPLE_DICOM;
const SAMPLE_DICOM_MISSING_MESSAGE =
  `SAMPLE_DICOM fixture not found at "${SAMPLE_DICOM}". ` +
  'Set the SAMPLE_DICOM env var to an anonymized/synthetic .dcm file, or ' +
  'generate one locally with pydicom (see docs/TESTING.md) — never commit ' +
  'real patient data.';

function collectBrowserIssues(page) {
  const pageErrors = [];
  const consoleErrors = [];

  page.on('pageerror', error => {
    pageErrors.push(String(error));
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  return { pageErrors, consoleErrors };
}

function getUnexpectedErrors(pageErrors, consoleErrors) {
  return [...pageErrors, ...consoleErrors].filter(message => {
    return !/favicon/i.test(message)
      && !/getRegistrations/i.test(message)
      && !/Cross-Origin-Opener-Policy header has been ignored/i.test(message);
  });
}

async function gotoFileManager(page) {
  await page.goto(`${BASE_URL}/dentalCPR`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle('AmbientCT');
  await expect(page.getByRole('heading', { name: 'Studien' })).toBeVisible();
  await expect(page.getByRole('button', { name: '↑ Importieren' })).toBeVisible();
  await expect(page.getByText('AmbientCT von Ambientwork · Open Source')).toBeVisible();
  await expect(page.getByText('AmbientCT · Ambientwork · Open Source')).toBeVisible();
}

async function expectViewerVisible(page) {
  await expect(page).toHaveTitle('AmbientCT');
  await page.waitForURL(/\/dentalCPR\?StudyInstanceUIDs=/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Schließen' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Studien' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('🦷 Panoramic CPR')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Click to place control points along the dental arch/i).first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('⊥ Prev')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('⊥ Center')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('⊥ Next')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(/Zahn-Annotation setzen/i)).toBeVisible({ timeout: 20000 });
}

async function drawArchAndExpectPanoramicReady(page) {
  const axialCanvas = page.locator('canvas').first();
  const controlPoints = [
    { x: 100, y: 360 },
    { x: 160, y: 340 },
    { x: 220, y: 335 },
    { x: 280, y: 350 },
    { x: 340, y: 380 },
  ];

  for (const point of controlPoints) {
    await axialCanvas.click({ position: point });
    await page.waitForTimeout(400);
  }

  await page.keyboard.press('Enter');
  await expect(page.getByText(/Panoramic ready/i)).toBeVisible({ timeout: 30000 });
}

async function runMarAndEnterCompare(page) {
  const marButton = page.getByRole('button', { name: /MAR/i }).first();
  await expect(marButton).toBeVisible({ timeout: 20000 });
  await marButton.click();

  await expect(page.getByText(/MAR bereit/i)).toBeVisible({ timeout: 180000 });
  await expect(page.getByRole('button', { name: 'MAR oeffnen' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Vergleich' })).toBeVisible({ timeout: 30000 });

  await page.getByRole('button', { name: 'Vergleich' }).click();
  await page.waitForURL(/marSourceSeriesInstanceUID=.*marResultSeriesInstanceUID=/, { timeout: 30000 });
  // 'Vergleich' alone is ambiguous once in compare mode — it matches both the
  // "Vergleich aktiv" badge and the "Vergleich" switcher label.
  await expect(page.getByText('Vergleich aktiv')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'MPR' }).click();
  // Two full (hundreds-of-slices) CBCT series load concurrently for compare
  // mode — matches DentalMPRViewport/DentalMPRDiffViewport's bounded-poll
  // budget (45s) plus headroom for OHIF's own display-set resolution.
  await expect(page.getByText('Original · Coronal')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('MAR · Coronal')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Diff · Coronal')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Original · Sagittal')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('MAR · Sagittal')).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Diff · Sagittal')).toBeVisible({ timeout: 60000 });
}

async function switchToMprLayoutAndExpectVisible(page) {
  await page.getByRole('button', { name: 'MPR' }).click();
  await expect(page.getByText('MPR · Coronal')).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('MPR · Sagittal')).toBeVisible({ timeout: 30000 });
}

async function returnToFileManager(page, buttonName = 'Schließen') {
  await page.getByRole('button', { name: buttonName }).click();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await gotoFileManager(page);
}

// Reads a compare-column's status line by locating its label span and
// walking to the adjacent status span the toolbar renders next to it
// (see DentalMPRViewport / DentalMPRDiffViewport toolbar markup).
async function readPanelStatus(page, panelLabel) {
  const label = page.getByText(panelLabel, { exact: true });
  const status = label.locator('xpath=following-sibling::span[1]');
  return status.innerText();
}

test.describe('AmbientCT dental CPR flow', () => {
  test('opens a study from the table and returns to the file manager', async ({ page }) => {
    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);

    const studyRows = page.locator('tbody tr');
    await expect(studyRows.first()).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Öffnen →' }).first().click();
    await expectViewerVisible(page);
    await drawArchAndExpectPanoramicReady(page);
    await switchToMprLayoutAndExpectVisible(page);
    await returnToFileManager(page);

    await page.getByPlaceholder('🔍 Suchen…').fill('phantom');
    await expect(page.getByRole('cell', { name: 'PHANTOM DENTAL CBCT' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Öffnen →' })).toHaveCount(1);

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
    expect(pageErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
    expect(consoleErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
  });

  test('opens a study from the patient tree and populates the recent tab', async ({ page }) => {
    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);

    const phantomStudyRow = page.getByText('CT · 26.03.2026').first();
    await expect(phantomStudyRow).toBeVisible();
    await phantomStudyRow.click();

    await expectViewerVisible(page);
    await returnToFileManager(page, 'Studien');

    await page.getByRole('button', { name: 'Zuletzt geöffnet' }).click();
    await expect(page.getByRole('cell', { name: 'PHANTOM DENTAL CBCT' })).toBeVisible();
    await page.getByRole('button', { name: 'Öffnen →' }).click();
    await expectViewerVisible(page);
    await returnToFileManager(page);

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
    expect(pageErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
    expect(consoleErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
  });

  test('opens Orthanc admin and imports a DICOM file from the UI', async ({ page, context }) => {
    test.skip(!IS_ISOLATED_STACK, 'Import test mutates Orthanc — only allowed against the isolated test stack (BASE_URL=http://localhost:3100).');
    test.skip(!fs.existsSync(SAMPLE_DICOM), SAMPLE_DICOM_MISSING_MESSAGE);

    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);

    const popupPromise = context.waitForEvent('page');
    await page.getByRole('button', { name: '⚙ Orthanc' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup).toHaveURL(/\/pacs\/app\/explorer\.html/);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '↑ Importieren' }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(SAMPLE_DICOM);

    await expect(page.getByText(/erfolgreich importiert/i)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Importiert' }).click();
    await expect(page.getByRole('cell', { name: 'PHANTOM DENTAL CBCT' })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Öffnen →' }).click();
    await expectViewerVisible(page);
    await returnToFileManager(page);

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
    expect(pageErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
    expect(consoleErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
  });

  test('runs MAR and enters compare mode from the dental viewer', async ({ page }) => {
    test.skip(!IS_ISOLATED_STACK, 'MAR test mutates Orthanc (writes a new series) — only allowed against the isolated test stack (BASE_URL=http://localhost:3100).');
    test.setTimeout(180000); // two full CBCT series loading concurrently for compare mode

    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);
    await page.getByRole('button', { name: 'Öffnen →' }).first().click();
    await expectViewerVisible(page);
    await drawArchAndExpectPanoramicReady(page);
    await runMarAndEnterCompare(page);
    await returnToFileManager(page, 'Studien');

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
    expect(pageErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
    expect(consoleErrors.join('\n')).not.toMatch(/Invalid study URL|notfoundstudy/i);
  });

  test('"MAR oeffnen" opens the MAR result series directly (not the compare grid)', async ({ page }) => {
    test.skip(!IS_ISOLATED_STACK, 'MAR test mutates Orthanc (writes a new series) — only allowed against the isolated test stack (BASE_URL=http://localhost:3100).');

    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);
    await page.getByRole('button', { name: 'Öffnen →' }).first().click();
    await expectViewerVisible(page);
    await drawArchAndExpectPanoramicReady(page);

    const marButton = page.getByRole('button', { name: /MAR/i }).first();
    await marButton.click();
    await expect(page.getByText(/MAR bereit/i)).toBeVisible({ timeout: 180000 });
    await expect(page.getByRole('button', { name: 'MAR oeffnen' })).toBeVisible({ timeout: 30000 });

    await page.getByRole('button', { name: 'MAR oeffnen' }).click();
    await expectViewerVisible(page);

    const url = new URL(page.url());
    const seriesParam = url.searchParams.get('SeriesInstanceUIDs') ?? '';
    // A single-series navigation — not the 3-column compare grid.
    expect(seriesParam.split(',').filter(Boolean).length).toBeLessThanOrEqual(1);
    await expect(page.getByText('Original · Coronal')).not.toBeVisible();

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
  });

  test('moving one slider updates the synced Original/MAR/Diff coronal columns', async ({ page }) => {
    test.skip(!IS_ISOLATED_STACK, 'MAR test mutates Orthanc (writes a new series) — only allowed against the isolated test stack (BASE_URL=http://localhost:3100).');
    test.setTimeout(180000); // two full CBCT series loading concurrently for compare mode

    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);
    await page.getByRole('button', { name: 'Öffnen →' }).first().click();
    await expectViewerVisible(page);
    await drawArchAndExpectPanoramicReady(page);
    await runMarAndEnterCompare(page);

    const sourceSlider = page.getByRole('slider', { name: 'Slice Original · Coronal' });
    await expect(sourceSlider).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('slider', { name: 'Slice MAR · Coronal' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('slider', { name: 'Slice Diff · Coronal' })).toBeVisible({ timeout: 30000 });

    const before = await readPanelStatus(page, 'Original · Coronal');

    await sourceSlider.focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('ArrowRight');
    }

    await expect(async () => {
      const after = await readPanelStatus(page, 'Original · Coronal');
      expect(after).not.toBe(before);
    }).toPass({ timeout: 15000 });

    const originalStatus = await readPanelStatus(page, 'Original · Coronal');
    const marStatusText = await readPanelStatus(page, 'MAR · Coronal');
    const diffStatusText = await readPanelStatus(page, 'Diff · Coronal');

    const originalSlice = originalStatus.match(/Slice Y ([\d.-]+) mm/);
    const marSlice = marStatusText.match(/Slice Y ([\d.-]+) mm/);
    const diffSlice = diffStatusText.match(/Slice Y ([\d.-]+) mm/);

    expect(originalSlice, `Original status: "${originalStatus}"`).not.toBeNull();
    expect(marSlice, `MAR status: "${marStatusText}"`).not.toBeNull();
    expect(diffSlice, `Diff status: "${diffStatusText}"`).not.toBeNull();
    expect(marSlice[1]).toBe(originalSlice[1]);
    expect(diffSlice[1]).toBe(originalSlice[1]);

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
  });

  test('reload rediscovers the MAR mapping via localStorage', async ({ page }) => {
    test.skip(!IS_ISOLATED_STACK, 'MAR test mutates Orthanc (writes a new series) — only allowed against the isolated test stack (BASE_URL=http://localhost:3100).');

    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);
    await page.getByRole('button', { name: 'Öffnen →' }).first().click();
    await expectViewerVisible(page);
    await drawArchAndExpectPanoramicReady(page);

    const marButton = page.getByRole('button', { name: /MAR/i }).first();
    await marButton.click();
    await expect(page.getByText(/MAR bereit/i)).toBeVisible({ timeout: 180000 });

    // Fresh visit to the exact same (source-series) URL — as if the tab had
    // been closed and reopened. No marSourceSeriesInstanceUID/
    // marResultSeriesInstanceUID params are present here; the mapping must
    // come back from localStorage (plan §10 P3.2), not the URL.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expectViewerVisible(page);
    await expect(page.getByText(/MAR bereit/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'MAR oeffnen' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Vergleich' })).toBeVisible({ timeout: 20000 });

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
  });

  test('an incomplete compare URL (missing MAR-result series) falls back to a working single-series MPR view', async ({ page }) => {
    // A wholly non-existent SeriesInstanceUIDs filter never reaches our
    // component at all — OHIF's own hanging-protocol/data-source resolution
    // (outside this phase's file scope, see modes/dental-cpr-mode) stays on
    // its platform-level loading screen indefinitely in that case, which is
    // a separate, pre-existing limitation, not addressed by this phase's
    // bounded-poll fix (verified interactively; not covered by this test).
    // What P3.1 actually guarantees, and what this test verifies, is that an
    // incomplete compare URL — a real source series but a MAR-result series
    // that doesn't exist — falls back to a working single-series MPR view
    // instead of an empty/broken compare grid.
    const { pageErrors, consoleErrors } = collectBrowserIssues(page);

    await gotoFileManager(page);
    await page.getByRole('button', { name: 'Öffnen →' }).first().click();
    await expectViewerVisible(page);

    const openedUrl = new URL(page.url());
    const studyUID = openedUrl.searchParams.get('StudyInstanceUIDs');
    const realSeriesUID = openedUrl.searchParams.get('initialSeriesInstanceUID');
    expect(studyUID).toBeTruthy();

    const bogusMarSeriesUID = '9.9.9.999.404.does.not.exist.in.orthanc';
    await page.goto(
      `${BASE_URL}/dentalCPR?StudyInstanceUIDs=${encodeURIComponent(studyUID)}` +
      (realSeriesUID ? `&initialSeriesInstanceUID=${encodeURIComponent(realSeriesUID)}` : '') +
      `&layoutMode=mpr&marSourceSeriesInstanceUID=${encodeURIComponent(realSeriesUID ?? '')}` +
      `&marResultSeriesInstanceUID=${encodeURIComponent(bogusMarSeriesUID)}`,
      { waitUntil: 'domcontentloaded' }
    );

    // Falls back to the plain two-viewport MPR (not the 3-column compare
    // grid, and not stuck) — the real series still renders correctly.
    // { exact: true } — otherwise this also matches the idle placeholder
    // text "MPR · Coronal — complete the arch to load volume".
    await expect(page.getByText('MPR · Coronal', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('MPR · Sagittal', { exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('Original · Coronal')).not.toBeVisible();

    const unexpectedErrors = getUnexpectedErrors(pageErrors, consoleErrors);
    expect(unexpectedErrors, `Unexpected browser errors:\n${unexpectedErrors.join('\n')}`).toEqual([]);
  });
});
