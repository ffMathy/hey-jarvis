import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import {
  Conversation,
} from '@elevenlabs/elevenlabs-js/api/resources/conversationalAi/conversation';

export interface ConversationOptions {
  agentId: string;
  apiKey?: string;
  disableFirstMessage?: boolean;
}

/**
 * Text-based ElevenLabs Conversational AI client for testing.
 * Wraps the official SDK's Conversation class for text-only interactions.
 */
export class ElevenLabsConversationClient {
  private static lastDisconnectTime = 0;
  
  private conversation: Conversation | null = null;
  private client: ElevenLabsClient;
  private readonly agentId: string;
  private readonly apiKey: string;
  private readonly disableFirstMessage: boolean;
  private responses: string[] = [];
  private lastMessageTime = 0;

  constructor(options: ConversationOptions) {
    this.agentId = options.agentId;
    this.disableFirstMessage = options.disableFirstMessage ?? false;
    const apiKey =
      options.apiKey || process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        'API key required: set HEY_JARVIS_ELEVENLABS_API_KEY or pass apiKey'
      );
    }

    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    // Wait for any previous session to fully disconnect on server side
    while (this.isActive()) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Ensure minimum time has passed since last disconnect
    // to allow server-side cleanup to complete
    const timeSinceDisconnect = Date.now() - ElevenLabsConversationClient.lastDisconnectTime;
    const minWaitTime = 3000; // 3 seconds minimum between sessions
    if (ElevenLabsConversationClient.lastDisconnectTime > 0 && timeSinceDisconnect < minWaitTime) {
      await new Promise(resolve => setTimeout(resolve, minWaitTime - timeSinceDisconnect));
    }

    this.client = new ElevenLabsClient({ apiKey: this.apiKey });

    // Clear responses from any previous connection
    this.responses = [];
    this.lastMessageTime = 0;

    // Get signed URL for authenticated connection
    const { signedUrl } = await this.client.conversationalAi.conversations.getSignedUrl({
      agentId: this.agentId,
    });

    this.conversation = new Conversation({
      conversationClient: this.client,
      webSocketFactory: {
        create: (_url: string, options: unknown) => {
          const WebSocket = require('ws');
          return new WebSocket(signedUrl, options);
        },
      },
      agentId: this.agentId,
      requiresAuth: false,
      audioInterface: {
        start(): void {
          // No-op: text-only mode
        },
        stop(): void {
          // No-op: text-only mode
        },
        output(): void {
          // No-op: text-only mode
        },
        interrupt(): void {
          // No-op: text-only mode
        }
      },
      callbackAgentResponse: (response: string) => {
        this.responses.push(response);
      },
      ...(this.disableFirstMessage && {
        overrides: {
          agent: {
            firstMessage: '',
          },
        },
      }),
    });
    
    await Promise.race([
      new Promise((resolve) => {
        // eslint-disable-next-line no-var
        var handler = () => {
          resolve(undefined);
          this.conversation.off('conversation_started', handler);
        }
        this.conversation.on('conversation_started', handler);
        this.conversation.startSession();
      }),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 30 seconds')), 30000)
      )
    ]);
  }

  async chat(text: string): Promise<string> {
    if (!this.conversation) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Add delay between consecutive messages to give agent time to process
    const timeSinceLastMessage = Date.now() - this.lastMessageTime;
    if (this.lastMessageTime > 0 && timeSinceLastMessage < 1000) {
      await new Promise((resolve) => setTimeout(resolve, 1000 - timeSinceLastMessage));
    }

    this.lastMessageTime = Date.now();
    
    // Send message first, THEN wait for response
    const startLength = this.responses.length;
    this.conversation.sendUserMessage(text);
    return await this.waitForResponse(startLength);
  }

  private async waitForResponse(expectedCount: number): Promise<string> {
    const startTime = Date.now();

    while (Date.now() - startTime < 30000) {
      if (this.responses.length > expectedCount) {
        return this.responses[this.responses.length - 1];
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const elapsed = Date.now() - startTime;
    throw new Error(
      `Response timeout after ${elapsed}ms. Expected ${expectedCount + 1} responses, got ${this.responses.length}`
    );
  }

  getAgentResponses(): string[] {
    return [...this.responses];
  }

  isActive(): boolean {
    return this.conversation?.isSessionActive() ?? false;
  }

  async waitForInactive(timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (this.isActive() && Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  async disconnect(): Promise<void> {
    if (this.conversation) {
      try {
        await Promise.race([
          new Promise((resolve) => {
            // eslint-disable-next-line no-var
            var handler = () => {
              resolve(undefined);
              this.conversation.off('session_ended', handler);
            }
            this.conversation.on('session_ended', handler);
            this.conversation.endSession();
          }),
          new Promise((resolve) => setTimeout(resolve, 5000)) // 5 second timeout
        ]);
        
        // Wait for session to become inactive before cleaning up
        await this.waitForInactive();
      } catch (error) {
        console.warn('Disconnect error:', error);
      }

      this.conversation = null;
    }

    this.client = null;
    this.responses = [];
    this.lastMessageTime = 0;
    ElevenLabsConversationClient.lastDisconnectTime = Date.now();
  }
}
