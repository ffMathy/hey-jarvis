import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ConversationStrategy, ServerMessage, UserMessageEvent } from './conversation-strategy.js';
import agentConfig from '../assets/agent-config.json';
import { readFile } from 'fs/promises';
import { Agent } from '@mastra/core/agent';

export interface GeminiMastraConversationOptions {
    apiKey?: string;
}

/**
 * Gemini-based implementation of ConversationStrategy using MCP tools
 * Connects Gemini directly to MCP servers for tool calling
 */
export class GeminiMastraConversationStrategy implements ConversationStrategy {
    private readonly apiKey: string;
    private messages: ServerMessage[] = [];
    private isConnected = false;

    constructor(options: GeminiMastraConversationOptions = {}) {
        this.apiKey = options.apiKey || process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || '';

        if (!this.apiKey) {
            throw new Error('Google API key required: set HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY or pass apiKey');
        }
    }

    async connect(): Promise<void> {
        // Clear state from any previous connection
        this.messages = [];

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

        // Create Google provider instance with API key
        const googleProvider = createGoogleGenerativeAI({
            apiKey: this.apiKey,
        });

        const agentPrompt = await this.readAgentPrompt();
        
        // Dynamically import publicAgents to avoid loading mcp-server at module initialization
        // This allows tests to skip without triggering ESM import errors
        // eslint-disable-next-line @nx/enforce-module-boundaries
        const { publicAgents } = await import('mcp/mastra/mcp-server.js');
        const agents = await publicAgents;
        
        const agent = new Agent({
            name: 'J.A.R.V.I.S.',
            instructions: agentPrompt,
            model: googleProvider(agentConfig.conversationConfig.agent.prompt.llm),
            agents, // No sub-agents needed for testing
            tools: {},
            workflows: {}
        });

        // Call Gemini with conversation history and tools
        const result = await agent.generate(this.messages.map((x, i) => ({
            createdAt: new Date(),
            type: 'text',
            id: "message-" + i.toString(),
            content: x.type === 'user_message' 
                ? (x as UserMessageEvent).text 
                : (x.type === 'agent_response' 
                    ? x.agent_response_event.agent_response 
                    : JSON.stringify(x)),
            role: x.type === 'user_message' ? 
                'user' as const : 
                (x.type === 'agent_tool_response' ? 
                    'tool' as const :
                    'assistant' as const),
        }) as any), {
            modelSettings: { temperature: 0 }
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

        // Store tool calls if any
        if (result.toolResults && result.toolResults.length > 0) {
            for (const toolCall of result.toolResults) {
                const toolMessage: ServerMessage = {
                    type: 'mcp_tool_call',
                    mcp_tool_call: {
                        tool_name: toolCall.payload.toolName,
                        tool_call_id: toolCall.runId,
                        state: 'success',
                        result: [toolCall.payload.result['text']],
                    },
                };
                this.messages.push(toolMessage);
            }
        }

        return responseText;
    }

    private async readAgentPrompt() {
        const agentPrompt = await readFile("./elevenlabs/src/assets/agent-prompt.md", 'utf-8');
        const replacedAgentPrompt = agentPrompt
            .replace('{{system__time_utc}}', new Date().toISOString())
            .replace('{{system__time}}', new Date().toISOString());
        return replacedAgentPrompt;
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
        this.messages = [];
        this.isConnected = false;
    }
}

