import type { ConversationStrategy, ServerMessage } from './conversation-strategy';
export interface ElevenLabsConversationOptions {
  agentId: string;
  apiKey: string;
}
/**
 * ElevenLabs-specific implementation of ConversationStrategy
 * Uses WebSocket protocol for direct control over the conversation
 */
export declare class ElevenLabsConversationStrategy implements ConversationStrategy {
  private ws;
  private client;
  private readonly agentId;
  private readonly apiKey;
  private messages;
  private conversationId?;
  private shouldStop;
  private conversationReady;
  private conversationReadyResolve?;
  constructor(options: ElevenLabsConversationOptions);
  connect(): Promise<void>;
  private _onWebSocketOpen;
  private _onWebSocketMessage;
  private _onWebSocketClose;
  private _handleMessage;
  sendMessage(text: string): Promise<string>;
  private waitForResponse;
  getMessages(): ServerMessage[];
  getTranscriptText(): string;
  disconnect(): Promise<void>;
}
//# sourceMappingURL=elevenlabs-conversation-strategy.d.ts.map
