import { MCPClient } from '@mastra/mcp';
import jwt from 'jsonwebtoken';
import { createAuthenticatedMcpClient, startMcpServerForTestingPurposes, stopMcpServer } from './utils/mcp-server-manager';

const JWT_SECRET = 'test-secret-for-jwt-authentication-minimum-32-chars';
const MCP_SERVER_URL = 'http://localhost:4112/api/mcp';
const SERVER_STARTUP_TIMEOUT = 120000;

/**
 * Generate a JWT token for MCP server authentication
 */
function generateJwtToken(): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: 'mcp-client-test',
        iat: now,
        exp: now + 3600, // 1 hour expiry
    };
    return jwt.sign(payload, JWT_SECRET);
}

describe('MCP Server Connection Tests', () => {
    let jwtToken: string;
    let mcpClient: MCPClient | null = null;

    beforeAll(async () => {
        // Set required environment variables
        process.env.HEY_JARVIS_MCP_JWT_SECRET = JWT_SECRET;
        process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY = 'temp-testing-key';
        process.env.PORT = '4112';
        process.env.HOST = '127.0.0.1';

        console.log('Starting MCP server programmatically...');
        await startMcpServerForTestingPurposes();

        // Wait for server to be fully ready
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate JWT token for all tests
        jwtToken = generateJwtToken();

        console.log('MCP server is ready!');
    }, SERVER_STARTUP_TIMEOUT);

    afterAll(async () => {
        console.log('Shutting down servers...');
        if (mcpClient) {
            await mcpClient.disconnect();
        }
        await stopMcpServer();
    });

    afterEach(async () => {
        if (mcpClient) {
            await mcpClient.disconnect();
            mcpClient = null;
        }
    });

    it('should reject connections without JWT token', async () => {
        // Try to create MCPClient without authentication
        const clientWithoutAuth = new MCPClient({
            id: 'test-no-auth',
            servers: {
                testServer: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
        });

        // Attempt to get tools should fail
        await expect(clientWithoutAuth.listTools()).rejects.toThrow();
        await clientWithoutAuth.disconnect();
        console.log(`✓ MCP server correctly rejects connections without JWT token`);
    });

    it('should establish connection with valid JWT token', async () => {
        mcpClient = await createAuthenticatedMcpClient(jwtToken);

        // Getting tools successfully means connection was established
        const tools = await mcpClient.listTools();
        expect(tools).toBeDefined();
        console.log(`✓ MCP server accepted JWT token and established connection`);
    });

    it('should list available tools with JWT authentication', async () => {
        mcpClient = await createAuthenticatedMcpClient(jwtToken);

        const tools = await mcpClient.listTools();
        expect(tools).toBeDefined();
        expect(Object.keys(tools).length).toBeGreaterThan(0);
        console.log(`✓ MCP server returned ${Object.keys(tools).length} tools`);
    });

    it('should handle connection errors gracefully', async () => {
        const clientWithBadUrl = new MCPClient({
            id: 'test-bad-url',
            servers: {
                invalidServer: {
                    url: new URL('http://localhost:9999/invalid'),
                },
            },
            timeout: 5000, // Short timeout for this test
        });

        await expect(clientWithBadUrl.listTools()).rejects.toThrow();
        await clientWithBadUrl.disconnect();
        console.log('✓ Connection errors handled gracefully');
    });
});
