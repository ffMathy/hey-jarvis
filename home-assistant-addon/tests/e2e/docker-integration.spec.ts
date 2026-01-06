import { expect, test } from '@playwright/test';
import { type ContainerStartupResult, startContainer } from './helpers/container-startup';
import { PORTS } from './helpers/ports';

/**
 * Get the container's IP address for direct Docker network access.
 *
 * In devcontainer environments with Docker-in-Docker, port forwarding to localhost doesn't work
 * because the mapped ports are on the HOST machine, not accessible within the devcontainer.
 * The solution is to access containers directly via their Docker bridge network IP address.
 */
async function getContainerIP(): Promise<string> {
  const { execSync } = await import('child_process');

  const result = execSync("docker inspect --format='{{.NetworkSettings.IPAddress}}' home-assistant-addon-test", {
    encoding: 'utf-8',
  }).trim();

  if (!result || result === '<no value>') {
    throw new Error('Failed to get container IP address');
  }

  return result;
}

test.describe('Docker Container Integration Tests', () => {
  let container: ContainerStartupResult | undefined;

  test.beforeAll(async () => {
    container = await startContainer();
  });

  test.afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  test('should load main application without network failures', async ({ page }) => {
    const networkRequests: Array<{ url: string; status: number; method: string }> = [];
    const failedRequests: Array<{ url: string; status: number; error?: string }> = [];

    // Monitor all network requests
    page.on('response', (response) => {
      const request = {
        url: response.url(),
        status: response.status(),
        method: response.request().method(),
      };

      networkRequests.push(request);

      if (response.status() >= 400) {
        failedRequests.push({
          url: response.url(),
          status: response.status(),
        });
      }
    });

    page.on('requestfailed', (request) => {
      failedRequests.push({
        url: request.url(),
        status: 0,
        error: request.failure()?.errorText || 'Request failed',
      });
    });

    // Navigate to the application through the Home Assistant ingress path
    // This simulates how Home Assistant proxies the addon through paths like:
    // /api/hassio_ingress/{token}/
    //
    // Access via Docker bridge network IP (required for Docker-in-Docker/devcontainer)
    const containerIP = await getContainerIP();
    const ingressUrl = `http://${containerIP}:${PORTS.TEST_INGRESS_PORT}/api/hassio_ingress/redacted/api/agents`;
    console.log(`Navigating to ingress URL: ${ingressUrl}`);

    const response = await page.goto(ingressUrl);

    // Validate the main page loads successfully
    expect(response?.status(), 'Main page should load successfully').toBe(200);

    // Wait for the DOM to be ready (don't wait for networkidle since SSE connections stay open)
    await page.waitForLoadState('domcontentloaded');

    // Wait a bit for any additional resources to load
    await page.waitForTimeout(5000);

    // Log results
    console.log(`Total requests: ${networkRequests.length}`);
    console.log(`Failed requests: ${failedRequests.length}`);

    if (failedRequests.length > 0) {
      console.log('Failed requests:', failedRequests);
    }

    // Assert NO failed requests - all requests should succeed
    expect(failedRequests, 'All requests should succeed with 2xx/3xx status codes').toHaveLength(0);

    // Assert the page loaded successfully and we're on the correct URL
    expect(page.url()).toContain('/api/hassio_ingress/redacted/');
  });
});
