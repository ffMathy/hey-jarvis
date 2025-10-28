import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import WebSocket from 'ws';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';

export interface ConversationOptions {
  agentId: string;
  apiKey?: string;
  googleApiKey?: string;
}

/**
 * Evaluation criteria result
 */
export interface EvaluationResult {
  passed: boolean;
  score: number; // 0-1
  reasoning: string;
}

/**
 * WebSocket message types from ElevenLabs Conversational AI
 */
interface ConversationInitiationMetadataEvent {
  type: 'conversation_initiation_metadata';
  conversation_initiation_metadata_event: {
    conversation_id: string;
  };
}

interface AgentResponseEvent {
  type: 'agent_response';
  agent_response_event: {
    agent_response: string;
  };
}

interface UserTranscriptEvent {
  type: 'user_transcript';
  user_transcription_event: {
    user_transcript: string;
  };
}

interface PingEvent {
  type: 'ping';
  ping_event: {
    event_id: number;
    ping_ms?: string;
  };
}

interface AgentToolResponseEvent {
  type: 'agent_tool_response';
  agent_tool_response: {
    tool_name: string;
    tool_call_id: string;
    output?: string;
    [key: string]: unknown;
  };
}

type ServerMessage =
  | ConversationInitiationMetadataEvent
  | AgentResponseEvent
  | UserTranscriptEvent
  | UserMessageEvent
  | PingEvent
  | AgentToolResponseEvent
  | { type: string; [key: string]: unknown };

/**
 * Client-to-server message types
 */
interface ConversationInitiationClientDataEvent {
  type: 'conversation_initiation_client_data';
  custom_llm_extra_body?: Record<string, unknown>;
  conversation_config_override?: Record<string, unknown>;
  dynamic_variables?: Record<string, unknown>;
}

interface UserMessageEvent {
  type: 'user_message';
  text: string;
}

interface PongEvent {
  type: 'pong';
  event_id: number;
}

/**
 * Text-based ElevenLabs Conversational AI client for testing.
 * Uses raw WebSockets for direct control over the conversation protocol.
 * Includes LLM-based evaluation capabilities for robust testing.
 */
export class TestConversation {
  private ws: WebSocket | null = null;
  private client: ElevenLabsClient;
  private readonly agentId: string;
  private readonly apiKey: string;
  private readonly googleApiKey: string | undefined;
  private messages: ServerMessage[] = [];
  private conversationId?: string;
  private shouldStop = false;
  private conversationReady = false;
  private conversationReadyResolve?: () => void;

  constructor(options: ConversationOptions) {
    this.agentId = options.agentId;
    const apiKey =
      options.apiKey || process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error(
        'API key required: set HEY_JARVIS_ELEVENLABS_API_KEY or pass apiKey'
      );
    }

