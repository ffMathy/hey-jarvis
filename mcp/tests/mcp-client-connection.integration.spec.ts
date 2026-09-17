import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { MCPClient } from '@mastra/mcp';
import {
  createMcpClient,
  isMcpServerRunning,
  startMcpServerForTestingPurposes,
  stopMcpServer,
} from './utils/mcp-server-manager';

const SERVER_STARTUP_TIMEOUT = 120000;

/**
 * How long a test that actually talks to the server is allowed to take.
 *
 * Bun's default is five seconds, and that is not enough for the first real connection to a server
 * that started moments ago: `createMcpClient` alone allows five seconds for Streamable HTTP and
 * then five more for the SSE fallback, so one `listTools()` can legitimately want ten.
 *
 * Overrunning is much worse than slow. **When a test times out, Bun kills every process spawned
 * during it** — that is its "killed N dangling process" line — and the process spawned here is the
 * MCP server the rest of the file needs. So a single test that runs over does not fail alone; it
 * takes the server down and every later test with it. That is exactly how this file failed in CI
 * while `shopping-list-api.integration.spec.ts` beside it passed: that one gives its slow test a
 * budget, and this one gave its tests none.
 */
const SERVER_CALL_TIMEOUT = 30000;

describe('MCP Server Connection Tests', () => {
  let mcpClient: MCPClient | null = null;

  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error(
        'HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY not found - tests must be run via bunx turbo test --filter=mcp, which uses run-with-env.sh',
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
      mcpClient = await createMcpClient();

      // Getting tools successfully means connection was established
      const tools = await mcpClient.listTools();
      expect(tools).toBeDefined();
      console.log(`✓ MCP server established connection`);
    },
    SERVER_CALL_TIMEOUT,
  );

  it(
    'should list available tools',
    async () => {
      mcpClient = await createMcpClient();

      const tools = await mcpClient.listTools();
      expect(tools).toBeDefined();
      expect(Object.keys(tools).length).toBeGreaterThan(0);
      console.log(`✓ MCP server returned ${Object.keys(tools).length} tools`);
    },
    SERVER_CALL_TIMEOUT,
  );

  it(
    'should handle connection errors gracefully',
    async () => {
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
    },
    SERVER_CALL_TIMEOUT,
  );

  it(
    'should report an unreachable MCP endpoint as not running',
    async () => {
      // The origin is healthy but nothing speaks MCP on this path, so the client
      // resolves with an empty tool list instead of throwing. Callers such as the
      // cloudflared tunnel check rely on that not being mistaken for a live server.
      const running = await isMcpServerRunning({ url: 'http://localhost:4112/not-the-mcp-endpoint' });

      expect(running).toBe(false);
      console.log('✓ Unreachable MCP endpoint reported as not running');
    },
    SERVER_CALL_TIMEOUT,
  );

  it(
    'should report an unreachable origin as not running',
    async () => {
      const running = await isMcpServerRunning({ url: 'http://localhost:9999/api/mcp' });

      expect(running).toBe(false);
      console.log('✓ Unreachable origin reported as not running');
    },
    SERVER_CALL_TIMEOUT,
  );
});
