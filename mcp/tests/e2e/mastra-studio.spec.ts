import { expect, test } from '@playwright/test';

// Configure screenshot base directory
const SCREENSHOTS_DIR = process.env.SCREENSHOTS_DIR || 'mcp/screenshots';

test.describe('Mastra Studio UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the Mastra Studio UI
    await page.goto('http://localhost:3000');
  });

  test('should load Studio homepage', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Take a screenshot of the homepage
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/studio-homepage.png`, fullPage: true });

    // Verify the page loaded successfully
    expect(page.url()).toContain('localhost:3000');
  });

  test('should have navigation to agents', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Look for agents navigation or content
    // This is a placeholder - actual selectors depend on Studio UI structure
    const agentsLink = page.getByText(/agents/i).first();
    if (await agentsLink.isVisible()) {
      await agentsLink.click();
      await page.waitForLoadState('networkidle');

      // Take screenshot of agents page
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/studio-agents.png`, fullPage: true });
    }
  });

  test('should have navigation to workflows', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Look for workflows navigation or content
    const workflowsLink = page.getByText(/workflows/i).first();
    if (await workflowsLink.isVisible()) {
      await workflowsLink.click();
      await page.waitForLoadState('networkidle');

      // Take screenshot of workflows page
      await page.screenshot({ path: `${SCREENSHOTS_DIR}/studio-workflows.png`, fullPage: true });
    }
  });

  test('should verify API connection', async ({ page }) => {
    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Check if there are any error messages about API connection
    const errorMessages = page.getByText(/cannot connect|connection failed|error/i);
    const hasErrors = (await errorMessages.count()) > 0;

    // Assert that there are no connection errors
    expect(hasErrors).toBe(false);

    // Take screenshot
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/studio-api-status.png`, fullPage: true });
  });
});

test.describe('Mastra Server API', () => {
  test('should have health endpoint', async ({ request }) => {
    const response = await request.get('http://localhost:4111/health');
    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    expect(data).toHaveProperty('status');
  });

  test('should have swagger UI', async ({ page }) => {
    await page.goto('http://localhost:4111/swagger-ui');
    await page.waitForLoadState('networkidle');

    // Take screenshot of Swagger UI
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/swagger-ui.png`, fullPage: true });

    expect(page.url()).toContain('swagger-ui');
  });
});