    this.apiKey = apiKey;
    this.googleApiKey =
      options.googleApiKey ||
      process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY;
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
    return new Promise((resolve, reject) => {
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
            resolve();
          })
          .catch((error) => {
            clearTimeout(timeoutId);
            reject(error);
          });
      });

      this.ws.on('message', (data: WebSocket.Data) => {
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
    };

    this.ws.send(JSON.stringify(initEvent));
    console.log('WebSocket connected and initialized');
  }

  private _onWebSocketMessage(data: WebSocket.Data): void {
    if (this.shouldStop) {
      return;
    }

    try {
      const message = JSON.parse(data.toString()) as ServerMessage;
      
      // Store all raw messages
      this.messages.push(message);
      
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
          console.log('conversation-started', this.conversationId);
          
          // Mark conversation as ready
          this.conversationReady = true;
          if (this.conversationReadyResolve) {
            this.conversationReadyResolve();
            this.conversationReadyResolve = undefined;
          }
        }
        break;
      }

      case 'agent_response': {
        const event = message as AgentResponseEvent;
        const response = event.agent_response_event.agent_response.trim();
        console.log('agent-response', response);
        break;
      }

      case 'user_transcript': {
        const event = message as UserTranscriptEvent;
        const transcript =
          event.user_transcription_event.user_transcript.trim();
        console.log('user-transcript', transcript);
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

      default:
        // Ignore unknown message types
        console.log('unknown-message-type', message.type);
        break;
    }
  }

  chat(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Send user message
    console.log('user-message', text);

    const messageEvent: UserMessageEvent = {
      type: 'user_message',
      text,
    };

    // Store the sent message in our messages array
    this.messages.push(messageEvent as ServerMessage);

    this.ws.send(JSON.stringify(messageEvent));
  }

  /**
   * Send a message and record it in the transcript
   * Alias for chat() method for backward compatibility
   */
  sendMessage(text: string): void {
    return this.chat(text);
  }

  /**
   * Wait for a specific condition to be met
   * @param condition Function that returns true when the condition is met
   * @param timeoutMs Timeout in milliseconds (default: 30000)
   * @param errorMessage Error message if timeout occurs
   */
  private async waitForCondition(
    condition: () => boolean,
    timeoutMs = 30000,
    errorMessage = 'Condition timeout'
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (condition()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const elapsed = Date.now() - startTime;
    throw new Error(`${errorMessage} after ${elapsed}ms`);
  }

  /**
   * Wait for an agent response to be received
   * @param timeoutMs Timeout in milliseconds (default: 30000)
   * @returns The latest agent response text
   */
  async waitForAgentResponse(timeoutMs = 30000): Promise<string> {
    const initialMessageCount = this.messages.length;

    await this.waitForCondition(
      () => {
        // Check if any new agent_response messages have been received
        const agentResponses = this.messages
          .slice(initialMessageCount)
          .filter((msg) => msg.type === 'agent_response');
        return agentResponses.length > 0;
      },
      timeoutMs,
      `Agent response timeout. Expected response but got none`
    );

    // Find the most recent agent response
    const agentResponses = this.messages.filter(
      (msg) => msg.type === 'agent_response'
    ) as AgentResponseEvent[];

    if (agentResponses.length === 0) {
      throw new Error('No agent response found');
    }

    const latestResponse = agentResponses[agentResponses.length - 1];
    const responseText =
      latestResponse.agent_response_event.agent_response.trim();

    return responseText;
  }

  /**
   * Wait for a tool call (agent_tool_response) to be received
   * @param toolName Name of the tool to wait for (optional - waits for any tool if not specified)
   * @param timeoutMs Timeout in milliseconds (default: 30000)
   * @returns The tool response message
   */
  async waitForToolCall(
    toolName?: string,
    timeoutMs = 30000
  ): Promise<ServerMessage> {
    const initialMessageCount = this.messages.length;

    const matchesToolName = (msg: ServerMessage) => {
      if (!toolName) return true;
      const toolResponse = (msg as { agent_tool_response?: { tool_name?: string } })
        .agent_tool_response;
      return toolResponse?.tool_name === toolName;
    };

    await this.waitForCondition(
      () => {
        const toolResponses = this.messages
          .slice(initialMessageCount)
          .filter((msg) => msg.type === 'agent_tool_response');

        return toolResponses.length > 0 && toolResponses.some(matchesToolName);
      },
      timeoutMs,
      toolName
        ? `Tool call timeout. Expected tool "${toolName}" to be called`
        : `Tool call timeout. Expected any tool to be called`
    );

    const toolResponses = this.messages
      .slice(initialMessageCount)
      .filter((msg) => msg.type === 'agent_tool_response');

    const matchingResponse = toolResponses.find(matchesToolName);
    if (!matchingResponse) {
      throw new Error(
        toolName
          ? `Tool response for "${toolName}" not found`
          : 'No tool response found'
      );
    }

    return matchingResponse;
  }

  /**
   * Get all raw WebSocket messages received
   */
  getMessages(): ServerMessage[] {
    return [...this.messages];
  }

  /**
   * Get all agent responses from the message history
   */
  getAgentResponses(): string[] {
    return this.messages
      .filter((msg) => msg.type === 'agent_response')
      .map(
        (msg) =>
          (msg as AgentResponseEvent).agent_response_event.agent_response.trim()
      );
  }

  /**
   * Get conversation transcript as formatted text for evaluation
   * Includes user messages, agent responses, and tool calls
   */
  getTranscriptText(): string {
    return this.messages
      .filter(
        (msg) =>
          msg.type === 'user_message' ||
          msg.type === 'agent_response' ||
          msg.type === 'agent_tool_response'
      )
      .map((msg) => {
        if (msg.type === 'user_message') {
          return `> USER: ${(msg as UserMessageEvent).text}`;
        } else if (msg.type === 'agent_response') {
          const agentMsg = msg as AgentResponseEvent;
          return `> AGENT: ${agentMsg.agent_response_event.agent_response.trim()}`;
        } else if (msg.type === 'agent_tool_response') {
          const toolMsg = msg as AgentToolResponseEvent;
          const output = toolMsg.agent_tool_response.output
            ? ` → ${toolMsg.agent_tool_response.output}`
            : '';
          return `> TOOL: ${toolMsg.agent_tool_response.tool_name}${output}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Evaluate the conversation transcript against specific criteria using an LLM
   * 
   * @param criteria - Evaluation criteria (e.g., "The agent was helpful and polite")
   * @returns Evaluation result with passed status, confidence score, and reasoning
   */
  async evaluate(criteria: string): Promise<EvaluationResult> {
    const transcriptText = this.getTranscriptText();

    const schema = z.object({
      passed: z.boolean().describe('Whether the criteria was met'),
      score: z
        .number()
        .min(0)
        .max(1)
        .describe('Confidence score from 0 to 1'),
      reasoning: z
        .string()
        .describe('Explanation of why the criteria was or was not met'),
    });

    const google = createGoogleGenerativeAI({ apiKey: this.googleApiKey });

    // @ts-expect-error - TypeScript has issues with deeply nested generic types in AI SDK
    const result = await generateObject({
      model: google('gemini-flash-latest'),
      schema,
      prompt: `You are evaluating a conversation transcript between a user and an AI agent.

IMPORTANT: Evaluate the ENTIRE conversation transcript below, not just individual messages.
Consider the full context and flow across ALL exchanges.

CONVERSATION TRANSCRIPT (COMPLETE):
\`\`\`markdown
${transcriptText}
\`\`\`

EVALUATION CRITERIA:
\`\`\`markdown
${criteria}
\`\`\`

Please evaluate whether the FULL conversation meets the specified criteria. Consider:
- ALL messages in the transcript, not just the first or last
- The semantic meaning and intent, not just exact wording
- The overall flow and context across the ENTIRE conversation
- Whether the agent's responses appropriately address the user's messages throughout
- Consistency of behavior across multiple exchanges

Respond with:
- "passed" (boolean): Whether the criteria is met across the FULL transcript
- "score" (number 0-1): Confidence score based on the ENTIRE conversation
- "reasoning" (string): Clear explanation for your evaluation with specific examples from the transcript`,
    });

    return result.object;
  }

  /**
   * Assert that the conversation meets specific criteria
   * Throws an error if the criteria is not met
   * 
   * @param criteria - Evaluation criteria
   * @param minScore - Minimum score required (0-1, default 0.7)
   * @returns Evaluation result if criteria is met
   * @throws Error if criteria is not met
   */
  async assertCriteria(
    criteria: string,
    minScore = 0.7
  ): Promise<EvaluationResult> {
    const result = await this.evaluate(criteria);

    if (!result.passed || result.score < minScore) {
      throw new Error(
        `Conversation failed to meet criteria (score: ${result.score}):\n` +
          `Criteria: ${criteria}\n` +
          `Reasoning: ${result.reasoning}\n\n` +
          `Transcript:\n${this.getTranscriptText()}`
      );
    }

    return result;
  }

  isActive(): boolean {
    return (
      !!this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      !this.shouldStop &&
      this.conversationReady
    );
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.shouldStop = true;

      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }

      this.ws = null;
    }

    this.messages = [];
    this.conversationId = undefined;
    this.shouldStop = false;
    this.conversationReady = false;
    this.conversationReadyResolve = undefined;
  }
}
