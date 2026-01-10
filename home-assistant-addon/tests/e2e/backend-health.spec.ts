import { expect, test } from '@playwright/test';
import { type ContainerStartupResult, startContainer } from './helpers/container-startup';
import { getContainerIP } from './helpers/docker-helper';
import { generateTestToken } from './helpers/jwt-helper';
import { PORTS } from './helpers/ports';

test.describe('Backend Health and Connectivity Tests', () => {
  let container: ContainerStartupResult | undefined;
  let containerIP: string;

  test.beforeAll(async () => {
    container = await startContainer();
    containerIP = await getContainerIP();
  });

  test.afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  test('MCP server should be accessible directly on port 8112', async () => {
    // The MCP server runs on internal port 8112
    // We need a valid JWT token to access it
    const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET || 'test-secret-key-12345';
    const token = await generateTestToken(jwtSecret);

    const mcpUrl = `http://${containerIP}:8112/health`;
    console.log(`Checking MCP server health at: ${mcpUrl}`);

    const response = await fetch(mcpUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    expect(response.status, 'MCP server should respond to health checks').toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data.status).toBe('healthy');
  });

  test('Mastra Studio should be accessible directly on port 8113', async () => {
    // Mastra Studio runs on internal port 8113
    const studioUrl = `http://${containerIP}:8113`;
    console.log(`Checking Mastra Studio at: ${studioUrl}`);

    const response = await fetch(studioUrl);

    // Should respond with 200 or redirect (3xx)
    expect(response.status, 'Mastra Studio should be accessible').toBeLessThan(400);
  });

  test('nginx proxy on port 4112 should handle backend delays gracefully', async () => {
    // Test that nginx doesn't immediately close connections when backend is slow
    const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET || 'test-secret-key-12345';
    const token = await generateTestToken(jwtSecret);

    const proxyUrl = `http://${containerIP}:${PORTS.MCP_SERVER}/health`;
    console.log(`Testing nginx proxy at: ${proxyUrl}`);

    const startTime = Date.now();
    const response = await fetch(proxyUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const duration = Date.now() - startTime;

    console.log(`Request took ${duration}ms, status: ${response.status}`);

    // Should succeed even with backend delays (up to 60s connect timeout)
    expect(response.status, 'Proxy should handle backend delays').toBeLessThan(500);
    expect(duration, 'Should respond within reasonable time').toBeLessThan(5000);
  });

  test('nginx proxy on port 4111 should handle backend delays gracefully', async () => {
    // Test Mastra Studio proxy
    const proxyUrl = `http://${containerIP}:${PORTS.MASTRA_STUDIO}`;
    console.log(`Testing Mastra Studio proxy at: ${proxyUrl}`);

    const startTime = Date.now();
    const response = await fetch(proxyUrl);
    const duration = Date.now() - startTime;

    console.log(`Request took ${duration}ms, status: ${response.status}`);

    // Should succeed even with backend delays
    expect(response.status, 'Proxy should handle backend delays').toBeLessThan(500);
    expect(duration, 'Should respond within reasonable time').toBeLessThan(5000);
  });

  test('nginx should retry on backend errors', async () => {
    // This test verifies that nginx retry configuration is working
    // by attempting to connect to a service that might be temporarily unavailable
    const jwtSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET || 'test-secret-key-12345';
    const token = await generateTestToken(jwtSecret);

    const proxyUrl = `http://${containerIP}:${PORTS.MCP_SERVER}/health`;

    // Make multiple rapid requests to test retry behavior
    const requests = Array.from({ length: 5 }, async () => {
      const response = await fetch(proxyUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return response.status;
    });

    const statuses = await Promise.all(requests);

    // All requests should eventually succeed (no 502/503/504 errors)
    const failedRequests = statuses.filter((status) => status >= 500);
    expect(failedRequests.length, 'All requests should succeed with retries').toBe(0);
  });
});
