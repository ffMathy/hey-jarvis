import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { type ContainerStartupResult, startContainer } from './helpers/container-startup';
import { getContainerIP } from './helpers/docker-helper';
import { PORTS } from './helpers/ports';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOTS_DIR = path.join(__dirname, '../../test-results/screenshots');

let container: ContainerStartupResult | undefined;

test.beforeAll(async () => {
  container = await startContainer();
});

test.afterAll(async () => {
  if (container) {
    await container.cleanup();
  }
});

test.describe('MCP Docker Image Health', () => {
  test('Mastra dev health endpoint should respond', async ({ request }) => {
    const containerIP = await getContainerIP();
    const response = await request.get(`http://${containerIP}:${PORTS.MASTRA_DEV}/health`);

    expect(response.ok()).toBeTruthy();
  });

  test('MCP server health endpoint should respond', async ({ request }) => {
    const containerIP = await getContainerIP();
    const response = await request.get(`http://${containerIP}:${PORTS.MCP_SERVER_INTERNAL}/health`);

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('status');
  });
});

test.describe('Mastra Studio Homepage', () => {
  test('should load Studio UI and render page shell', async ({ page }) => {
    const containerIP = await getContainerIP();
    const studioUrl = `http://${containerIP}:${PORTS.MASTRA_DEV}`;

    const response = await page.goto(studioUrl);
    expect(response?.status()).toBeLessThan(400);

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    const title = await page.title();
    expect(title).toContain('Mastra');

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-homepage.png'), fullPage: true });
  });
});

/**
 * Studio is a React SPA where MASTRA_SERVER_HOST is set to 'localhost' inside the container.
 * When accessed from outside via Docker bridge IP, the SPA shell loads but API-driven sidebar
 * links won't render. Direct URL navigation works because the SPA router handles client-side routes.
 */
test.describe('Mastra Studio Pages', () => {
  test('should load Agents page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/agents`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-agents-page.png'), fullPage: true });
    expect(page.url()).toContain('/agents');
  });

  test('should load individual Agent detail page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/agents/weather`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-agent-detail-weather.png'), fullPage: true });
    expect(page.url()).toContain('/agents/weather');
  });

  test('should load Workflows page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/workflows`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-workflows-page.png'), fullPage: true });
    expect(page.url()).toContain('/workflows');
  });

  test('should load Tools page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/tools`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-tools-page.png'), fullPage: true });
    expect(page.url()).toContain('/tools');
  });

  test('should load Observability page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/observability`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-observability-page.png'), fullPage: true });
    expect(page.url()).toContain('/observability');
  });

  test('should load Swagger UI', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/swagger-ui`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'swagger-ui.png'), fullPage: true });
    expect(page.url()).toContain('swagger');
  });

  test('should load MCP Servers page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/mcps`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-mcp-servers-page.png'), fullPage: true });
    expect(page.url()).toContain('/mcps');
  });

  test('should load Settings page', async ({ page }) => {
    const containerIP = await getContainerIP();
    const response = await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}/settings`);

    expect(response?.status()).toBeLessThan(400);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-settings-page.png'), fullPage: true });
    expect(page.url()).toContain('/settings');
  });
});

test.describe('Mastra API Endpoints', () => {
  test('should list agents via API', async ({ request }) => {
    const containerIP = await getContainerIP();
    const response = await request.get(`http://${containerIP}:${PORTS.MASTRA_DEV}/api/agents`);

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const agentIds = Object.keys(data);
    expect(agentIds.length).toBeGreaterThan(0);
    expect(agentIds).toContain('weather');
    expect(agentIds).toContain('notification');
  });

  test('should list workflows via API', async ({ request }) => {
    const containerIP = await getContainerIP();
    const response = await request.get(`http://${containerIP}:${PORTS.MASTRA_DEV}/api/workflows`);

    expect(response.ok()).toBeTruthy();

    const data = await response.json();
    const workflowIds = Object.keys(data);
    expect(workflowIds.length).toBeGreaterThan(0);
  });

  test('should serve Swagger UI endpoint', async ({ request }) => {
    const containerIP = await getContainerIP();
    const response = await request.get(`http://${containerIP}:${PORTS.MASTRA_DEV}/swagger-ui`);

    expect(response.ok()).toBeTruthy();

    const html = await response.text();
    expect(html).toContain('swagger');
  });
});

test.describe('Studio UI Integrity', () => {
  test('should load without critical JavaScript errors', async ({ page }) => {
    const jsErrors: string[] = [];

    page.on('pageerror', (error) => {
      jsErrors.push(error.message);
    });

    const containerIP = await getContainerIP();
    await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // Filter out non-critical errors from API calls that fail without configured external services
    const criticalErrors = jsErrors.filter((err) => {
      if (err.includes('Failed to fetch') || err.includes('NetworkError')) return false;
      if (err.includes('401') || err.includes('403')) return false;
      return true;
    });

    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'studio-no-js-errors.png'), fullPage: true });

    expect(criticalErrors, `Unexpected JS errors: ${criticalErrors.join(', ')}`).toHaveLength(0);
  });

  test('should not have broken network requests for static assets', async ({ page }) => {
    const failedStaticRequests: Array<{ url: string; status: number }> = [];

    page.on('response', (response) => {
      const url = response.url();
      if (
        (url.endsWith('.js') || url.endsWith('.css') || url.match(/\.(png|jpg|svg|woff2?|ttf)$/)) &&
        response.status() >= 400
      ) {
        failedStaticRequests.push({ url, status: response.status() });
      }
    });

    const containerIP = await getContainerIP();
    await page.goto(`http://${containerIP}:${PORTS.MASTRA_DEV}`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    expect(failedStaticRequests, `Failed static assets: ${JSON.stringify(failedStaticRequests)}`).toHaveLength(0);
  });
});
