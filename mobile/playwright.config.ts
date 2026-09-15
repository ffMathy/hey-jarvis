import { defineConfig, devices } from '@playwright/test';

/**
 * The port the exported web build is served on for the browser tests.
 *
 * Deliberately not 8081: that is Metro's, and a developer with `expo start`
 * already running should not have these tests silently attach to their dev
 * server instead of the production export.
 */
const PORT = 8099;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }]],
  timeout: 120000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    // The app asks for the microphone before it starts a session, so a browser
    // that refuses would never get past that first step. Granting it and handing
    // Chromium a fake capture device keeps the real code path under test without
    // needing a real microphone on the machine running it.
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
      // Normally undefined, which means "the browser Playwright installed for
      // itself" — the right answer on a developer machine and in CI, where
      // `playwright install` has run. It exists for the environments that
      // already have a Chromium but not that exact build: a sandbox with a
      // pre-seeded browser directory, or a distro package. Pointing at one
      // beats skipping the tests.
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    },
  },
  // Exported fresh each run rather than depending on a previous build, so the
  // tests can never pass against a stale bundle.
  webServer: {
    command: `bunx expo export --platform web --output-dir dist --clear && bunx expo serve --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
