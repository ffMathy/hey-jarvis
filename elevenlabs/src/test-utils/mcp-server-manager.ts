import { spawn, ChildProcess } from 'child_process';
import { retryWithBackoff } from './retry-with-backoff';

let mcpServerProcess: ChildProcess | null = null;

/**
 * Checks if the MCP server is already running
 */
async function isMcpServerRunning(): Promise<boolean> {
    try {
        const response = await fetch('http://localhost:4112/api/mcp', {
            method: 'GET',
        });
        console.log('️ MCP server check response:', response.status);
        return response.ok || response.status === 400; // 401 means server is running but needs auth
    } catch {
        return false;
    }
}

/**
 * Ensures the MCP server is running before tests start.
 * If not running, starts it in the background via nx serve:mcp mcp.
 * Environment variables are expected to be already available via op run.
 */
export async function ensureMcpServerRunning(): Promise<void> {
    // Check if MCP server is already running
    if (await isMcpServerRunning()) {
        console.log('✅ MCP server is already running');
        return;
    }

    console.log('🤖 Starting MCP server...');

    // Start MCP server in background using nx serve:mcp
    mcpServerProcess = spawn('bunx', ['nx', 'serve:mcp', 'mcp'], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: '/workspaces/hey-jarvis', // Run from workspace root
    });

    // Log MCP server output
    mcpServerProcess.stdout?.on('data', (data) => {
        console.debug(`[mcp-server] ${data.toString().trim()}`);
    });

    mcpServerProcess.stderr?.on('data', (data) => {
        console.log(`[mcp-server] ${data.toString().trim()}`);
    });

    mcpServerProcess.on('error', (error) => {
        console.error('Failed to start MCP server:', error);
    });

    // Detach the process so it continues running
    mcpServerProcess.unref();

    // Verify MCP server is running with retry logic (up to 30 seconds for server startup)
    await retryWithBackoff(
        async () => {
            const isRunning = await isMcpServerRunning();
            if (!isRunning) {
                throw new Error('MCP server not ready yet');
            }
        },
        {
            maxRetries: 30,
            initialDelay: 1000,
            backoffMultiplier: 1, // Linear retry (1 second between attempts)
            onRetry: (error, attempt, delay) => {
                console.log(`🔍 Checking MCP server status (attempt ${attempt}/30)...`);
            },
        }
    );

    console.log('✅ MCP server started successfully');
}

/**
 * Stops the MCP server if it was started by this process
 */
export function stopMcpServer(): void {
    if (mcpServerProcess && !mcpServerProcess.killed) {
        mcpServerProcess.kill();
        mcpServerProcess = null;
        console.log('🛑 MCP server stopped');
    }
}
