// Mock for MCP server to avoid loading all dependencies during testing
export const publicAgents = Promise.resolve({
  coding: {},
  weather: {},
  shopping: {},
});

export async function startMcpServer() {
  // Mock implementation
}
