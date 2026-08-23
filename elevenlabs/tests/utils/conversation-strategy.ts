/**
 * Strategy interface for different conversation implementations
 */
export interface ConversationStrategy {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(text: string): Promise<string>;
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
    result: unknown[];
  };
}

export type ServerMessage =
  | ConversationInitiationMetadataEvent
  | AgentResponseEvent
  | UserTranscriptEvent
  | UserMessageEvent
  | PingEvent
  | AgentToolResponseEvent
  | McpConnectionStatusEvent
  | McpToolCallEvent
  | AudioEvent;
