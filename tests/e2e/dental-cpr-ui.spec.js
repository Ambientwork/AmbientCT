const { test, expect } = require('playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://host.docker.internal:3000';
const SAMPLE_DICOM = '/work/dicom-import/dental_cbct_dicom/slice_0000.dcm';

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

async function returnToFileManager(page, buttonName = 'Schließen') {
  await page.getByRole('button', { name: buttonName }).click();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await gotoFileManager(page);
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
});
