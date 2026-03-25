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
  } catch {
    // Silent failure - port may already be free
  }
  console.log(`🧹 Killed process(es) on port ${port}`);
}

/**
 * Checks if the server is healthy via the health endpoint
 */
async function isServerHealthy(): Promise<boolean> {
  const [healthResult] = await Promise.allSettled([
    fetch(`http://localhost:${MCP_PORT}/health`, {
      signal: AbortSignal.timeout(2000),
    }),
  ]);

  return healthResult.status === 'fulfilled' ? healthResult.value.ok : false;
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

  const [clientResult] = await Promise.allSettled([createMcpClient(args)]);
  if (clientResult.status !== 'fulfilled') {
    return false;
  }

  client = clientResult.value;

  const [listToolsResult] = await Promise.allSettled([client.listTools()]);
  await Promise.allSettled([client.disconnect()]);

  // @mastra/mcp >= 1.3.1 catches per-server errors and returns {} instead of throwing,
  // so we must check that tools were actually returned, not just that the call didn't throw.
  return listToolsResult.status === 'fulfilled' && Object.keys(listToolsResult.value).length > 0;
}

/**
 * Starts the MCP server using run-with-env.sh directly with tsx.
 * This ensures environment variables are properly loaded from 1Password CLI.
 * CRITICAL: Must use run-with-env.sh to load secrets, but call tsx directly to avoid nested TURBO processes.
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
    mcpServerProcess.kill();
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
