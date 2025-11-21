import type { Server } from 'node:http';

let mcpServer: Server | null = null;

/**
 * Starts the MCP server programmatically for testing.
 * Requires HEY_JARVIS_MCP_JWT_SECRET to be set.
 */
export async function startMcpServer(): Promise<Server> {
    if (mcpServer) {
        console.log('✅ MCP server already running');
        return mcpServer;
    }

    console.log('🤖 Starting MCP server programmatically...');

    // Dynamically import to avoid issues with module initialization
    const { startMcpServer: start } = await import('../../mastra/mcp-server.js');

    mcpServer = await start();

    console.log('✅ MCP server started successfully');
    return mcpServer;
}

/**
 * Stops the MCP server if it's running
 */
export async function stopMcpServer(): Promise<void> {
    if (mcpServer) {
        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log('⚠️ MCP server shutdown timed out, forcing close');
                resolve();
            }, 3000);

            mcpServer!.close((err) => {
                clearTimeout(timeout);
                if (err) {
                    console.error('❌ Error stopping MCP server:', err);
                    reject(err);
                } else {
                    console.log('🛑 MCP server stopped');
                    resolve();
                }
            });
        });
        mcpServer = null;
    }
}

/**
 * Checks if the MCP server is running
 */
export function isMcpServerRunning(): boolean {
    return mcpServer !== null;
}
