import { spawn, ChildProcess, execSync } from 'child_process';
import { retryWithBackoff } from 'mcp/tests/utils/retry-with-backoff.js';

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
    // const client = new MCPClient({
    //     id: 'client',
    //     servers: {
    //         testServer: {
    //             url: new URL(`${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp`),
    //         },
    //     },
    //     timeout: 10000,
    // });
    try {
        // await client.listTools();
        const response = await fetch(`${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp`, {
            method: 'GET',
        });
        console.log('️ Tunnel check response:', response.status);
        // 200 = OK, 400 = Bad request (tunnel working), 401 = Unauthorized (tunnel working, JWT required)
        return response.ok || response.status === 400 || response.status === 401;
    } catch {
        return false;
    } finally {
        // await client.disconnect();
    }
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
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for processes to die
    
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
            'Make sure tests are run via: nx test elevenlabs'
        );
    }

    console.log(`🌐 Token length: ${token.length} characters`);

    // Start cloudflared tunnel in background
    tunnelProcess = spawn('cloudflared', ['tunnel', 'run', '--token', token], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Log tunnel output
    tunnelProcess.stdout?.on('data', (data) => {
        console.log(`[cloudflared stdout] ${data.toString().trim()}`);
    });

    tunnelProcess.stderr?.on('data', (data) => {
        console.log(`[cloudflared stderr] ${data.toString().trim()}`);
    });

    tunnelProcess.on('error', (error) => {
        console.error('Failed to start cloudflared tunnel:', error);
    });

    // Detach the process so it continues running
    tunnelProcess.unref();

    // Verify tunnel is running with retry logic (up to 30 seconds)
    await retryWithBackoff(
        async () => {
            const isRunning = await isTunnelRunning();
            if (!isRunning) {
                throw new Error('Tunnel not ready yet');
            }
        },
        {
            maxRetries: 30,
            initialDelay: 1000,
            backoffMultiplier: 1, // Linear retry (1 second between attempts)
            onRetry: (error, attempt, delay) => {
                console.log(`🔍 Checking tunnel status (attempt ${attempt}/30) at ${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp...`);
            },
        }
    );

    console.log('✅ Cloudflared tunnel started successfully');
}

/**
 * Stops the cloudflared tunnel if it was started by this process
 */
export function stopTunnel(): void {
    if (tunnelProcess && !tunnelProcess.killed) {
        try {
            // Kill the entire process group
            process.kill(-tunnelProcess.pid!, 'SIGTERM');
        } catch (err) {
            // Fallback to killing just the process
            tunnelProcess.kill('SIGTERM');
        }
        tunnelProcess = null;
        console.log('🛑 Cloudflared tunnel stopped');
    }
    // Also kill any orphaned processes
    killExistingTunnels();
}
