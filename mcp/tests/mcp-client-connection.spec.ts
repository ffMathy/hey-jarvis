import { MCPClient } from '@mastra/mcp';
import { createMcpClient, startMcpServerForTestingPurposes, stopMcpServer } from './utils/mcp-server-manager';
import { retryWithBackoff } from './utils/retry-with-backoff';

const SERVER_STARTUP_TIMEOUT = 120000;

// The first MCP client connection + listTools against a freshly started server can be
// slow under CI load; the default 5s client/test timeout was occasionally too tight
// (timing out at ~5004ms). Use a generous client timeout, retry transient slowness, and
// give these tests room so they don't flake.
const CLIENT_TIMEOUT = 30000;
const CONNECTION_TEST_TIMEOUT = 120000;

describe('MCP Server Connection Tests', () => {
  let mcpClient: MCPClient | null = null;

  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error(
        'HEY_JARVIS_GOOGLE_API_KEY not found - tests must be run via bunx turbo test --filter=mcp, which uses run-with-env.sh',
      );
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
      await Promise.allSettled([mcpClient.disconnect()]);
      mcpClient = null;
    }
  });

  it(
    'should establish connection',
    async () => {
      // Getting tools successfully means connection was established
      const tools = await retryWithBackoff(
        async () => {
          mcpClient = await createMcpClient({ timeout: CLIENT_TIMEOUT });
          return mcpClient.listTools();
        },
        { maxRetries: 3, initialDelay: 1000 },
      );
      expect(tools).toBeDefined();
      console.log(`✓ MCP server established connection`);
    },
    CONNECTION_TEST_TIMEOUT,
  );

  it(
    'should list available tools',
    async () => {
      const tools = await retryWithBackoff(
        async () => {
          mcpClient = await createMcpClient({ timeout: CLIENT_TIMEOUT });
          return mcpClient.listTools();
        },
        { maxRetries: 3, initialDelay: 1000 },
      );
      expect(tools).toBeDefined();
      expect(Object.keys(tools).length).toBeGreaterThan(0);
      console.log(`✓ MCP server returned ${Object.keys(tools).length} tools`);
    },
    CONNECTION_TEST_TIMEOUT,
  );

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

    const [listToolsResult] = await Promise.allSettled([clientWithBadUrl.listTools()]);

    if (listToolsResult.status === 'fulfilled') {
      expect(listToolsResult.value).toBeDefined();
      expect(Object.keys(listToolsResult.value)).toHaveLength(0);
    } else {
      expect(listToolsResult.reason).toBeDefined();
    }

    await Promise.allSettled([clientWithBadUrl.disconnect()]);
    console.log('✓ Connection errors handled gracefully');
  });
});
