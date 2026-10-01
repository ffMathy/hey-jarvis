/**
 * Strategy interface for different conversation implementations
 */
export interface ConversationStrategy {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(text: string): Promise<string>;
  /**
   * Background the agent keeps without it starting a turn — what a device tells it about itself
   * and about sir, such as the phone saying it has a camera button, or that sir has opened the
   * camera to send a photo.
   */
  sendContextualUpdate(text: string): Promise<void>;
  getMessages(): ServerMessage[];
  getTranscriptText(): string;
  /** Names of the tools the agent actually invoked during the conversation. */
  getCalledToolNames(): Promise<string[]>;
}

/**
 * WebSocket message types from ElevenLabs Conversational AI
 */
export interface ConversationInitiationMetadataEvent {
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

interface AudioEvent {
  type: 'audio';
}

export interface UserMessageEvent {
  type: 'user_message';
  text: string;
}

export interface PingEvent {
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

interface McpConnectionStatusEvent {
  type: 'mcp_connection_status';
  mcp_connection_status: {
    integrations: {
      integration_id: string;
      integration_type: string;
      is_connected: boolean;
      tool_count: number;
    }[];
  };
}

interface McpToolCallEvent {
  type: 'mcp_tool_call';
  mcp_tool_call: {
    tool_name: string;
    tool_call_id: string;
    /**
     * `failure` is as real as the other two: a call ElevenLabs could not complete
     * is reported, and the agent is left holding an error where it expected its
     * next instructions. Leaving it off the union made a failed call read as a
     * successful one carrying an unreadable payload.
     */
    state: 'success' | 'loading' | 'failure';
    /** What the agent passed the tool. ElevenLabs sends it; a stand-in strategy may not. */
    parameters?: Record<string, unknown>;
    result: unknown[];
  };
}

/** A contextual update the device sent, recorded as it was sent. */
export interface ContextualUpdateEvent {
  type: 'contextual_update';
  text: string;
}

/**
 * Everything a conversation's message log holds. Mostly what ElevenLabs sent, plus what the test
 * itself sent — its messages and its contextual updates — in the order they happened, so the log
 * reads as the whole exchange.
 */
export type ServerMessage =
  | ConversationInitiationMetadataEvent
  | AgentResponseEvent
  | UserTranscriptEvent
  | UserMessageEvent
  | ContextualUpdateEvent
  | PingEvent
  | AgentToolResponseEvent
  | McpConnectionStatusEvent
  | McpToolCallEvent
  | AudioEvent;

/** Names of the MCP tools the agent invoked, one per event ElevenLabs reported. */
export function mcpToolNamesIn(messages: ServerMessage[]): string[] {
  return messages.flatMap((message) => (message.type === 'mcp_tool_call' ? [message.mcp_tool_call.tool_name] : []));
}

/**
 * The conversation as text for the evaluator: what each side said, what the device told the agent,
 * and the tools that ran with what they were given and what came back.
 */
export function transcriptOf(messages: ServerMessage[]): string {
  return messages
    .map((message) => {
      switch (message.type) {
        case 'user_message':
          return `> USER: ${message.text}`;
        case 'contextual_update':
          return `> CONTEXT UPDATE FROM THE DEVICE: ${message.text}`;
        case 'agent_response':
          return `> AGENT: ${message.agent_response_event.agent_response.trim()}`;
        case 'mcp_tool_call': {
          const call = message.mcp_tool_call;
          if (call.state !== 'success') {
            return '';
          }
          const parameters = call.parameters ? ` ${JSON.stringify(call.parameters)}` : '';
          return `> TOOL: ${call.tool_name}${parameters} → ${JSON.stringify(call.result)}`;
        }
        default:
          return '';
      }
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
