import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { sign } from 'hono/jwt';
import { startMcpServer, stopMcpServer } from './utils/mcp-server-manager';

const JWT_SECRET = 'test-secret-for-jwt-authentication-minimum-32-chars';
const MCP_SERVER_URL = 'http://localhost:4112';

/**
 * Generate a test JWT token
 */
async function generateTestToken(secret: string, expiresIn = 3600): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: 'test-client',
        iat: now,
        exp: now + expiresIn,
    };
    return await sign(payload, secret);
}

/**
 * Generate an expired JWT token
 */
async function generateExpiredToken(secret: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: 'test-client',
        iat: now - 7200,
        exp: now - 3600,
    };
    return await sign(payload, secret);
}

/**
 * Generate a JWT token without expiry
 */
async function generateTokenWithoutExpiry(secret: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: 'test-client',
        iat: now,
    };
    return await sign(payload, secret);
}

describe('JWT Authentication Tests', () => {
    beforeAll(async () => {
        // Set required environment variables before starting server
        process.env.HEY_JARVIS_MCP_JWT_SECRET = JWT_SECRET;
        process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY = 'test-api-key';
        process.env.PORT = '4112';
        process.env.HOST = '127.0.0.1'; // Force IPv4

        // Start MCP server
        await startMcpServer();

        // Wait for server to be fully ready
        await new Promise(resolve => setTimeout(resolve, 2000));
    }); afterAll(async () => {
        await stopMcpServer();
    });

    test('should deny access to MCP server without JWT token', async () => {
        const response = await fetch(`${MCP_SERVER_URL}/api/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
            }),
        });

        const body = await response.text();
        console.log('Response status:', response.status);
        console.log('Response body:', body);

        expect(response.status).toBe(401);
        console.log(`✓ MCP server access denied without JWT token (status: ${response.status})`);
    }); test('should deny MCP server access with invalid JWT token', async () => {
        const response = await fetch(`${MCP_SERVER_URL}/api/mcp`, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer invalid-token-here',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
            }),
        });

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toBeDefined();
        console.log(`✓ MCP server access denied with invalid JWT token (status: ${response.status})`);
    });

    test('should deny MCP server access with expired JWT token', async () => {
        const expiredToken = await generateExpiredToken(JWT_SECRET);

        const response = await fetch(`${MCP_SERVER_URL}/api/mcp`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${expiredToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
            }),
        });

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toBeDefined();
        console.log(`✓ MCP server access denied with expired JWT token (status: ${response.status})`);
    });

    test('should allow MCP server access with valid JWT token', async () => {
        const validToken = await generateTestToken(JWT_SECRET);

        const response = await fetch(`${MCP_SERVER_URL}/api/mcp`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${validToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
            }),
        });

        expect(response.status).not.toBe(401);
        console.log(`✓ MCP server access granted with valid JWT token (status: ${response.status})`);
    });

    test('should allow MCP server access with JWT token without expiry', async () => {
        const tokenWithoutExpiry = await generateTokenWithoutExpiry(JWT_SECRET);

        const response = await fetch(`${MCP_SERVER_URL}/api/mcp`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${tokenWithoutExpiry}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
            }),
        });

        expect(response.status).not.toBe(401);
        console.log(`✓ MCP server access granted with JWT token without expiry (status: ${response.status})`);
    });

    test('should accept JWT token in Bearer format (case-insensitive)', async () => {
        const validToken = await generateTestToken(JWT_SECRET);

        const response = await fetch(`${MCP_SERVER_URL}/api/mcp`, {
            method: 'POST',
            headers: {
                Authorization: `bearer ${validToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'tools/list',
                id: 1,
            }),
        });

        expect(response.status).not.toBe(401);
        console.log('✓ Bearer scheme is case-insensitive for MCP server');
    });
});

describe('JWT Authentication Required Tests', () => {
    test('should throw error when starting server without JWT secret', async () => {
        // Clear JWT secret
        const originalSecret = process.env.HEY_JARVIS_MCP_JWT_SECRET;
        delete process.env.HEY_JARVIS_MCP_JWT_SECRET;

        try {
            // Attempt to import and start server should throw
            const { startMcpServer: start } = await import('../mastra/mcp-server.js');

            let error: Error | null = null;
            try {
                await start();
            } catch (e) {
                error = e as Error;
            }

            expect(error).not.toBeNull();
            expect(error?.message).toContain('HEY_JARVIS_MCP_JWT_SECRET');
            console.log('✓ Server correctly refuses to start without JWT secret');
        } finally {
            // Restore JWT secret
            process.env.HEY_JARVIS_MCP_JWT_SECRET = originalSecret;
        }
    });
});
