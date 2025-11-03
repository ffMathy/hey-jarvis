import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { MCPClient } from '@mastra/mcp';
import type { MastraMCPServerDefinition } from '@mastra/mcp';
import type { ConversationStrategy, ServerMessage, UserMessageEvent } from './conversation-strategy';
import agentConfig from '../assets/agent-config.json';

export interface GeminiMastraConversationOptions {
    mcpServers?: Record<string, MastraMCPServerDefinition>;
    apiKey?: string;
}

/**
 * Gemini-based implementation of ConversationStrategy using MCP tools
 * Connects Gemini directly to MCP servers for tool calling
 */
export class GeminiMastraConversationStrategy implements ConversationStrategy {
    private mcpClient: MCPClient | null = null;
    private readonly apiKey: string;
    private readonly mcpServers: Record<string, MastraMCPServerDefinition>;
    private messages: ServerMessage[] = [];
    private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

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
        this.conversationHistory = [];

        // Initialize MCP client with provided servers
        if (Object.keys(this.mcpServers).length > 0) {
            this.mcpClient = new MCPClient({
                servers: this.mcpServers,
                timeout: 60000,
            });
        }
    }

    async sendMessage(text: string): Promise<void> {
        // Store the user message
        const userMessage: UserMessageEvent = {
            type: 'user_message',
            text,
        };
        this.messages.push(userMessage as ServerMessage);
        this.conversationHistory.push({ role: 'user', content: text });

        // Get MCP tools if client is configured
        const toolsets = this.mcpClient ? await this.mcpClient.getToolsets() : undefined;

        // Create Google provider instance with API key
        const googleProvider = createGoogleGenerativeAI({
            apiKey: this.apiKey,
        });

        // Call Gemini with conversation history and tools
        const result = await generateText({
            model: googleProvider(agentConfig.conversationConfig.agent.prompt.llm),
            messages: this.conversationHistory.map(msg => ({
                role: msg.role,
                content: msg.content,
            })),
            ...(toolsets ? { toolsets } : {}),
        });

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
        this.conversationHistory.push({ role: 'assistant', content: responseText });

        // Store tool calls if any
        if (result.toolCalls && result.toolCalls.length > 0) {
            for (const toolCall of result.toolCalls) {
                const toolMessage: ServerMessage = {
                    type: 'mcp_tool_call',
                    mcp_tool_call: {
                        tool_name: toolCall.toolName,
                        tool_call_id: toolCall.toolCallId,
                        state: 'success',
                        result: [],
                    },
                };
                this.messages.push(toolMessage);
            }
        }
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
        this.conversationHistory = [];
    }
}

