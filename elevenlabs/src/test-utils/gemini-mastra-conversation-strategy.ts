import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ConversationStrategy, ServerMessage, UserMessageEvent } from './conversation-strategy.js';
import agentConfig from '../assets/agent-config.json';
import { readFile } from 'fs/promises';
import { Agent } from '@mastra/core/agent';

// eslint-disable-next-line @nx/enforce-module-boundaries
import { getPublicAgents } from 'mcp/mastra/mcp-server.js';

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
    private agent?: Agent;

    constructor(options: GeminiMastraConversationOptions = {}) {
        this.apiKey = options.apiKey || process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || '';

        if (!this.apiKey) {
            throw new Error('Google API key required: set HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY or pass apiKey');
        }
    }

    async connect(): Promise<void> {
        // Clear state from any previous connection
        this.messages = [];
        this.agent = undefined; // Reset agent on new connection

        this.isConnected = true;
    }

    private async getJarvisAgent(): Promise<Agent> {
        if (!this.agent) {
            // Create Google provider instance with API key
            const googleProvider = createGoogleGenerativeAI({
                apiKey: this.apiKey,
            });

            const agentPrompt = await this.readAgentPrompt();
            const agents = await getPublicAgents();
            
            this.agent = new Agent({
                name: 'J.A.R.V.I.S.',
                instructions: agentPrompt,
                model: googleProvider(agentConfig.conversationConfig.agent.prompt.llm),
                agents,
                tools: {},
                workflows: {},
                inputProcessors: [],
                outputProcessors: [],
            });
        }
        
        return this.agent;
    }

    async sendMessage(text: string): Promise<string> {
        if (!this.isConnected) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Get or create the agent
        const agent = await this.getJarvisAgent();

        // Store the user message
        const userMessage = {
            type: 'user_message',
            text,
        } as ServerMessage;
        this.messages.push(userMessage);

        // Call Gemini with conversation history and tools
        const result = await agent.generate(({
            createdAt: new Date(),
            type: 'text',
            id: "message-" + this.messages.length.toString(),
            content: userMessage.type === 'user_message' 
                ? userMessage.text 
                : (userMessage.type === 'agent_response' 
                    ? userMessage.agent_response_event.agent_response 
                    : JSON.stringify(userMessage)),
            role: userMessage.type === 'user_message' ? 
                'user' as const : 
                (userMessage.type === 'agent_tool_response' ? 
                    'tool' as const :
                    'assistant' as const),
        }) as any, {
            modelSettings: { temperature: 0 }
        });

        // Extract the response text - await it in case it's a promise from streaming
        // Awaiting a non-promise value just returns the value immediately
        const responseText = (await result.text) || '';

        if(responseText) {
            // Store the agent response in ElevenLabs format
            const agentResponse: ServerMessage = {
                type: 'agent_response',
                agent_response_event: {
                    agent_response: responseText,
                },
            };
            this.messages.push(agentResponse);
        }

        // Handle async tool execution pattern
        if (result.toolResults && result.toolResults.length > 0) {
            for (const toolCall of result.toolResults) {
                // Step 1: Emit "in_progress" response and let agent react
                const inProgressResult = {
                    status: 'in_progress',
                    message: 'Executing the task in the background. Result will be reported later.'
                };
                
                const inProgressMessage: ServerMessage = {
                    type: 'mcp_tool_call',
                    mcp_tool_call: {
                        tool_name: toolCall.payload.toolName,
                        tool_call_id: toolCall.runId + '_in_progress',
                        state: 'success',
                        result: [JSON.stringify(inProgressResult)],
                    },
                };
                this.messages.push(inProgressMessage);
                
                // Let the agent react to the in_progress message
                const inProgressReaction = await agent.generate(({
                    createdAt: new Date(),
                    type: 'text',
                    id: "tool-in-progress-" + toolCall.runId,
                    content: JSON.stringify(inProgressResult),
                    role: 'tool' as const,
                }) as any, {
                    modelSettings: { temperature: 0 }
                });
                
                const inProgressResponseText = (await inProgressReaction.text) || '';
                if (inProgressResponseText) {
                    const inProgressAgentResponse: ServerMessage = {
                        type: 'agent_response',
                        agent_response_event: {
                            agent_response: inProgressResponseText,
                        },
                    };
                    this.messages.push(inProgressAgentResponse);
                }
                
                // Step 2: Emit the actual tool result and let agent react
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
                
                // Let the agent react to the actual result
                const actualReaction = await agent.generate(({
                    createdAt: new Date(),
                    type: 'text',
                    id: "tool-result-" + toolCall.runId,
                    content: toolCall.payload.result['text'],
                    role: 'tool' as const,
                }) as any, {
                    modelSettings: { temperature: 0 }
                });
                
                const actualResponseText = (await actualReaction.text) || '';
                if (actualResponseText) {
                    const actualAgentResponse: ServerMessage = {
                        type: 'agent_response',
                        agent_response_event: {
                            agent_response: actualResponseText,
                        },
                    };
                    this.messages.push(actualAgentResponse);
                }
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
        this.agent = undefined;
        this.isConnected = false;
    }
}

