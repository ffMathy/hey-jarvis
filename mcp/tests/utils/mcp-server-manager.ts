import { MCPClient } from '@mastra/mcp';
import fkill from 'fkill';
import * as path from 'path';
import { retryWithBackoff } from './retry-with-backoff';

let mcpServerProcess: ReturnType<typeof Bun.spawn> | null = null;

const MCP_PORT = 4112;

// Find workspace root (go up from mcp/tests/utils to workspace root)
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

/**
 * Kills any process listening on the specified port using fkill.
 * This is cross-platform and doesn't return non-zero exit codes.
 */
async function killProcessOnPort(port: number): Promise<void> {
  try {
    await fkill(`:${port}`, { force: true, silent: true });
    console.log(`🧹 Killed process(es) on port ${port}`);
  } catch (_error) {
    // Silent failure - port may already be free
  }
}

/**
 * Checks if the server is healthy via the health endpoint
 */
async function isServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${MCP_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch (_error) {
    return false;
  }
}

/**
 * Checks if the MCP server is already running.
 * First checks the health endpoint, then attempts full MCP client connection.
 */
export async function isMcpServerRunning(args?: McpClientArgs): Promise<boolean> {
  // First, quick health check to see if server is up
  if (!(await isServerHealthy())) {
    return false;
  }

  // Then try the full MCP client connection
  let client: MCPClient | null = null;
  try {
    client = await createMcpClient(args);
    await client.listTools();
    return true;
  } catch (_error) {
    return false;
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch (_disconnectError) {
        // Ignore disconnect errors during cleanup
      }
    }
  }
}

/**
 * Starts the MCP server using run-with-env.sh directly with tsx.
 * This ensures environment variables are properly loaded from 1Password CLI.
 * CRITICAL: Must use run-with-env.sh to load secrets, but call tsx directly to avoid nested NX processes.
 */
export async function startMcpServerForTestingPurposes(): Promise<void> {
  // Kill any existing servers first to ensure clean state
  await killProcessOnPort(MCP_PORT);

  // Check if MCP server is already running
  if (await isMcpServerRunning()) {
    console.log('✅ MCP server is already running');
    return;
  }

  console.log('🤖 Starting MCP server via run-with-env.sh + bun...');

  // Start MCP server using run-with-env.sh to load 1Password secrets
  // Using Bun.spawn for simpler process management
  mcpServerProcess = Bun.spawn(['./.scripts/run-with-env.sh', 'mcp/op.env', 'bun', 'run', 'mcp/mastra/mcp-server.ts'], {
    cwd: WORKSPACE_ROOT,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  // Suppress process exit errors during cleanup - server is intentionally killed
  mcpServerProcess.unref();

  // Wait for server to be ready with exponential backoff
  // Server needs time to initialize: load environment, start Express, initialize scheduler
  const maxRetries = 30;
  await retryWithBackoff(
    async () => {
      if (await isMcpServerRunning()) {
        console.log('✅ MCP server started successfully');
        // Give server extra time to stabilize
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return;
      }
      throw new Error('MCP server not ready yet');
    },
    {
      maxRetries,
      initialDelay: 2000,
      maxDelay: 5000,
      backoffMultiplier: 1.5,
      onRetry: (_error, attempt, _delayMs) => {
        console.log(`🔍 Checking MCP server status (attempt ${attempt}/${maxRetries})...`);
      },
    },
  );
}

/**
 * Stops the MCP server if it was started by this process
 */
export async function stopMcpServer(): Promise<void> {
  // Kill process via port - this is most reliable
  await killProcessOnPort(MCP_PORT);
  // Give processes time to clean up (increased for proper cleanup)
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Clean up process reference and suppress any exit code errors
  if (mcpServerProcess && !mcpServerProcess.killed) {
    try {
      mcpServerProcess.kill();
    } catch (_error) {
      // Ignore errors - process might already be dead
    }
  }
  mcpServerProcess = null;
  console.log('🛑 MCP server stopped');
}

/**
 * Checks if the MCP server is running (for external use)
 */
export function isMcpServerRunningSync(): boolean {
  return mcpServerProcess !== null && !mcpServerProcess.killed;
}

/**
 * Creates an MCP client for testing.
 */
type McpClientArgs = {
  url?: string;
};
export async function createMcpClient(args?: McpClientArgs): Promise<MCPClient> {
  const timeout = 5000;
  return new MCPClient({
    id: 'mcp-test-client',
    servers: {
      testServer: {
        logger: (_message) => {},
        enableServerLogs: false,
        connectTimeout: timeout,
        timeout: timeout,
        url: new URL(args?.url || 'http://localhost:4112/api/mcp'),
      },
    },
    timeout: timeout,
  });
}
