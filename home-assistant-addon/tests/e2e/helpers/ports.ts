/**
 * Centralized Port Configuration for Hey Jarvis Services
 *
 * Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.
 * This configuration must match mcp/lib/ports.sh for consistency.
 */

export const PORTS = {
  // Service ports (internal container ports - behind nginx)
  // Note: mastra dev serves both API and Studio on the same port (4111)
  MASTRA_SERVER: 4111,
  MASTRA_STUDIO: 4111,
  MCP_SERVER: 4112,
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
