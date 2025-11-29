import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { MCPClient } from '@mastra/mcp';
import {
  createAuthenticatedMcpClient,
  generateExpiredToken,
  generateTokenWithoutExpiry,
  generateValidToken,
  startMcpServerForTestingPurposes,
  stopMcpServer,
} from './utils/mcp-server-manager';

const MCP_SERVER_URL = 'http://localhost:4112/api/mcp';
const SERVER_STARTUP_TIMEOUT = 120000;

describe('JWT Authentication Tests', () => {
  let mcpClient: MCPClient | null = null;

  beforeAll(async () => {
    // Verify required environment variables are set
    if (!process.env.HEY_JARVIS_MCP_JWT_SECRET) {
      throw new Error('HEY_JARVIS_MCP_JWT_SECRET not found - tests must be run via nx test which uses run-with-env.sh');
    }
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY not found - tests must be run via nx test which uses run-with-env.sh');
    }

    console.log('Starting MCP server programmatically...');
    await startMcpServerForTestingPurposes();

    // Wait for server to be fully ready
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log('MCP server is ready!');
  }, SERVER_STARTUP_TIMEOUT);

  afterAll(async () => {
    console.log('Shutting down servers...');
    if (mcpClient) {
      await mcpClient.disconnect();
    }
    await stopMcpServer();
  });

  afterEach(async () => {
    if (mcpClient) {
      try {
        await mcpClient.disconnect();
      } catch (_error) {
        // Ignore disconnect errors during cleanup
      }
      mcpClient = null;
    }
  });

  test('should deny access to MCP server without JWT token', async () => {
    mcpClient = new MCPClient({
      id: 'test-no-auth',
      servers: {
        testServer: {
          url: new URL(MCP_SERVER_URL),
        },
      },
      timeout: 10000,
    });

    await expect(mcpClient.listTools()).rejects.toThrow();
    console.log(`✓ MCP server correctly rejects connections without JWT token`);
  });

  test('should deny MCP server access with invalid JWT token', async () => {
    mcpClient = await createAuthenticatedMcpClient({ token: 'invalid-token-here' });

    await expect(mcpClient.listTools()).rejects.toThrow();
    console.log(`✓ MCP server correctly rejects connections with invalid JWT token`);
  });

  test('should deny MCP server access with expired JWT token', async () => {
    const expiredToken = generateExpiredToken();

    mcpClient = await createAuthenticatedMcpClient({ token: expiredToken });

    await expect(mcpClient.listTools()).rejects.toThrow();
    console.log(`✓ MCP server correctly rejects connections with expired JWT token`);
  });

  test('should allow MCP server access with valid JWT token', async () => {
    const validToken = generateValidToken();

    mcpClient = await createAuthenticatedMcpClient({ token: validToken });

    const tools = await mcpClient.listTools();
    expect(tools).toBeDefined();
    console.log(`✓ MCP server access granted with valid JWT token`);
  });

  test('should allow MCP server access with JWT token without expiry', async () => {
    const tokenWithoutExpiry = generateTokenWithoutExpiry();

    mcpClient = await createAuthenticatedMcpClient({ token: tokenWithoutExpiry });

    const tools = await mcpClient.listTools();
    expect(tools).toBeDefined();
    console.log(`✓ MCP server access granted with JWT token without expiry`);
  });

  test('should accept JWT token in Bearer format', async () => {
    const validToken = generateValidToken();

    mcpClient = await createAuthenticatedMcpClient({ token: validToken });

    const tools = await mcpClient.listTools();
    expect(tools).toBeDefined();
    console.log('✓ MCP server accepts JWT token in Bearer format');
  });
});
