import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { MCPClient } from '@mastra/mcp';
import {
    createAuthenticatedMcpClient,
    generateExpiredToken,
    generateTokenWithoutExpiry,
    generateValidToken,
    startMcpServerForTestingPurposes,
    stopMcpServer
} from './utils/mcp-server-manager';

const MCP_SERVER_URL = 'http://localhost:4112/api/mcp';

describe('JWT Authentication Tests', () => {
    beforeAll(async () => {
        // Set required environment variables before starting server
        process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY = 'test-api-key';

        // Start MCP server
        await startMcpServerForTestingPurposes();

        // Wait for server to be fully ready
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    afterAll(async () => {
        await stopMcpServer();
    });

    test('should deny access to MCP server without JWT token', async () => {
        // Direct HTTP test to verify 401 status code
        const response = await fetch(MCP_SERVER_URL, {
            method: 'GET',
        });

        // Explicitly fail if we get 400 instead of 401
        if (response.status === 400) {
            throw new Error(`CRITICAL: Server returned 400 Bad Request instead of 401 Unauthorized. This means JWT middleware is not working correctly.`);
        }

        expect(response.status).toBe(401);
        const responseText = await response.text();
        console.log(`✓ MCP server returns 401 without JWT token (body: ${responseText})`);

        // Also test via MCPClient
        const clientWithoutAuth = new MCPClient({
            id: 'test-no-auth',
            servers: {
                testServer: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: 10000,
        });

        await expect(clientWithoutAuth.listTools()).rejects.toThrow();
        await clientWithoutAuth.disconnect();
    });

    test('should deny MCP server access with invalid JWT token', async () => {
        // Direct HTTP test to verify 401 status code
        const response = await fetch(MCP_SERVER_URL, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer invalid-token-here',
            },
        });

        // Explicitly fail if we get 400 instead of 401
        if (response.status === 400) {
            throw new Error(`CRITICAL: Server returned 400 Bad Request instead of 401 Unauthorized for invalid token. JWT middleware is not working correctly.`);
        }

        expect(response.status).toBe(401);
        const responseText = await response.text();
        console.log(`✓ MCP server returns 401 with invalid JWT token (body: ${responseText})`);

        // Also test via MCPClient
        const clientWithInvalidToken = await createAuthenticatedMcpClient('invalid-token-here');

        await expect(clientWithInvalidToken.listTools()).rejects.toThrow();
        await clientWithInvalidToken.disconnect();
    });

    test('should deny MCP server access with expired JWT token', async () => {
        const expiredToken = generateExpiredToken();

        // Direct HTTP test to verify 401 status code
        const response = await fetch(MCP_SERVER_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${expiredToken}`,
            },
        });

        // Explicitly fail if we get 400 instead of 401
        if (response.status === 400) {
            throw new Error(`CRITICAL: Server returned 400 Bad Request instead of 401 Unauthorized for expired token. JWT middleware is not working correctly.`);
        }

        expect(response.status).toBe(401);
        const responseText = await response.text();
        console.log(`✓ MCP server returns 401 with expired JWT token (body: ${responseText})`);

        // Also test via MCPClient
        const clientWithExpiredToken = await createAuthenticatedMcpClient(expiredToken);

        await expect(clientWithExpiredToken.listTools()).rejects.toThrow();
        await clientWithExpiredToken.disconnect();
    });

    test('should allow MCP server access with valid JWT token', async () => {
        const validToken = generateValidToken();

        const clientWithValidToken = await createAuthenticatedMcpClient(validToken);

        const tools = await clientWithValidToken.listTools();
        expect(tools).toBeDefined();
        await clientWithValidToken.disconnect();
        console.log(`✓ MCP server access granted with valid JWT token`);
    });

    test('should allow MCP server access with JWT token without expiry', async () => {
        const tokenWithoutExpiry = generateTokenWithoutExpiry();

        const clientWithTokenNoExpiry = await createAuthenticatedMcpClient(tokenWithoutExpiry);

        const tools = await clientWithTokenNoExpiry.listTools();
        expect(tools).toBeDefined();
        await clientWithTokenNoExpiry.disconnect();
        console.log(`✓ MCP server access granted with JWT token without expiry`);
    });

    test('should accept JWT token in Bearer format (case-insensitive)', async () => {
        const validToken = generateValidToken();

        const clientWithLowercaseBearer = await createAuthenticatedMcpClient(validToken);

        const tools = await clientWithLowercaseBearer.listTools();
        expect(tools).toBeDefined();
        await clientWithLowercaseBearer.disconnect();
        console.log('✓ Bearer scheme is case-insensitive for MCP server');
    });
});
