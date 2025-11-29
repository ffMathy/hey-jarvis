import type { ConversationStrategy, ServerMessage } from './conversation-strategy.js';
export interface GeminiMastraConversationOptions {
  apiKey?: string;
}
/**
 * Gemini-based implementation of ConversationStrategy using MCP tools
 * Connects Gemini directly to MCP servers for tool calling
 */
export declare class GeminiMastraConversationStrategy implements ConversationStrategy {
  private readonly apiKey;
  private messages;
  private isConnected;
  private agent?;
  constructor(options?: GeminiMastraConversationOptions);
  connect(): Promise<void>;
  private getJarvisAgent;
  /**
   * Create an agent response server message
   */
  private createAgentResponseMessage;
  /**
   * Create a tool call server message
   */
  private createToolCallMessage;
  /**
   * Send a message to the agent and store both the message and response
   */
  private sendToAgent;
  sendMessage(text: string): Promise<string>;
  private readAgentPrompt;
  getMessages(): ServerMessage[];
  getTranscriptText(): string;
  disconnect(): Promise<void>;
}
//# sourceMappingURL=gemini-mastra-conversation-strategy.d.ts.map
