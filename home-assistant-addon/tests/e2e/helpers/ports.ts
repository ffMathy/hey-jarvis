/**
 * Centralized Port Configuration for Hey Jarvis Services
 *
 * Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.
 * This configuration must match mcp/lib/ports.sh for consistency.
 */

export const PORTS = {
  // Service ports (internal container ports - behind nginx)
  MASTRA_SERVER: 8111,
  MCP_SERVER: 8112,
  // Test ingress port (internal container port for nginx proxy)
  TEST_INGRESS_PORT: 5000,

  // Test external ports (different from service ports to avoid devcontainer conflicts)
  // Using offset +10000 to avoid conflicts with devcontainer port forwarding
  TEST_MASTRA_SERVER: 14111,
  TEST_MCP_SERVER: 14112,
  TEST_INGRESS_EXTERNAL_PORT: 15000,
} as const;

/**
 * Get the base URL for Mastra Server
 */
export function getMastraServerUrl(): string {
  return `http://localhost:${PORTS.TEST_MASTRA_SERVER}`;
}

/**
 * Get the base URL for MCP Server
 */
export function getMCPServerUrl(): string {
  return `http://localhost:${PORTS.TEST_MCP_SERVER}`;
}
