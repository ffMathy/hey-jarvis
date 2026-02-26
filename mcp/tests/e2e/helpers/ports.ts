/**
 * Centralized Port Configuration for MCP Docker Tests
 *
 * In the base MCP Docker image, mastra dev serves both the API and Studio UI
 * on port 4111. The MCP server runs on internal port 4112.
 * There is no separate Studio port (3000) in the base image.
 */

export const PORTS = {
  // Internal container ports
  MASTRA_DEV: 4111, // API + Studio UI combined
  MCP_SERVER_INTERNAL: 4112,

  // External test ports (offset +20000 to avoid conflicts)
  TEST_MASTRA_DEV: 24111,
  TEST_MCP_SERVER: 24112,
} as const;
