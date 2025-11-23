/**
 * Centralized Port Configuration for Hey Jarvis Services
 *
 * Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.
 * This configuration must match mcp/lib/ports.sh for consistency.
 */

export const PORTS = {
  // Service ports (internal container ports)
  MASTRA_UI: 4111,
  MCP_SERVER: 4112,

  // Test external ports (different from service ports to avoid devcontainer conflicts)
  // Using offset +10000 to avoid conflicts with devcontainer port forwarding
  TEST_MASTRA_UI: 14111,
  TEST_MCP_SERVER: 14112,
} as const;

/**
 * Get the base URL for Mastra UI
 */
export function getMastraUIUrl(): string {
  return `http://localhost:${PORTS.TEST_MASTRA_UI}`;
}

/**
 * Get the base URL for MCP Server
 */
export function getMCPServerUrl(): string {
  return `http://localhost:${PORTS.TEST_MCP_SERVER}`;
}
