import { execa, type Subprocess } from 'execa';

// Extend globalThis with our custom property
declare global {
  var __MCP_SERVER_PID__: number | undefined;
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
          output.includes('Available shopping tools')
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

export default async function globalSetup(): Promise<void> {
  console.log('🚀 Starting MCP server before tests...');

  try {
    // Start the MCP server in the background
    const mcpServerProcess = execa('nx', ['serve:mcp', 'mcp'], {
      cleanup: true,
      reject: false, // Don't reject on non-zero exit
    });

    // Store the process PID in globalThis so teardown can access it
    globalThis.__MCP_SERVER_PID__ = mcpServerProcess.pid;

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
  } catch (error) {
    console.error('❌ Failed to start MCP server:', error);
    throw error;
  }
}
