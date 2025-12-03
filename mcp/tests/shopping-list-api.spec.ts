import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  generateExpiredToken,
  generateValidToken,
  startMcpServerForTestingPurposes,
  stopMcpServer,
} from './utils/mcp-server-manager';

const API_BASE_URL = 'http://localhost:4112';
const SERVER_STARTUP_TIMEOUT = 120000;

describe('Shopping List API Tests', () => {
  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_MCP_JWT_SECRET) {
      throw new Error('HEY_JARVIS_MCP_JWT_SECRET not found - tests must be run via nx test which uses run-with-env.sh');
    }

    console.log('Starting MCP server programmatically...');
    await startMcpServerForTestingPurposes();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('MCP server is ready!');
  }, SERVER_STARTUP_TIMEOUT);

  afterAll(async () => {
    console.log('Shutting down servers...');
    await stopMcpServer();
  });

  test('should return 401 for shopping list API without JWT token', async () => {
    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'Add milk' }),
    });

    expect(response.status).toBe(401);
    console.log('✓ Shopping list API correctly rejects requests without JWT token');
  });

  test('should return 401 for shopping list API with invalid JWT token', async () => {
    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token-here',
      },
      body: JSON.stringify({ prompt: 'Add milk' }),
    });

    expect(response.status).toBe(401);
    console.log('✓ Shopping list API correctly rejects requests with invalid JWT token');
  });

  test('should return 401 for shopping list API with expired JWT token', async () => {
    const expiredToken = generateExpiredToken();

    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${expiredToken}`,
      },
      body: JSON.stringify({ prompt: 'Add milk' }),
    });

    expect(response.status).toBe(401);
    console.log('✓ Shopping list API correctly rejects requests with expired JWT token');
  });

  test('should return 400 for shopping list API with missing prompt', async () => {
    const validToken = generateValidToken();

    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
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
    const validToken = generateValidToken();

    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ prompt: '' }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toContain('Validation failed');
    console.log('✓ Shopping list API correctly rejects requests with empty prompt');
  });

  test('should accept shopping list API request with valid JWT and prompt', async () => {
    const validToken = generateValidToken();

    const response = await fetch(`${API_BASE_URL}/api/shopping-list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${validToken}`,
      },
      body: JSON.stringify({ prompt: 'Add 2 liters of milk' }),
    });

    // The workflow may fail due to missing Bilka credentials in test environment
    // but we're testing that the API endpoint accepts the request correctly
    const data = await response.json();

    // Accept either success (workflow completed) or 500 (workflow failed due to missing credentials)
    // but the endpoint should not return 401 or 400
    expect([200, 500]).toContain(response.status);

    if (response.status === 200) {
      expect(data.success).toBeDefined();
      expect(data.message).toBeDefined();
      console.log('✓ Shopping list API accepted request and workflow completed successfully');
    } else {
      // Workflow failed but API endpoint worked correctly
      expect(data.success).toBe(false);
      console.log('✓ Shopping list API accepted request (workflow failed - likely missing Bilka credentials)');
    }
  });
});
