/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir: './tests/e2e',
  timeout: 60000,
  retries: 0,
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 1600, height: 1000 },
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
};
