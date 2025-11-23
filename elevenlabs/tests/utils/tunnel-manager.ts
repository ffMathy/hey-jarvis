import { type ChildProcess, execSync, spawn } from 'child_process';
import { createAuthenticatedMcpClient, isMcpServerRunning } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { retryWithBackoff } from '../../../mcp/tests/utils/retry-with-backoff.js';

let tunnelProcess: ChildProcess | null = null;

/**
 * Kills all existing cloudflared processes
 */
function killExistingTunnels(): void {
  try {
    execSync('pkill -f cloudflared || true', { stdio: 'ignore' });
    console.log('🧹 Killed any existing cloudflared processes');
  } catch (error) {
    // Ignore errors - process might not exist
  }
}

/**
 * Checks if the cloudflared tunnel is already running
 * A 401 response means the tunnel is working but requires JWT authentication
 */
async function isTunnelRunning(): Promise<boolean> {
  return await isMcpServerRunning({
    url: `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL!}/api/mcp`,
  });
}

/**
 * Ensures the cloudflared tunnel is running before tests start.
 * If not running, starts it in the background.
 * Skips tunnel startup in CI/GitHub Actions environments.
 * Environment variables are expected to be already available via op run.
 */
export async function ensureTunnelRunning(): Promise<void> {
  // Kill any existing tunnels first to ensure clean state
  killExistingTunnels();
  await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for processes to die

  // Check if tunnel is already running
  if (await isTunnelRunning()) {
    console.log('✅ Cloudflared tunnel is already running');
    return;
  }

  console.log('🌐 Starting cloudflared tunnel...');
  console.log(`🌐 Tunnel URL: ${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}`);

  // Get the cloudflared token from environment (provided by op run)
  const token = process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN;
  if (!token) {
    throw new Error(
      'HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN environment variable is not set. ' +
        'Make sure tests are run via: nx test elevenlabs',
    );
  }

  console.log(`🌐 Token length: ${token.length} characters`);

  // Start cloudflared tunnel in background
  // Use full path since spawn might not have the same PATH as the shell
  const cloudflaredPath = '/usr/local/bin/cloudflared';
  tunnelProcess = spawn(cloudflaredPath, ['tunnel', 'run', '--token', token], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Log tunnel output for debugging
  if (tunnelProcess.stdout) {
    tunnelProcess.stdout.on('data', (data) => {
      console.log(`[cloudflared stdout] ${data.toString().trim()}`);
    });
  }
  if (tunnelProcess.stderr) {
    tunnelProcess.stderr.on('data', (data) => {
      console.log(`[cloudflared stderr] ${data.toString().trim()}`);
    });
  }

  // Give tunnel extra time to establish connection (5 seconds)
  console.log('⏳ Waiting for tunnel to initialize...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Verify tunnel is running with retry logic (up to 60 seconds with exponential backoff)
  await retryWithBackoff(
    async () => {
      const isRunning = await isTunnelRunning();
      if (!isRunning) {
        throw new Error('Tunnel not ready yet');
      }
    },
    {
      maxRetries: 20,
      initialDelay: 2000,
      backoffMultiplier: 1.2, // Gradual backoff
      maxDelay: 5000,
      onRetry: (error, attempt, delay) => {
        console.log(
          `🔍 Checking tunnel status (attempt ${attempt}/20) at ${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp...`,
        );
      },
    },
  );

  console.log('✅ Cloudflared tunnel started successfully');
}

/**
 * Stops the cloudflared tunnel if it was started by this process
 */
export function stopTunnel(): void {
  // Also kill any orphaned processes
  killExistingTunnels();
}
