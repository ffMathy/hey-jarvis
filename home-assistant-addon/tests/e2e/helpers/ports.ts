/**
 * Centralized Port Configuration for Hey Jarvis Services
 *
 * Follow DRY (Don't Repeat Yourself) principle - update ports here, not in individual files.
 * This configuration must match mcp/lib/ports.sh for consistency.
 */

export const PORTS = {
  // Service ports (exposed directly by Node.js services)
  MASTRA_UI: 4111,
  MCP_SERVER: 4112,
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
