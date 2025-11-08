import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run tests sequentially for Docker container management
  forbidOnly: !!process.env.GITHUB_ACTIONS,
  retries: process.env.GITHUB_ACTIONS ? 1 : 0, // Reduce retries from 2 to 1 to save time
  workers: 1, // Use single worker to avoid port conflicts
  reporter: process.env.GITHUB_ACTIONS ? 'github' : 'html', // Use GitHub Actions reporter for better CI output
  timeout: 420000, // 7 minutes for tests that start Docker containers (allows 5min startup + 2min test)
  globalTimeout: process.env.GITHUB_ACTIONS ? 900000 : 0, // 15 minutes total for CI runs
  use: {
    baseURL: 'http://localhost:5690',
    trace: 'on-first-retry',
    actionTimeout: 30000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Remove webServer config since we'll handle Docker manually in tests
});
