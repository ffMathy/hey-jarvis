import { type ChildProcess, spawn, spawnSync } from 'child_process';
import { isMcpServerRunning } from '../../../mcp/tests/utils/mcp-server-manager.js';
import { retryWithBackoff } from '../../../mcp/tests/utils/retry-with-backoff.js';
import { cloudflareAccessHeaders } from './cloudflare-access.js';

let tunnelProcess: ChildProcess | null = null;

const TUNNEL_REQUEST_TIMEOUT_MS = 10000;

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
 * Checks if the cloudflared tunnel actually serves the MCP endpoint.
 */
async function isTunnelRunning(): Promise<boolean> {
  return await isMcpServerRunning({
    url: `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL!}/api/mcp`,
    healthTimeoutMs: TUNNEL_REQUEST_TIMEOUT_MS,
    headers: cloudflareAccessHeaders(),
  });
}

/**
 * Checks tunnel connectivity via health endpoint (doesn't require JWT).
 * Cloudflare answers with its own error pages while the tunnel is down, so the
 * body has to confirm our MCP server is the one on the other end.
 */
async function checkTunnelHealth(): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
  rejectedByAccess?: boolean;
}> {
  const healthUrl = `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/health`;
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: cloudflareAccessHeaders(),
      signal: AbortSignal.timeout(TUNNEL_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      return { ok: false as const, status: response.status, error: `HTTP ${response.status}` };
    }

    // Cloudflare Access answers a request it will not let through with its own
    // page, and a login page is still a 200. Saying so beats letting the JSON
    // parse fail and reporting that instead.
    const contentType = response.headers.get('content-type') ?? 'none';
    if (!contentType.includes('application/json')) {
      const sentServiceToken = Object.keys(cloudflareAccessHeaders()).length > 0;
      return {
        ok: false as const,
        status: response.status,
        error:
          `expected JSON from /health but got ${contentType}, which is what Cloudflare Access serves ` +
          `when it does not accept the request (service token sent: ${sentServiceToken}). ` +
          `Check that the Access policy's action is Service Auth and that it includes this token.`,
        rejectedByAccess: true,
      };
    }

    const data = (await response.json()) as { status?: string };
    if (data.status !== 'healthy') {
      return { ok: false as const, status: response.status, error: `Unexpected health payload: ${data.status}` };
    }

    return { ok: true as const, status: response.status };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Reports what the MCP endpoint answers through the public hostname.
 *
 * A healthy /health only proves the tunnel reaches the origin for a path nothing
 * guards. ElevenLabs connects to /api/mcp instead, and its status here separates
 * the possibilities: 401 or 403 is something at the edge refusing the request,
 * 404 is the wrong path, 5xx is Cloudflare with no connector to talk to.
 */
async function reportTunnelMcpEndpoint(): Promise<void> {
  const mcpUrl = `${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp`;
  const [result] = await Promise.allSettled([
    fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...cloudflareAccessHeaders(),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      signal: AbortSignal.timeout(TUNNEL_REQUEST_TIMEOUT_MS),
    }),
  ]);

  if (result.status !== 'fulfilled') {
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.log(`🔍 MCP endpoint through the tunnel: request failed (${reason})`);
    return;
  }

  console.log(`🔍 MCP endpoint through the tunnel answered ${result.value.status}`);
}

/**
 * Ensures the cloudflared tunnel is running before tests start: replaces any
 * existing connector with one of our own and waits until the tunnel actually
 * serves the local MCP server.
 * Environment variables are expected to be already available via op run.
 */
export async function ensureTunnelRunning(): Promise<void> {
  // Kill any existing tunnels first to ensure clean state
  killExistingTunnels();
  await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for processes to die

  // First, verify the local MCP server is healthy
  console.log('🔍 Checking local MCP server health...');
  const localHealthy = await isLocalMcpServerHealthy();
  if (!localHealthy) {
    console.log('⚠️ Local MCP server is NOT healthy - tunnel may fail to connect');
  } else {
    console.log('✅ Local MCP server is healthy at http://localhost:4112');
  }

  // No connector survives killExistingTunnels(), so the tunnel always has to be
  // started here. Anything still answering on the hostname would be a connector
  // on another machine, which would route the agent away from the MCP server
  // these tests just started.
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

  // Verify tunnel is running with retry logic (up to 60 seconds with longer waits)
  await retryWithBackoff(
    async () => {
      // Check tunnel health first (doesn't require JWT)
      const healthResult = await checkTunnelHealth();
      if (healthResult.ok) {
        console.log(`✅ Tunnel health check passed (status: ${healthResult.status})`);
        return;
      }

      // Access decides on the credentials presented, and those do not improve by
      // being offered again — so stop rather than spend a minute proving it.
      if (healthResult.rejectedByAccess) {
        throw new Error(`Tunnel reachable but Access refused the request: ${healthResult.error}`);
      }

      // If health check fails, try the MCP endpoint (requires JWT)
      const isRunning = await isTunnelRunning();
      if (isRunning) {
        return;
      }

      throw new Error(`Tunnel not ready: ${healthResult.error || 'Unknown error'}`);
    },
    {
      maxRetries: 60,
      initialDelay: 1000,
      backoffMultiplier: 1, // Linear retry (1 second between attempts)
      shouldRetry: (error) => !error.message.startsWith('Tunnel reachable but Access refused'),
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

  // /health passing says the tunnel reaches the origin; this says whether the
  // endpoint ElevenLabs actually needs is reachable the same way.
  await reportTunnelMcpEndpoint();
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
