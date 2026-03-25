import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startMcpServerForTestingPurposes, stopMcpServer } from './utils/mcp-server-manager';

const API_BASE_URL = 'http://localhost:4112';
const SERVER_STARTUP_TIMEOUT = 120000;

describe('Shopping List API Tests', () => {
  beforeAll(async () => {
    console.log('Starting MCP server programmatically...');
    await startMcpServerForTestingPurposes();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('MCP server is ready!');
  }, SERVER_STARTUP_TIMEOUT);

  afterAll(async () => {
    console.log('Shutting down servers...');
    await stopMcpServer();
  });

  test('should return 400 for shopping list API with missing prompt', async () => {
    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain('Validation failed');
    console.log('✓ Shopping list API correctly rejects requests with missing prompt');
  });

  test('should return 400 for shopping list API with empty prompt', async () => {
    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: '' }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain('Validation failed');
    console.log('✓ Shopping list API correctly rejects requests with empty prompt');
  });

  test('should accept shopping list API request with valid prompt', async () => {
    // The workflow involves multiple LLM calls and external API requests that can
    // take a long time. We only need to verify the endpoint accepts the request
    // (passes validation), not that the full workflow completes.
    //
    // Strategy: abort the fetch after 30s. A 400 validation error comes back in
    // milliseconds, so any AbortError means validation passed and the workflow
    // started running — which is exactly what we want to confirm.
    let response: Response | undefined;
    let timedOut = false;

    try {
      response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt: 'Add milk to my basket' }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (err: unknown) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        // Server is still running the workflow — the request was accepted.
        timedOut = true;
      } else {
        throw err;
      }
    }

    if (response) {
      // Accept either success (workflow completed) or 500 (workflow failed due to
      // missing Bilka credentials / AI errors), but never 400 or 401.
      const data = await response.json();
      expect([200, 500]).toContain(response.status);
      expect(data.success).toBeDefined();
      expect(data.message).toBeDefined();
    }

    console.log(
      timedOut
        ? '✓ Shopping list API accepted request (workflow still running)'
        : `✓ Shopping list API accepted request (status: ${response?.status})`,
    );
  }, 35000);
});
