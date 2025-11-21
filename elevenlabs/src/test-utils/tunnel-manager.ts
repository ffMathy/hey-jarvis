import { spawn, ChildProcess } from 'child_process';
import { retryWithBackoff } from './retry-with-backoff';

let tunnelProcess: ChildProcess | null = null;

/**
 * Checks if the cloudflared tunnel is already running
 */
async function isTunnelRunning(): Promise<boolean> {
    try {
        const response = await fetch(`https://${process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL}/api/mcp`, {
            method: 'GET',
        });
        console.log('️ Tunnel check response:', response.status);
        return response.ok || response.status === 400;
    } catch {
        return false;
    }
}

/**
 * Ensures the cloudflared tunnel is running before tests start.
 * If not running, starts it in the background.
 * Skips tunnel startup in CI/GitHub Actions environments.
 * Environment variables are expected to be already available via op run.
 */
export async function ensureTunnelRunning(): Promise<void> {
    // Check if tunnel is already running
    if (await isTunnelRunning()) {
        console.log('✅ Cloudflared tunnel is already running');
        return;
    }

    console.log('🌐 Starting cloudflared tunnel...');

    // Get the cloudflared token from environment (provided by op run)
    const token = process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN;
    if (!token) {
        throw new Error(
            'HEY_JARVIS_CLOUDFLARED_TUNNEL_TOKEN environment variable is not set. ' +
            'Make sure tests are run via: nx test elevenlabs'
        );
    }

    // Start cloudflared tunnel in background
    tunnelProcess = spawn('cloudflared', ['tunnel', 'run', '--token', token], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Log tunnel output
    tunnelProcess.stdout?.on('data', (data) => {
        console.debug(`[cloudflared] ${data.toString().trim()}`);
    });

    tunnelProcess.stderr?.on('data', (data) => {
        console.log(`[cloudflared] ${data.toString().trim()}`);
    });

    tunnelProcess.on('error', (error) => {
        console.error('Failed to start cloudflared tunnel:', error);
    });

    // Detach the process so it continues running
    tunnelProcess.unref();

    // Verify tunnel is running with retry logic (up to 10 seconds)
    await retryWithBackoff(
        async () => {
            const isRunning = await isTunnelRunning();
            if (!isRunning) {
                throw new Error('Tunnel not ready yet');
            }
        },
        {
            maxRetries: 10,
            initialDelay: 1000,
            backoffMultiplier: 1, // Linear retry (1 second between attempts)
            onRetry: (error, attempt, delay) => {
                console.log(`🔍 Checking tunnel status (attempt ${attempt}/10)...`);
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
        tunnelProcess.kill();
        tunnelProcess = null;
        console.log('🛑 Cloudflared tunnel stopped');
    }
}
