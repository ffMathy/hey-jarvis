import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { WebSocket, Data } from 'ws';
import type { ConversationInitiationMetadataEvent, ConversationStrategy, PingEvent, ServerMessage, UserMessageEvent } from './conversation-strategy';

/**
 * Client-to-server message types
 */
interface ConversationInitiationClientDataEvent {
  type: 'conversation_initiation_client_data';
  custom_llm_extra_body?: Record<string, unknown>;
  conversation_config_override?: Record<string, unknown>;
  dynamic_variables?: Record<string, unknown>;
}

interface PongEvent {
  type: 'pong';
  event_id: number;
}

export interface ElevenLabsConversationOptions {
  agentId: string;
  apiKey: string;
}

/**
 * ElevenLabs-specific implementation of ConversationStrategy
 * Uses WebSocket protocol for direct control over the conversation
 */
export class ElevenLabsConversationStrategy implements ConversationStrategy {
  private ws: WebSocket | null = null;
  private client: ElevenLabsClient;
  private readonly agentId: string;
  private readonly apiKey: string;
  private messages: ServerMessage[] = [];
  private conversationId?: string;
  private shouldStop = false;
  private conversationReady = false;
  private conversationReadyResolve?: () => void;

  constructor(options: ElevenLabsConversationOptions) {
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.client = new ElevenLabsClient({ apiKey: this.apiKey });
  }

  async connect(): Promise<void> {
    // Clear state from any previous connection
    this.messages = [];
    this.conversationId = undefined;
    this.shouldStop = false;
    this.conversationReady = false;
    this.conversationReadyResolve = undefined;

    // Get signed URL for authenticated connection
    const { signedUrl } =
      await this.client.conversationalAi.conversations.getSignedUrl({
        agentId: this.agentId,
      });

    // Create WebSocket connection
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Connection timeout after 10 seconds'));
      }, 10000);

      // Set up promise for conversation ready state
      const conversationReadyPromise = new Promise<void>((resolveReady) => {
        this.conversationReadyResolve = resolveReady;
      });

      this.ws = new WebSocket(signedUrl, {
        perMessageDeflate: false,
        maxPayload: 16 * 1024 * 1024, // 16MB max message size
      });

      this.ws.on('open', () => {
        this._onWebSocketOpen();

        // Wait for conversation to be ready (conversation_initiation_metadata received)
        conversationReadyPromise
          .then(() => {
            clearTimeout(timeoutId);
            resolve(undefined);
          })
          .catch((error) => {
            clearTimeout(timeoutId);
            reject(error);
          });
      });

      this.ws.on('message', (data: Data) => {
        this._onWebSocketMessage(data);
      });

      this.ws.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        console.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timeoutId);
        this._onWebSocketClose();

        // If conversation never became ready, reject the connection
        if (!this.conversationReady) {
          reject(
            new Error(
              `WebSocket closed before ready: ${code} - ${reason.toString()}`
            )
          );
        }
      });
    });
  }

  private _onWebSocketOpen(): void {
    if (!this.ws) return;

    // Send conversation initiation data
    const initEvent: ConversationInitiationClientDataEvent = {
      type: 'conversation_initiation_client_data',
      custom_llm_extra_body: {},
      conversation_config_override: {},
      dynamic_variables: {},
    };

    this.ws.send(JSON.stringify(initEvent));
  }

  private _onWebSocketMessage(data: Data): void {
    if (this.shouldStop) {
      return;
    }

    try {
      const message = JSON.parse(data.toString()) as ServerMessage;

      this._handleMessage(message);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }

  private _onWebSocketClose(): void {
    this.ws = null;
  }

  private _handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'conversation_initiation_metadata': {
        const event = message as ConversationInitiationMetadataEvent;
        if (!this.conversationId) {
          this.conversationId =
            event.conversation_initiation_metadata_event.conversation_id;

          // Mark conversation as ready
          this.conversationReady = true;
          if (this.conversationReadyResolve) {
            this.conversationReadyResolve();
            this.conversationReadyResolve = undefined;
          }
        }
        break;
      }

      case 'ping': {
        const event = message as PingEvent;
        // Respond to ping with pong
        const pongEvent: PongEvent = {
          type: 'pong',
          event_id: event.ping_event.event_id,
        };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(pongEvent));
        }
        break;
      }

      case 'audio': {
        break;
      }

      default:
        // Store all raw messages
        this.messages.push(message);
        break;
    }
  }

  async sendMessage(text: string): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected. Call connect() first.');
    }

    const messageEvent: UserMessageEvent = {
      type: 'user_message',
      text,
    };

    this.ws.send(JSON.stringify(messageEvent));
    await this.waitForResponse();

    // Store the sent message in our messages array, but in the position right after the first agent_response message
    const agentResponseIndex = this.messages.findIndex(
      (msg) => msg.type === 'agent_response'
    );
    if (agentResponseIndex !== -1) {
      this.messages.splice(
        agentResponseIndex + 1,
        0,
        messageEvent as ServerMessage
      );
    } else {
      this.messages.push(messageEvent as ServerMessage);
    }

    // Find and return the last agent response
    const lastAgentResponse = [...this.messages]
      .reverse()
      .find((msg) => msg.type === 'agent_response');
    
    return lastAgentResponse?.agent_response_event?.agent_response || '';
  }

  private async waitForResponse() {
    let currentMessageLength = this.messages.length;
    const waitForNextMessage = async (): Promise<ServerMessage> => {
      while (this.messages.length === currentMessageLength) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      currentMessageLength = this.messages.length;

      const message = this.messages[this.messages.length - 1];
      return message;
    };

    let timeout = 0;

    let message: Partial<ServerMessage> | null = {};
    while (message !== null) {
      timeout = 15000;
      if (
        message?.type === 'mcp_tool_call' &&
        message.mcp_tool_call.state === 'loading'
      ) {
        timeout = 60000; // Wait longer for agent response
      }

      message = await Promise.race([
        waitForNextMessage(),
        new Promise<never>((resolve) =>
          setTimeout(() => {
            resolve(null);
          }, timeout)
        ),
      ]);
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
    if (this.ws) {
      this.shouldStop = true;
      this.ws.close();
      this.ws = null;
    }

    this.messages = [];
    this.conversationId = undefined;
    this.shouldStop = false;
    this.conversationReady = false;
    this.conversationReadyResolve = undefined;
  }
}
