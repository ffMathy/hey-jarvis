import { MCPClient } from '@mastra/mcp';
import { createMcpClient, startMcpServerForTestingPurposes, stopMcpServer } from './utils/mcp-server-manager';

const SERVER_STARTUP_TIMEOUT = 120000;

describe('MCP Server Connection Tests', () => {
  let mcpClient: MCPClient | null = null;

  beforeAll(async () => {
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

  it('should establish connection', async () => {
    mcpClient = await createMcpClient();

    // Getting tools successfully means connection was established
    const tools = await mcpClient.listTools();
    expect(tools).toBeDefined();
    console.log(`✓ MCP server established connection`);
  });

  it('should list available tools', async () => {
    mcpClient = await createMcpClient();

    const tools = await mcpClient.listTools();
    expect(tools).toBeDefined();
    expect(Object.keys(tools).length).toBeGreaterThan(0);
    console.log(`✓ MCP server returned ${Object.keys(tools).length} tools`);
  });

  it('should handle connection errors gracefully', async () => {
    const clientWithBadUrl = new MCPClient({
      id: 'test-bad-url',
      servers: {
        invalidServer: {
          url: new URL('http://localhost:9999/invalid'),
        },
      },
      timeout: 5000, // Short timeout for this test
    });

    await expect(clientWithBadUrl.listTools()).rejects.toThrow();
    await clientWithBadUrl.disconnect();
    console.log('✓ Connection errors handled gracefully');
  });
});
