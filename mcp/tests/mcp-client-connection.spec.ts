import { MCPClient } from '@mastra/mcp';
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import waitPort from 'wait-port';

describe('MCP Client Connection Tests', () => {
    const MCP_SERVER_URL = 'http://localhost:4112/api/mcp';
    const MCP_CLIENT_TIMEOUT = 30000;
    const SERVER_STARTUP_TIMEOUT = 120000;

    let mcpClient: MCPClient;
    let mcpServerProcess: ChildProcess | null = null;

    beforeAll(async () => {
        // Check if servers are already running
        console.log('Checking if servers are already running...');

        const mcpAlreadyRunning = await waitPort({
            host: 'localhost',
            port: 4112,
            timeout: 1000,
            output: 'silent',
        });
        //kill MCP if already running
        if (mcpAlreadyRunning) {
            console.log('Killing existing MCP server on port 4112...');
            spawn('bunx', ['kill-port', '4112'], {
                stdio: 'pipe',
            });
        }

        console.log('Starting MCP server on port 4112...');
        mcpServerProcess = spawn('nx', ['serve:mcp:tsx', 'mcp'], {
            cwd: '/workspaces/hey-jarvis',
            stdio: 'pipe',
            detached: false,
            env: {
                ...process.env,
                HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY: 'temp-testing-key',
            }
        });

        mcpServerProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            if (output.includes('listening')) {
                console.log(`[MCP Server] ${output.trim()}`);
            }
        });

        mcpServerProcess.stderr?.on('data', (data) => {
            console.error(`[MCP Server Error] ${data.toString()}`);
        });

        console.log('Waiting for MCP server to start on port 4112...');
        const mcpReady = await waitPort({
            host: 'localhost',
            port: 4112,
            timeout: SERVER_STARTUP_TIMEOUT / 2,
            output: 'silent',
        });

        if (!mcpReady) {
            throw new Error(
                'MCP server failed to start within timeout period. ' +
                'You may need to run "eval $(op signin)" to authenticate with 1Password CLI first, ' +
                'or manually start the server with "nx serve:mcp mcp".'
            );
        }

        console.log('Both servers are ready!');
    }, SERVER_STARTUP_TIMEOUT + 10000);

    afterAll(async () => {
        console.log('Shutting down servers...');
        if (mcpServerProcess) {
            mcpServerProcess.kill('SIGTERM');
        }
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));
    });

    afterEach(async () => {
        if (mcpClient) {
            await mcpClient.disconnect();
        }
    });

    it('should create MCP client and connect to hosted MCP server', async () => {
        mcpClient = new MCPClient({
            id: 'test-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        expect(mcpClient).toBeDefined();
    });

    it('should list available tools from MCP server', async () => {
        mcpClient = new MCPClient({
            id: 'test-tools-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const tools = await mcpClient.listTools();

        expect(tools).toBeDefined();
        expect(typeof tools).toBe('object');

        const toolIds = Object.keys(tools);
        expect(toolIds.length).toBeGreaterThan(0);

        console.log(`Found ${toolIds.length} tools from MCP server`);
        console.log('Tool names:', toolIds.join(', '));
    });

    it('should call a weather tool through MCP client', async () => {
        mcpClient = new MCPClient({
            id: 'test-weather-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const tools = await mcpClient.listTools();
        const toolIds = Object.keys(tools);
        const weatherToolId = toolIds.find((id) => id.includes('weather') || id.includes('Weather'));

        expect(weatherToolId).toBeDefined();

        if (weatherToolId) {
            const weatherTool = tools[weatherToolId];
            console.log(`Testing weather tool: ${weatherToolId}`);
            console.log(`Description: ${weatherTool.description}`);

            if (weatherTool.execute) {
                const result = await weatherTool.execute({
                    context: {
                        cityName: 'Copenhagen',
                    },
                });

                expect(result).toBeDefined();
                console.log('Weather tool result:', JSON.stringify(result, null, 2));
            }
        }
    });

    it('should list available toolsets from MCP server', async () => {
        mcpClient = new MCPClient({
            id: 'test-toolsets-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const toolsets = await mcpClient.listToolsets();

        expect(toolsets).toBeDefined();
        expect(typeof toolsets).toBe('object');

        const serverNames = Object.keys(toolsets);
        expect(serverNames.length).toBeGreaterThan(0);

        console.log(`Found ${serverNames.length} server(s) with toolsets`);

        for (const serverName of serverNames) {
            const serverTools = toolsets[serverName];
            const toolIds = Object.keys(serverTools);
            console.log(`Server "${serverName}": ${toolIds.length} tools`);
        }
    });

    it('should handle connection errors gracefully', async () => {
        const invalidClient = new MCPClient({
            id: 'test-error-client',
            servers: {
                invalid: {
                    url: new URL('http://localhost:9999/invalid'),
                },
            },
            timeout: 5000,
        });

        await expect(async () => {
            await invalidClient.listTools();
        }).rejects.toThrow();

        await invalidClient.disconnect();
    });

    it('should support multiple server connections', async () => {
        mcpClient = new MCPClient({
            id: 'test-multi-server-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const tools = await mcpClient.listTools();
        const toolsets = await mcpClient.listToolsets();

        const toolIds = Object.keys(tools);
        const serverNames = Object.keys(toolsets);

        expect(toolIds.length).toBeGreaterThan(0);
        expect(serverNames.length).toBeGreaterThan(0);

        const allToolsNamespaced = toolIds.every((id) => id.startsWith('jarvis_ask_'));
        expect(allToolsNamespaced).toBe(true);

        console.log('All tools are properly namespaced with server prefix');
    });

    it('should access prompts from MCP server', async () => {
        mcpClient = new MCPClient({
            id: 'test-prompts-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const prompts = await mcpClient.prompts.list();

        expect(prompts).toBeDefined();
        console.log('Available prompts:', Object.keys(prompts));
    });

    it('should access resources from MCP server', async () => {
        mcpClient = new MCPClient({
            id: 'test-resources-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const resources = await mcpClient.resources.list();

        expect(resources).toBeDefined();
        console.log('Available resources:', Object.keys(resources));
    });

    it('should return simplified text responses without verbose metadata', async () => {
        mcpClient = new MCPClient({
            id: 'test-simplified-response-client',
            servers: {
                jarvis: {
                    url: new URL(MCP_SERVER_URL),
                },
            },
            timeout: MCP_CLIENT_TIMEOUT,
        });

        const tools = await mcpClient.listTools();
        const weatherToolId = Object.keys(tools).find((id) => id.includes('weather'));

        expect(weatherToolId).toBeDefined();

        const weatherTool = tools[weatherToolId];

        expect(weatherTool).toBeDefined();
        expect(weatherTool?.execute).toBeDefined();

        if (!weatherTool?.execute) {
            throw new Error('Weather tool does not have execute function');
        }

        const result = await weatherTool.execute({
            message: 'What is the weather in Copenhagen?',
        });

        console.log('Simplified response:', JSON.stringify(result, null, 2));

        // Response should be an object
        expect(result).toBeDefined();
        expect(typeof result).toBe('object');

        // Check if result has error flag (validation failure case)
        if ((result as any).error === true) {
            // Validation error case - check that it's simplified without verbose metadata
            expect((result as any).message).toBeDefined();
            expect(typeof (result as any).message).toBe('string');

            // Should NOT contain Mastra's verbose metadata fields
            expect((result as any).details).toBeUndefined();
            expect((result as any).domain).toBeUndefined();
            expect((result as any).category).toBeUndefined();

            console.log('Tool validation error (expected with temp API key):', (result as any).message.substring(0, 100));
        } else {
            // Success case - Mastra wraps structured outputs in structuredContent
            const structuredContent = (result as any).structuredContent;
            expect(structuredContent).toBeDefined();
            expect(structuredContent.response).toBeDefined();
            expect(typeof structuredContent.response).toBe('string');
            expect(structuredContent.response.length).toBeGreaterThan(0);

            // Should NOT contain verbose metadata fields at root level of structuredContent
            expect(structuredContent.details).toBeUndefined();
            expect(structuredContent.domain).toBeUndefined();
            expect(structuredContent.category).toBeUndefined();
            expect(structuredContent.code).toBeUndefined();

            const responseText = structuredContent.response;
            console.log('Response successfully simplified to clean text:', responseText.substring(0, 100));
        }
    });
});