import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { WebSocket } from 'ws';
/**
 * ElevenLabs-specific implementation of ConversationStrategy
 * Uses WebSocket protocol for direct control over the conversation
 */
export class ElevenLabsConversationStrategy {
  ws = null;
  client;
  agentId;
  apiKey;
  messages = [];
  conversationId;
  shouldStop = false;
  conversationReady = false;
  conversationReadyResolve;
  constructor(options) {
    this.agentId = options.agentId;
    this.apiKey = options.apiKey;
    this.client = new ElevenLabsClient({ apiKey: this.apiKey });
  }
  async connect() {
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
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Connection timeout after 10 seconds'));
      }, 10000);
      // Set up promise for conversation ready state
      const conversationReadyPromise = new Promise((resolveReady) => {
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
      this.ws.on('message', (data) => {
        this._onWebSocketMessage(data);
      });
      this.ws.on('error', (error) => {
        clearTimeout(timeoutId);
        console.error('WebSocket error:', error);
        reject(error);
      });
      this.ws.on('close', (code, reason) => {
        clearTimeout(timeoutId);
        this._onWebSocketClose();
        // If conversation never became ready, reject the connection
        if (!this.conversationReady) {
          reject(new Error(`WebSocket closed before ready: ${code} - ${reason.toString()}`));
        }
      });
    });
  }
  _onWebSocketOpen() {
    if (!this.ws) return;
    // Send conversation initiation data
    const initEvent = {
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
  _onWebSocketMessage(data) {
    if (this.shouldStop) {
      return;
    }
    try {
      const message = JSON.parse(data.toString());
      this._handleMessage(message);
    } catch (error) {
      console.error('Error parsing WebSocket message:', error);
    }
  }
  _onWebSocketClose() {
    this.ws = null;
  }
  _handleMessage(message) {
    switch (message.type) {
      case 'conversation_initiation_metadata': {
        const event = message;
        if (!this.conversationId) {
          this.conversationId = event.conversation_initiation_metadata_event.conversation_id;
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
        const event = message;
        // Respond to ping with pong
        const pongEvent = {
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
  async sendMessage(text) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected. Call connect() first.');
    }
    const messageEvent = {
      type: 'user_message',
      text,
    };
    this.ws.send(JSON.stringify(messageEvent));
    await this.waitForResponse();
    // Store the sent message in our messages array, but in the position right after the first agent_response message
    const agentResponseIndex = this.messages.findIndex((msg) => msg.type === 'agent_response');
    if (agentResponseIndex !== -1) {
      this.messages.splice(agentResponseIndex + 1, 0, messageEvent);
    } else {
      this.messages.push(messageEvent);
    }
    // Find and return the last agent response
    const lastAgentResponse = [...this.messages].reverse().find((msg) => msg.type === 'agent_response');
    return lastAgentResponse?.agent_response_event?.agent_response || '';
  }
  async waitForResponse() {
    let currentMessageLength = this.messages.length;
    const waitForNextMessage = async () => {
      while (this.messages.length === currentMessageLength) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      currentMessageLength = this.messages.length;
      const message = this.messages[this.messages.length - 1];
      return message;
    };
    let timeout = 0;
    let message = {};
    while (message !== null) {
      timeout = 15000;
      if (message?.type === 'mcp_tool_call' && message.mcp_tool_call.state === 'loading') {
        timeout = 60000; // Wait longer for agent response
      }
      message = await Promise.race([
        waitForNextMessage(),
        new Promise((resolve) =>
          setTimeout(() => {
            resolve(null);
          }, timeout),
        ),
      ]);
    }
  }
  getMessages() {
    return [...this.messages];
  }
  getTranscriptText() {
    return this.messages
      .map((msg) => {
        if (msg.type === 'user_message') {
          return `> USER: ${msg.text}`;
        } else if (msg.type === 'agent_response') {
          return `> AGENT: ${msg.agent_response_event.agent_response.trim()}`;
        } else if (msg.type === 'mcp_tool_call' && msg.mcp_tool_call.state === 'success') {
          return `> TOOL: ${msg.mcp_tool_call.tool_name} → ${JSON.stringify(msg.mcp_tool_call.result)}`;
        }
        return '';
      })
      .filter((x) => !!x)
      .join('\n');
  }
  async disconnect() {
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
//# sourceMappingURL=elevenlabs-conversation-strategy.js.map
