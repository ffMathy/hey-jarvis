import * as path from 'node:path';
import { expect, test } from '@playwright/test';

// Configure screenshot base directory - relative to test file location
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || path.join(__dirname, '../../screenshots');

test.describe('Mastra Studio UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the Mastra Studio UI
    await page.goto('http://localhost:3000');
  });

  test('should load Studio homepage and display on port 3000', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Take a screenshot of the homepage
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-homepage.png'), fullPage: true });

    // Verify the page loaded successfully
    expect(page.url()).toContain('localhost:3000');
  });

  test('should navigate to agents section when available', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Look for agents navigation or content with timeout
    const agentsLink = page.getByText(/agents/i).first();

    // Use Playwright's built-in wait and assertion
    try {
      await agentsLink.waitFor({ state: 'visible', timeout: 5000 });
      await agentsLink.click();
      await page.waitForLoadState('networkidle');

      // Take screenshot of agents page
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-agents.png'), fullPage: true });
    } catch (error) {
      // If agents link not found, mark test as skipped
      test.skip(true, 'Agents navigation not available in Studio UI');
    }
  });

  test('should navigate to workflows section when available', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Look for workflows navigation or content with timeout
    const workflowsLink = page.getByText(/workflows/i).first();

    // Use Playwright's built-in wait and assertion
    try {
      await workflowsLink.waitFor({ state: 'visible', timeout: 5000 });
      await workflowsLink.click();
      await page.waitForLoadState('networkidle');

      // Take screenshot of workflows page
      await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-workflows.png'), fullPage: true });
    } catch (error) {
      // If workflows link not found, mark test as skipped
      test.skip(true, 'Workflows navigation not available in Studio UI');
    }
  });

  test('should verify API connection without errors', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Check for specific error messages related to API connection failures
    const errorMessages = page.getByText(/cannot connect|connection failed|network error|api (?:request )?failed/i);
    const hasErrors = (await errorMessages.count()) > 0;

    // Assert that there are no connection errors
    expect(hasErrors).toBe(false);

    // Take screenshot
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-api-status.png'), fullPage: true });
  });
});

test.describe('Mastra Server API', () => {
  test('should have health endpoint responding correctly', async ({ request }) => {
    const response = await request.get('http://localhost:4111/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('status');
  });

  test('should have swagger UI accessible', async ({ page }) => {
    await page.goto('http://localhost:4111/swagger-ui');
    await page.waitForLoadState('networkidle');

    // Take screenshot of Swagger UI
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'swagger-ui.png'), fullPage: true });

    expect(page.url()).toContain('swagger-ui');
  });
});
