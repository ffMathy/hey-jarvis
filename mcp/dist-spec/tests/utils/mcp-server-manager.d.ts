import { MCPClient } from '@mastra/mcp';
/**
 * Checks if the MCP server is already running
 */
export declare function isMcpServerRunning(args?: AuthenticatedMcpClientArgs): Promise<boolean>;
/**
 * Starts the MCP server using run-with-env.sh directly with tsx.
 * This ensures environment variables are properly loaded from 1Password CLI.
 * CRITICAL: Must use run-with-env.sh to load secrets, but call tsx directly to avoid nested NX processes.
 */
export declare function startMcpServerForTestingPurposes(): Promise<void>;
/**
 * Stops the MCP server if it was started by this process
 */
export declare function stopMcpServer(): Promise<void>;
/**
 * Checks if the MCP server is running (for external use)
 */
export declare function isMcpServerRunningSync(): boolean;
/**
 * Generate a valid JWT token for testing
 */
export declare function generateValidToken(expiresIn?: number): string;
/**
 * Generate an expired JWT token for testing
 */
export declare function generateExpiredToken(): string;
/**
 * Generate a JWT token without expiry for testing
 */
export declare function generateTokenWithoutExpiry(): string;
/**
 * Creates an authenticated MCP client with a JWT token.
 * If no token is provided, generates a valid JWT signed with the secret.
 */
type AuthenticatedMcpClientArgs = {
  token?: string;
  url?: string;
};
export declare function createAuthenticatedMcpClient(args?: AuthenticatedMcpClientArgs): Promise<MCPClient>;
//# sourceMappingURL=mcp-server-manager.d.ts.map
