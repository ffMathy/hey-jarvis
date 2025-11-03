import { execa, type Subprocess } from 'execa';

export interface MCPServerHandle {
  pid: number;
  process: Subprocess;
}

async function waitForServerReady(
  process: Subprocess,
  timeout = 60000
): Promise<boolean> {
  return new Promise((resolve) => {
    let serverReady = false;
    const startTime = Date.now();

    const checkTimeout = setInterval(() => {
      if (serverReady) {
        clearInterval(checkTimeout);
        resolve(true);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkTimeout);
        resolve(false);
      }
    }, 100);

    // Listen for startup messages
    if (process.stdout) {
      process.stdout.on('data', (data: unknown) => {
        const output = String(data);
        console.log(`[MCP Server]: ${output.trim()}`);

        // Check for MCP server startup indicators
        if (
          output.includes('Starting J.A.R.V.I.S. MCP Server') ||
          output.includes('Available weather tools') ||
          output.includes('Available shopping tools') ||
          output.includes('listening on')
        ) {
          serverReady = true;
        }
      });
    }

    if (process.stderr) {
      process.stderr.on('data', (data: unknown) => {
        console.error(`[MCP Server Error]: ${String(data).trim()}`);
      });
    }
  });
}

/**
 * Start the MCP server for testing
 * Returns a handle that can be used to stop the server
 */
export async function startMCPServer(): Promise<MCPServerHandle> {
  console.log('🚀 Starting MCP server before tests...');

  try {
    // Start the MCP server in the background
    const mcpServerProcess = execa('nx', ['serve:mcp', 'mcp'], {
      cleanup: true,
      reject: false, // Don't reject on non-zero exit
    });

    if (!mcpServerProcess.pid) {
      throw new Error('Failed to get MCP server process PID');
    }

    // Wait for the server to be ready
    const isReady = await waitForServerReady(mcpServerProcess);

    if (!isReady) {
      console.warn(
        '⚠️  MCP server startup not confirmed within timeout, but proceeding with tests...'
      );
    } else {
      console.log('✅ MCP server is ready!');
    }

    // Give it a bit more time to fully initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return {
      pid: mcpServerProcess.pid,
      process: mcpServerProcess,
    };
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error);
    throw error;
  }
}

/**
 * Stop the MCP server
 */
export async function stopMCPServer(handle: MCPServerHandle): Promise<void> {
  console.log('🛑 Stopping MCP server after tests...');

  if (handle.pid) {
    try {
      // Kill the process using its PID
      process.kill(handle.pid, 'SIGTERM');

      // Give it time to gracefully shut down
      await new Promise((resolve) => setTimeout(resolve, 2000));

      console.log('✅ MCP server stopped successfully');
    } catch (error: unknown) {
      // Process was already killed or doesn't exist
      const err = error as { code?: string; message?: string };
      if (err?.code === 'ESRCH') {
        console.log('✅ MCP server already stopped');
      } else {
        console.error('⚠️  Error stopping MCP server:', err?.message);
      }
    }
  } else {
    console.warn('⚠️  No MCP server PID found to stop');
  }
}
