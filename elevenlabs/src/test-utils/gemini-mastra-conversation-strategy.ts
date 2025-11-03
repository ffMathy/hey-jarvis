import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { MCPClient } from '@mastra/mcp';
import type { MastraMCPServerDefinition } from '@mastra/mcp';
import type { ConversationStrategy, ServerMessage, UserMessageEvent } from './conversation-strategy';
import agentConfig from '../assets/agent-config.json';
import { readFile } from 'fs/promises';
import { Agent } from '@mastra/core/agent';
import type { MastraMessageV3, MessageInput, MessageListInput } from '@mastra/core/dist/agent/message-list';
import { cwd } from 'process';

export interface GeminiMastraConversationOptions {
    mcpServers?: Record<string, MastraMCPServerDefinition>;
    apiKey?: string;
}

/**
 * Gemini-based implementation of ConversationStrategy using MCP tools
 * Connects Gemini directly to MCP servers for tool calling
 */
export class GeminiMastraConversationStrategy implements ConversationStrategy {
    private mcpClient: MCPClient;
    private readonly apiKey: string;
    private readonly mcpServers: Record<string, MastraMCPServerDefinition>;
    private messages: ServerMessage[] = [];
    private isConnected = false;

    constructor(options: GeminiMastraConversationOptions = {}) {
        this.apiKey = options.apiKey || process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || '';
        this.mcpServers = options.mcpServers || {};

        if (!this.apiKey) {
            throw new Error('Google API key required: set HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY or pass apiKey');
        }
    }

    async connect(): Promise<void> {
        // Clear state from any previous connection
        this.messages = [];

        // Initialize MCP client with provided servers
        this.mcpClient = new MCPClient({
            servers: this.mcpServers,
            timeout: 60000,
        });

        this.isConnected = true;
    }

    async sendMessage(text: string): Promise<string> {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Store the user message
        const userMessage: UserMessageEvent = {
            type: 'user_message',
            text,
        };
        this.messages.push(userMessage as ServerMessage);

        // Get MCP tools if client is configured
        const toolsets = await this.mcpClient.getToolsets();

        // Create Google provider instance with API key
        const googleProvider = createGoogleGenerativeAI({
            apiKey: this.apiKey,
        });

        const agentPrompt = await readFile("./elevenlabs/src/assets/agent-prompt.md", 'utf-8');
        const agent = new Agent({
            name: 'J.A.R.V.I.S.',
            instructions: agentPrompt,
            model: googleProvider(agentConfig.conversationConfig.agent.prompt.llm),
            tools: toolsets,
        });

        // Call Gemini with conversation history and tools
        const result = await agent.generate(this.messages.map((x, i) => ({
            createdAt: new Date(),
            type: 'text',
            id: i.toString(),
            content: text,
            role: x.type === 'user_message' ? 
                'user' as const : 
                (x.type === 'agent_tool_response' ? 
                    'tool' as const :
                    'assistant' as const),
        } as MessageInput)));

        // Extract the response text
        const responseText = result.text || '';

        // Store the agent response in ElevenLabs format
        const agentResponse: ServerMessage = {
            type: 'agent_response',
            agent_response_event: {
                agent_response: responseText,
            },
        };
        this.messages.push(agentResponse);

        // Store tool calls if any
        if (result.toolResults && result.toolResults.length > 0) {
            for (const toolCall of result.toolResults) {
                const toolMessage: ServerMessage = {
                    type: 'mcp_tool_call',
                    mcp_tool_call: {
                        tool_name: JSON.stringify(toolCall),
                        tool_call_id: toolCall.runId,
                        state: 'success',
                        result: [],
                    },
                };
                this.messages.push(toolMessage);
            }
        }

        return responseText;
    }

    getMessages(): ServerMessage[] {
        return [...this.messages];
    }

    getTranscriptText(): string {
        return this.messages
            .map((msg) => {
                if (msg.type === 'user_message') {
                    return `> USER: ${(msg as UserMessageEvent).text}`;
                } else if (msg.type === 'agent_response') {
                    return `> AGENT: ${msg.agent_response_event.agent_response.trim()}`;
                } else if (
                    msg.type === 'mcp_tool_call' &&
                    msg.mcp_tool_call.state === 'success'
                ) {
                    return `> TOOL: ${msg.mcp_tool_call.tool_name} → ${JSON.stringify(msg.mcp_tool_call.result)}`;
                }
                return '';
            })
            .filter((x) => !!x)
            .join('\n');
    }

    async disconnect(): Promise<void> {
        if (this.mcpClient) {
            await this.mcpClient.disconnect();
        }
        this.mcpClient = null;
        this.messages = [];
        this.isConnected = false;
    }
}

