import { defineConfig, devices } from '@playwright/test';
import { resolveE2eBaseUrl } from './tests-e2e/lanes';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Shared seeded data — never run two specs against the same emulator state.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    // PLAYWRIGHT_BASE_URL still wins; otherwise E2E_APP/E2E_LANE pick the
    // dev server (issue #358), defaulting to lane-1 sit on :5173 as before.
    baseURL: resolveE2eBaseUrl(),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // NO webServer field — the dev server and emulators are already running
  // and shared with team-lead and the human; Playwright must not try to
  // start or stop them.
});
