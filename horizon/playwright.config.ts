import { defineConfig, devices } from '@playwright/test';

/**
 * The port the built headset app is served on for the browser tests.
 *
 * Not the phone's 8099: `turbo e2e` can run both apps' suites at once, and each needs its own
 * server.
 */
const PORT = 8098;

/**
 * Whether this is a CI run. Keyed on GITHUB_ACTIONS rather than CI, because GITHUB_ACTIONS is
 * what the workflow passes into the dev container the tests run in, and CI is not.
 */
const IN_CI = !!process.env.GITHUB_ACTIONS;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: IN_CI,
  retries: IN_CI ? 1 : 0,
  workers: 1,
  reporter: IN_CI ? 'github' : [['html', { open: 'never' }]],
  // The room is drawn by SwiftShader on the CPU in a headless browser, three WebGL contexts
  // deep — the emulated passthrough, CanvasKit and the app's own — so frames are slow.
  timeout: 180000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 15000,
    navigationTimeout: 30000,
    // The app asks for the microphone to hear "Hey Jarvis". Granting it and handing Chromium a
    // fake capture device keeps the real code path under test without a real microphone.
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // Headless Chromium on a machine with no GPU only gets WebGL from SwiftShader, and it
        // has deprecated falling back to it without being asked.
        '--enable-unsafe-swiftshader',
      ],
      // Normally undefined, meaning the browser Playwright installed for itself. It exists for
      // machines that have a Chromium but not that exact build; see mobile/playwright.config.ts.
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    },
  },
  // The real build, served under its real Pages sub-path: `turbo e2e` depends on `build`, so it
  // is fresh, and an asset asked for from the domain root 404s here just as it would on Pages.
  webServer: {
    command: `bun .scripts/serve-dist.ts ${PORT}`,
    url: `http://localhost:${PORT}/hey-jarvis/horizon/`,
    reuseExistingServer: !IN_CI,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
