import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * The port the built headset app is served on for the browser tests: 8098 unless
 * VR_E2E_PORT says otherwise.
 *
 * Not the phone's 8099: `turbo e2e` can run both apps' suites at once, and each needs its own
 * server. And settable, because two checkouts of this repository — worktrees, each running its own
 * suite — would otherwise both want 8098.
 */
const PORT = Number(process.env.VR_E2E_PORT ?? 8098);

/**
 * Whether to test against a server already listening on the port instead of starting one: only
 * when HORIZON_E2E_REUSE_SERVER=1 asks for it.
 *
 * Whatever is on the port may be another checkout's server, serving another build — or one that
 * stops halfway through the run when its own suite finishes. Testing against it has passed and
 * failed tests for reasons that had nothing to do with this build, so by default a busy port fails
 * the run at once, and says so.
 */
const REUSE_SERVER = process.env.HORIZON_E2E_REUSE_SERVER === '1';

/**
 * How Chromium is started for every spec.
 *
 * The app asks for the microphone to hear "Hey Jarvis"; a fake capture device, with the permission
 * granted, keeps the real code path under test without a real microphone. Headless Chromium on a
 * machine with no GPU only gets WebGL from SwiftShader, and it has deprecated falling back to it
 * without being asked.
 */
const LAUNCH_ARGUMENTS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--enable-unsafe-swiftshader',
];

/**
 * A spoken "hey jarvis" (espeak-ng, made for the wake word's own tests), which the wake-word spec's
 * fake microphone plays on a loop. A launch flag, so it takes a project of its own.
 */
const HEY_JARVIS_CLIP = fileURLToPath(new URL('./src/wake/fixtures/hey-jarvis-american.wav', import.meta.url));

/** The spec that hears it, and only it. */
const HEARS_HEY_JARVIS = /app-wake-word\.spec\.ts$/;

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
    permissions: ['microphone'],
    launchOptions: {
      args: LAUNCH_ARGUMENTS,
      // Normally undefined, meaning the browser Playwright installed for itself. It exists for
      // machines that have a Chromium but not that exact build; see mobile/playwright.config.ts.
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
    },
  },
  // The real build, served under its real Pages sub-path: `turbo e2e` depends on `build`, so it
  // is fresh, and an asset asked for from the domain root 404s here just as it would on Pages.
  webServer: {
    command: `bun .scripts/serve-dist.ts ${PORT}`,
    url: `http://localhost:${PORT}/hey-jarvis/vr/`,
    reuseExistingServer: REUSE_SERVER,
    timeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: HEARS_HEY_JARVIS,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium hearing "hey jarvis"',
      testMatch: HEARS_HEY_JARVIS,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [...LAUNCH_ARGUMENTS, `--use-file-for-fake-audio-capture=${HEY_JARVIS_CLIP}`],
          executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
        },
      },
    },
  ],
});
