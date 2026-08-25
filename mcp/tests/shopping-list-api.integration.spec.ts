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
    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Add milk to my basket' }),
    });

    // The workflow may fail due to missing Bilka credentials or AI content filtering in test environment
    // but we're testing that the API endpoint accepts the request correctly
    const data = await response.json();

    // Accept either success (workflow completed) or 500 (workflow failed due to errors)
    // but the endpoint should not return 401 or 400
    expect([200, 500]).toContain(response.status);

    expect(data.success).toBeDefined();
    expect(data.message).toBeDefined();
    console.log('✓ Shopping list API accepted request (status:', `${response.status})`);
  }, 30000);
});
