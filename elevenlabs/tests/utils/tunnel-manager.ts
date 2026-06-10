import { type ChildProcess, spawn, spawnSync } from 'child_process';
import { isMcpServerRunning } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { retryWithBackoff } from '../../../mcp/tests/utils/retry-with-backoff.js';

let tunnelProcess: ChildProcess | null = null;

/**
 * Kills all existing cloudflared processes
 */
function killExistingTunnels(): void {
  // Use spawnSync so cleanup never throws when no process matches or pkill is signaled.
  spawnSync('pkill', ['-f', 'cloudflared'], { stdio: 'ignore' });
  console.log('🧹 Killed any existing cloudflared processes');
}

/**
 * Checks if the local MCP server is healthy via the /health endpoint.
 * This verifies the origin server is running before checking the tunnel.
 */
async function isLocalMcpServerHealthy(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:4112/health', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const data = (await response.json()) as { status: string };
    return response.ok && data.status === 'healthy';
  } catch {
    return false;
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
 * Checks tunnel connectivity via health endpoint (doesn't require JWT)
 */
async function checkTunnelHealth(): Promise<{ ok: boolean; status?: number; error?: string }> {
  const healthUrl = `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/health`;
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      return { ok: true as const, status: response.status };
    }
    return { ok: false as const, status: response.status, error: `HTTP ${response.status}` };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ensures the cloudflared tunnel is running before tests start.
 * If not running, starts it in the background.
 * Environment variables are expected to be already available via op run.
 */
export async function ensureTunnelRunning(): Promise<void> {
  // Kill any existing tunnels first to ensure clean state
  killExistingTunnels();
  await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for processes to die

  // First, verify the local MCP server (the tunnel's origin) is healthy
  console.log('🔍 Checking local MCP server health...');
  const localHealthy = await isLocalMcpServerHealthy();
  if (!localHealthy) {
    console.log('⚠️ Local MCP server is NOT healthy - tunnel may fail to connect');
  } else {
    console.log('✅ Local MCP server is healthy at http://localhost:4112');
  }

  // NOTE: We intentionally do NOT early-return on an "is the tunnel already up?" probe here.
  // killExistingTunnels() above has just torn down any local connector, but the public Cloudflare
  // hostname can still briefly answer for a moment (edge propagation lag) — a dying connector may
  // serve a single request before it fully disappears. That produced a false-positive
  // "already running" result, so a fresh connector was never started and the entire suite ran with
  // no live tunnel, every agent tool call hitting Cloudflare Error 1033. Always start a fresh
  // connector and verify it end-to-end below instead.
  console.log('🌐 Starting cloudflared tunnel...');
  console.log(`🌐 Tunnel URL: ${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}`);

  // Get the cloudflared token from environment (provided by op run)
  const token = process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN;
  if (!token) {
    throw new Error(
      'HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN environment variable is not set. ' +
        'Make sure tests are run via: bunx turbo test --filter=elevenlabs',
    );
  }

  console.log(`🌐 Token length: ${token.length} characters`);

  // Start cloudflared tunnel in background with HTTP2 protocol (more reliable than QUIC)
  // Using --protocol http2 to avoid UDP/QUIC blocking issues in some network environments
  tunnelProcess = spawn('cloudflared', ['tunnel', '--protocol', 'http2', 'run', '--token', token], {
    detached: false,
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  tunnelProcess.on('error', (error) => {
    console.error('❌ Cloudflared process error:', error.message);
  });

  tunnelProcess.on('exit', (code, signal) => {
    if (code !== 0) {
      console.error(`❌ Cloudflared exited with code ${code}, signal ${signal}`);
    }
  });

  // Verify the tunnel is reachable end-to-end with retry logic (up to 60 seconds with longer waits).
  // A freshly started connector takes time to register with Cloudflare's edge; until it does, the
  // public hostname returns Error 1033 (HTTP 530), which checkTunnelHealth() reports as not-ok.
  await retryWithBackoff(
    async () => {
      // /health passes only once Cloudflare can actually reach the origin through the connector.
      const healthResult = await checkTunnelHealth();
      if (!healthResult.ok) {
        throw new Error(`Tunnel not ready: ${healthResult.error || `HTTP ${healthResult.status}`}`);
      }

      // Additionally confirm the MCP endpoint itself is reachable through the tunnel. This is the
      // exact capability the ElevenLabs agent depends on to list and call tools — verifying it here
      // prevents declaring success on a connector that answers /health but cannot yet serve MCP.
      if (!(await isTunnelRunning())) {
        throw new Error('Tunnel /health is up but the MCP endpoint is not reachable through the tunnel yet');
      }

      console.log(`✅ Tunnel verified end-to-end (health status: ${healthResult.status}, MCP reachable)`);
    },
    {
      maxRetries: 60,
      initialDelay: 1000,
      backoffMultiplier: 1, // Linear retry (1 second between attempts)
      onRetry: (error, attempt, _delay) => {
        // Log extra diagnostics every 10 attempts
        if (attempt % 10 === 0) {
          console.log(`🔍 Tunnel diagnostics (attempt ${attempt}/60):`);
          console.log(`   - Error: ${error.message}`);
          console.log(`   - Process running: ${tunnelProcess && !tunnelProcess.killed}`);
          void (async () => {
            const healthy = await isLocalMcpServerHealthy();
            console.log(`   - Local MCP server healthy: ${healthy}`);
          })();
        } else {
          console.log(
            `🔍 Checking tunnel status (attempt ${attempt}/60) at ${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}...`,
          );
        }
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

/**
 * Starts the tunnel and keeps it running until interrupted.
 * Used when running this file directly via `bun tunnel-manager.ts`
 */
async function runStandalone(): Promise<void> {
  console.log('🚀 Starting cloudflared tunnel in standalone mode...');

  await ensureTunnelRunning();

  console.log('✅ Tunnel is running. Press Ctrl+C to stop.');

  // Keep the process running until interrupted
  await new Promise<void>((resolve) => {
    process.on('SIGINT', () => {
      console.log('\n🛑 Received SIGINT, stopping tunnel...');
      stopTunnel();
      resolve();
    });
    process.on('SIGTERM', () => {
      console.log('\n🛑 Received SIGTERM, stopping tunnel...');
      stopTunnel();
      resolve();
    });
  });
}

// Detect if this file is being run directly
if (import.meta.main) {
  void (async () => {
    try {
      await runStandalone();
    } catch (error) {
      console.error('❌ Failed to start tunnel:', error);
      process.exit(1);
    }
  })();
}
