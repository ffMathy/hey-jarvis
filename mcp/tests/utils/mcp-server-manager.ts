import { MCPClient } from '@mastra/mcp';
import { ChildProcess, spawn } from 'child_process';
import fkill from 'fkill';
import jwt from 'jsonwebtoken';
import { retryWithBackoff } from './retry-with-backoff';

let mcpServerProcess: ChildProcess | null = null;

// JWT secret for authentication (must match server)
const MCP_PORT = 4112;
const MCP_SERVER_URL = 'http://localhost:4112/api/mcp';

/**
 * Kills any process listening on the specified port.
 */
async function killProcessOnPort(port: number): Promise<void> {
    try {
        await fkill(`:${port}`, { force: true, silent: true });
        console.log(`🧹 Killed process(es) on port ${port}`);
    } catch (error) {
        // Silent failure - port may already be free
    }
}

/**
 * Checks if the MCP server is already running
 */
async function isMcpServerRunning(): Promise<boolean> {
    const client = await createAuthenticatedMcpClient();
    try {
        await client.listTools();
        return true;
    } catch (error) {
        return false;
    } finally {
        await client.disconnect();
    }
}

/**
 * Starts the MCP server using nx serve:mcp:tsx target (bypasses 1Password wrapper).
 * Requires HEY_JARVIS_MCP_JWT_SECRET to be set.
 */
export async function startMcpServerForTestingPurposes(): Promise<void> {
    // Kill any existing servers first to ensure clean state
    await killProcessOnPort(MCP_PORT);

    // Set required environment variables for tests
    process.env['HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY'] = process.env['HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY'] || 'test-api-key';

    // Check if MCP server is already running
    if (await isMcpServerRunning()) {
        console.log('✅ MCP server is already running');
        return;
    }

    console.log('🤖 Starting MCP server via nx serve:mcp:tsx...');

    // Start MCP server using nx serve:mcp:tsx target (bypasses 1Password wrapper)
    mcpServerProcess = spawn('bunx', ['nx', 'serve:mcp:tsx', 'mcp'], {
        detached: true,
        stdio: ['ignore', 'inherit', 'inherit'],
        cwd: '/workspaces/hey-jarvis',
        env: {
            ...process.env,
        },
    });

    mcpServerProcess.on('error', (error) => {
        console.error('Failed to start MCP server:', error);
    });

    // Detach the process so it continues running
    mcpServerProcess.unref();

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
            maxRetries: 30,
            initialDelay: 1000,
            backoffMultiplier: 1,
            onRetry: (error, attempt, delayMs) => {
                console.log(`🔍 Checking MCP server status (attempt ${attempt}/30)...`);
            },
        }
    );
}

/**
 * Stops the MCP server if it was started by this process
 */
export async function stopMcpServer(): Promise<void> {
    // Kill process via port - this is most reliable
    await killProcessOnPort(MCP_PORT);
    // Give processes time to clean up
    await new Promise(resolve => setTimeout(resolve, 500));
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
export async function createAuthenticatedMcpClient(token?: string): Promise<MCPClient> {
    // If no token provided, generate a valid token using the function above
    if (!token) {
        token = generateValidToken();
    }

    return new MCPClient({
        id: 'mcp-test-client',
        servers: {
            testServer: {
                url: new URL(MCP_SERVER_URL),
                requestInit: {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                },
            },
        },
        timeout: 10000,
    });
}
