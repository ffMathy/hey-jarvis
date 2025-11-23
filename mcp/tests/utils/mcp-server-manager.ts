import { MCPClient } from '@mastra/mcp';
import { type ChildProcess, spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import jwt from 'jsonwebtoken';
import { retryWithBackoff } from './retry-with-backoff';

const execAsync = promisify(exec);

let mcpServerProcess: ChildProcess | null = null;

// JWT secret for authentication (must match server)
const MCP_PORT = 4112;

// Find workspace root (go up from mcp/tests/utils to workspace root)
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

/**
 * Kills any process listening on the specified port.
 */
async function killProcessOnPort(port: number): Promise<void> {
  try {
    if (process.platform === 'win32') {
      // Windows approach
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(Number(pid))) {
          await execAsync(`taskkill /F /PID ${pid}`).catch(() => {});
        }
      }
    } else {
      // Unix/Linux/macOS approach
      await execAsync(`lsof -ti:${port} | xargs kill -9`).catch(() => {});
    }
    console.log(`🧹 Killed process(es) on port ${port}`);
  } catch (error) {
    // Silent failure - port may already be free
  }
}

/**
 * Checks if the MCP server is already running
 */
export async function isMcpServerRunning(args?: AuthenticatedMcpClientArgs): Promise<boolean> {
  let client: MCPClient | null = null;
  try {
    client = await createAuthenticatedMcpClient(args);
    await client.listTools();
    return true;
  } catch (error) {
    return false;
  } finally {
    if (client) {
      try {
        await client.disconnect();
      } catch (disconnectError) {
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

  console.log('🤖 Starting MCP server via run-with-env.sh + tsx...');

  // Start MCP server using run-with-env.sh to load 1Password secrets
  // Call tsx directly to avoid nested NX process issues
  mcpServerProcess = spawn('./.scripts/run-with-env.sh', ['mcp/op.env', 'bunx', 'tsx', 'mcp/mastra/mcp-server.ts'], {
    detached: false,
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: WORKSPACE_ROOT,
  });

  // Wait for server to be ready with exponential backoff
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
      maxRetries: 5,
      initialDelay: 1000,
      backoffMultiplier: 5,
      onRetry: (error, attempt, delayMs) => {
        console.log(`🔍 Checking MCP server status (attempt ${attempt}/30)...`);
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
 * Generate a valid JWT token for testing
 */
export function generateValidToken(expiresIn = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'test-client',
    iat: now,
    exp: now + expiresIn,
  };
  return jwt.sign(payload, process.env.HEY_JARVIS_MCP_JWT_SECRET!);
}

/**
 * Generate an expired JWT token for testing
 */
export function generateExpiredToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'test-client',
    iat: now - 7200,
    exp: now - 3600,
  };
  return jwt.sign(payload, process.env.HEY_JARVIS_MCP_JWT_SECRET!);
}

/**
 * Generate a JWT token without expiry for testing
 */
export function generateTokenWithoutExpiry(): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: 'test-client',
    iat: now,
  };
  return jwt.sign(payload, process.env.HEY_JARVIS_MCP_JWT_SECRET!);
}

/**
 * Creates an authenticated MCP client with a JWT token.
 * If no token is provided, generates a valid JWT signed with the secret.
 */
type AuthenticatedMcpClientArgs = {
  token?: string;
  url?: string;
};
export async function createAuthenticatedMcpClient(args?: AuthenticatedMcpClientArgs): Promise<MCPClient> {
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
        requestInit: {
          headers: {
            Authorization: `Bearer ${args?.token || generateValidToken()}`,
          },
        },
      },
    },
    timeout: timeout,
  });
}
