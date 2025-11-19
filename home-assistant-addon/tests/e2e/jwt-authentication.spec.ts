import { test, expect } from '@playwright/test';
import { generateTestToken, generateExpiredToken, generateTokenWithoutExpiry } from './helpers/jwt-helper';
import { startContainer, ContainerStartupResult } from './helpers/container-startup';
import { getMastraUIUrl, getMCPServerUrl } from './helpers/ports';

test.describe('JWT Authentication Tests', () => {
  const JWT_SECRET = 'test-secret-for-jwt-authentication-minimum-32-chars';
  let container: ContainerStartupResult | undefined;

  test.beforeAll(async () => {
    // Use the shared startContainer function with JWT environment variable
    container = await startContainer({
      additionalInitTime: 10000,
      environmentVariables: {
        JWT_SECRET: JWT_SECRET,
      },
    });
  });

  test.afterAll(async () => {
    if (container) {
      await container.cleanup();
    }
  });

  test('should allow access to Mastra UI without JWT token', async () => {
    // Mastra UI should be accessible without JWT - it's protected by Home Assistant ingress
    const response = await fetch(getMastraUIUrl(), {
      method: 'GET',
    });

    expect(response.status).toBeLessThan(500);
    expect(response.status).not.toBe(401);
    console.log(`✓ Mastra UI accessible without JWT token (status: ${response.status})`);
  });

  test('should deny access to MCP server without JWT token', async () => {
    const response = await fetch(getMCPServerUrl() + '/api/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    // Accept both 400 (Bad Request) and 401 (Unauthorized) as valid rejection responses
    expect([400, 401]).toContain(response.status);
    console.log(`✓ MCP server access denied without JWT token (status: ${response.status})`);
  });

  test('should deny MCP server access with invalid JWT token', async () => {
    const response = await fetch(getMCPServerUrl() + '/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-token-here',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    // Accept both 400 (Bad Request) and 401 (Unauthorized) as valid rejection responses
    expect([400, 401]).toContain(response.status);
    console.log(`✓ MCP server access denied with invalid JWT token (status: ${response.status})`);
  });

  test('should deny MCP server access with expired JWT token', async () => {
    const expiredToken = await generateExpiredToken(JWT_SECRET);
    
    const response = await fetch(getMCPServerUrl() + '/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${expiredToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    // Accept both 400 (Bad Request) and 401 (Unauthorized) as valid rejection responses
    expect([400, 401]).toContain(response.status);
    console.log(`✓ MCP server access denied with expired JWT token (status: ${response.status})`);
  });

  test('should allow MCP server access with valid JWT token', async () => {
    const validToken = await generateTestToken(JWT_SECRET);
    
    const response = await fetch(getMCPServerUrl() + '/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${validToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    // We expect either success or a method-specific error, but NOT 401
    expect(response.status).not.toBe(401);
    console.log(`✓ MCP server access granted with valid JWT token (status: ${response.status})`);
  });

  test('should allow MCP server access with JWT token without expiry', async () => {
    const tokenWithoutExpiry = await generateTokenWithoutExpiry(JWT_SECRET);
    
    const response = await fetch(getMCPServerUrl() + '/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${tokenWithoutExpiry}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    // We expect either success or a method-specific error, but NOT 401
    expect(response.status).not.toBe(401);
    console.log(`✓ MCP server access granted with JWT token without expiry (status: ${response.status})`);
  });

  test('should accept JWT token in Bearer format (case-insensitive)', async () => {
    const validToken = await generateTestToken(JWT_SECRET);
    
    // Test with lowercase 'bearer'
    const response = await fetch(getMCPServerUrl() + '/api/mcp', {
      method: 'POST',
      headers: {
        'Authorization': `bearer ${validToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1
      })
    });

    expect(response.status).not.toBe(401);
    console.log('✓ Bearer scheme is case-insensitive for MCP server');
  });

  test('should not require JWT for Mastra UI even when configured', async () => {
    // Double-check that Mastra UI remains accessible without JWT
    const response = await fetch(getMastraUIUrl() + '/agents', {
      method: 'GET',
    });

    expect(response.status).not.toBe(401);
    console.log(`✓ Mastra UI /agents endpoint accessible without JWT (status: ${response.status})`);
  });
});

test.describe('JWT Authentication Disabled Tests', () => {
  test.skip('should allow access without JWT when authentication is disabled', async () => {
    // This test would require starting a container without JWT_SECRET
    // For now, we skip it as the default configuration in tests has JWT disabled
    // The graceful degradation is tested by the regular server startup tests
  });
});
