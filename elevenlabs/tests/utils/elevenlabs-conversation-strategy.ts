import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { type Data, WebSocket } from 'ws';
import {
  type ClientToolAnswerer,
  type ClientToolCall,
  type ClientToolResultEvent,
  type ContextualUpdateEvent,
  type ConversationStrategy,
  mcpToolNamesIn,
  type ServerMessage,
  transcriptOf,
  type UserMessageEvent,
} from './conversation-strategy';

/**
 * Client-to-server message types
 */
interface ConversationInitiationClientDataEvent {
  type: 'conversation_initiation_client_data';
  custom_llm_extra_body?: Record<string, unknown>;
  conversation_config_override?: Record<string, unknown>;
  dynamic_variables?: Record<string, unknown>;
  conversation?: {
    text_only?: boolean;
  };
}

interface PongEvent {
  type: 'pong';
  event_id: number;
}

/**
 * The longest a single reply is waited for, however busy the agent keeps the socket.
 *
 * A reply is otherwise over once the socket goes quiet, and an agent stuck polling a request
 * that never finishes is never quiet: it calls again every ten seconds or so, for as long as
 * it is allowed to. Waiting on it then outlasted the test, bun's timeout fired, and bun
 * killed the test's "dangling processes" on the way out -- which are the MCP server and the
 * cloudflared tunnel every later spec in the file depends on. One stuck conversation turned
 * into "no connection to its MCP server" for everything after it.
 *
 * Kept under the smallest per-attempt budget a spec gives a conversation (90 seconds), so a
 * stuck reply fails its own attempt, with its transcript, instead of the whole file.
 */
const MAX_REPLY_WAIT_MS = 75_000;

export interface ElevenLabsConversationOptions {
  agentId: string;
  apiKey: string;
  /**
   * Answers the agent's client tool calls as a device would — `markAffected` with the headset's
   * short acknowledgement, say. Without one, every call is recorded and left unanswered.
   */
  answerClientToolCall?: ClientToolAnswerer;
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
  private readonly answerClientToolCall?: ClientToolAnswerer;
  private messages: ServerMessage[] = [];
  private conversationId?: string;
  private shouldStop = false;
  private conversationReady = false;
  private conversationReadyResolve?: () => void;

  constructor(options: ElevenLabsConversationOptions) {
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.answerClientToolCall = options.answerClientToolCall;
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
    const { signedUrl } = await this.client.conversationalAi.conversations.getSignedUrl({
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
        void (async () => {
          try {
            await conversationReadyPromise;
            clearTimeout(timeoutId);
            resolve(undefined);
          } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
          }
        })();
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
          reject(new Error(`WebSocket closed before ready: ${code} - ${reason.toString()}`));
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
      conversation: {
        text_only: true,
      },
    };

    this.ws.send(JSON.stringify(initEvent));
  }

  private _onWebSocketMessage(data: Data): void {
    if (this.shouldStop) {
      return;
    }

    const message = JSON.parse(data.toString()) as ServerMessage;
    this._handleMessage(message);
  }

  private _onWebSocketClose(): void {
    this.ws = null;
  }

  private _handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'conversation_initiation_metadata': {
        if (!this.conversationId) {
          this.conversationId = message.conversation_initiation_metadata_event.conversation_id;

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
        // Respond to ping with pong
        const pongEvent: PongEvent = {
          type: 'pong',
          event_id: message.ping_event.event_id,
        };
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify(pongEvent));
        }
        break;
      }

      case 'audio': {
        break;
      }

      case 'client_tool_call': {
        this.messages.push(message);
        this._answerClientToolCall(message.client_tool_call);
        break;
      }

      default:
        // Store all raw messages
        this.messages.push(message);
        break;
    }
  }

  /**
   * Answers a client tool call on the device's behalf, when the test asked for that. The answer is
   * recorded beside the call, so the log shows what the agent was handed.
   */
  private _answerClientToolCall(call: ClientToolCall): void {
    const result = this.answerClientToolCall?.(call);
    if (result === undefined || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const resultEvent: ClientToolResultEvent = {
      type: 'client_tool_result',
      tool_call_id: call.tool_call_id,
      result,
      is_error: false,
    };
    this.ws.send(JSON.stringify(resultEvent));
    this.messages.push(resultEvent);
  }

  /**
   * Background for the agent that starts no turn, so there is no reply to wait for. The context id
   * travels as `context_id`, exactly as the SDK's `sendContextualUpdate` sends it.
   */
  async sendContextualUpdate(text: string, contextId?: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected. Call connect() first.');
    }

    const updateEvent: ContextualUpdateEvent =
      contextId === undefined
        ? { type: 'contextual_update', text }
        : { type: 'contextual_update', text, context_id: contextId };

    this.ws.send(JSON.stringify(updateEvent));
    this.messages.push(updateEvent);
  }

  async sendMessage(text: string): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected. Call connect() first.');
    }

    const messageEvent: UserMessageEvent = {
      type: 'user_message',
      text,
    };

    const sentAt = this.messages.length;
    this.ws.send(JSON.stringify(messageEvent));
    await this.waitForResponse();

    // The message is recorded where it was sent, so everything after it in the log is what it got.
    // The one exception is the greeting: it can land just after the first message has gone out, and
    // it was said before that message, so the message goes after it. This always used to go after
    // the greeting, which put every later message of a conversation ahead of the earlier ones.
    const greetedBeforeSending = this.messages.slice(0, sentAt).some((message) => message.type === 'agent_response');
    const greetingIndex = this.messages.findIndex((message) => message.type === 'agent_response');
    const recordAt = greetedBeforeSending || greetingIndex === -1 ? sentAt : greetingIndex + 1;
    this.messages.splice(recordAt, 0, messageEvent);

    // Find and return the last agent response
    const lastAgentResponse = [...this.messages].reverse().find((msg) => msg.type === 'agent_response');

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
    const deadline = Date.now() + MAX_REPLY_WAIT_MS;

    let message: Partial<ServerMessage> | null = {};
    while (message !== null) {
      timeout = 15000;
      if (message?.type === 'mcp_tool_call' && message.mcp_tool_call?.state === 'loading') {
        timeout = 60000; // Wait longer for agent response
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.warn(`⚠️ The agent was still busy after ${MAX_REPLY_WAIT_MS / 1000}s; judging the reply so far`);
        return;
      }
      timeout = Math.min(timeout, remaining);

      message = await Promise.race([
        waitForNextMessage(),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            resolve(null);
          }, timeout),
        ),
      ]);
    }
  }

  getMessages(): ServerMessage[] {
    return [...this.messages];
  }

  /**
   * The agent reports its MCP tool calls over the socket, which it only does
   * when mcp_tool_call is among the client events it is configured to emit —
   * applyTestAgentOverrides adds it for exactly this reason. The conversation
   * history API is no substitute: it holds nothing until the conversation ends,
   * which outlasts the test.
   */
  getCalledToolNames(): Promise<string[]> {
    return Promise.resolve(mcpToolNamesIn(this.messages));
  }

  getTranscriptText(): string {
    return transcriptOf(this.messages);
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
