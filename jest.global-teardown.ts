// Extend globalThis with our custom property
declare global {
  var __MCP_SERVER_PID__: number | undefined;
}

export default async function globalTeardown(): Promise<void> {
  console.log('🛑 Stopping MCP server after tests...');

  const mcpServerPid = globalThis.__MCP_SERVER_PID__;

  if (mcpServerPid) {
    try {
      // Kill the process using its PID
      process.kill(mcpServerPid, 'SIGTERM');
      
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
