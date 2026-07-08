import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E configuration.
 * Docs: https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  /* Maximum time one test can run */
  timeout: 30_000,
  /* Expect timeout for assertions */
  expect: { timeout: 5_000 },
  /* Fail the build on CI if you accidentally left test.only */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Use 1 worker on CI to avoid port conflicts, parallelise locally */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter */
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'on-failure' }]],

  /* Shared settings for all projects */
  use: {
    baseURL: 'http://127.0.0.1:3000',
    /* Collect traces on first retry */
    trace: 'on-first-retry',
    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Browser projects */
  projects: [
    /* Desktop — Chromium */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /* Mobile — emulate Pixel 5 (used for T4.6 Fast View tests) */
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/fast-view-mobile.spec.ts',
    },
  ],

  /* Global setup: creates authenticated session state once */
  globalSetup: './e2e/global-setup.ts',

  /* Start the Next.js dev server before tests (skipped if already running) */
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
