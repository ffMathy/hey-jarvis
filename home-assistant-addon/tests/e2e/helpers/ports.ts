/**
 * Centralized Port Configuration for Hey Jarvis Services
 *
 * Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.
 * This configuration must match mcp/lib/ports.sh for consistency.
 */

export const PORTS = {
  // External ports (exposed by Nginx to the outside)
  MASTRA_UI: 4111,
  MCP_SERVER: 4112,

  // Internal ports (used by backend services, proxied by Nginx)
  MASTRA_UI_INTERNAL: 8111,
  MCP_SERVER_INTERNAL: 8112,

  // Test ingress port (for Home Assistant ingress simulation)
  TEST_INGRESS: 5000,
} as const;

/**
 * Get the base URL for Mastra UI
 */
export function getMastraUIUrl(): string {
  return `http://localhost:${PORTS.MASTRA_UI}`;
}

/**
 * Get the base URL for MCP Server
 */
export function getMCPServerUrl(): string {
  return `http://localhost:${PORTS.MCP_SERVER}`;
}

/**
 * Get the base URL for test ingress
 */
export function getTestIngressUrl(): string {
  return `http://localhost:${PORTS.TEST_INGRESS}`;
}
