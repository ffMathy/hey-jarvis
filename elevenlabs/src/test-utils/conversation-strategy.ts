/**
 * Strategy interface for different conversation implementations
 */
export interface ConversationStrategy {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(text: string): Promise<string>;
  getMessages(): ServerMessage[];
  getTranscriptText(): string;
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

interface McpToolCallEvent {
  type: 'mcp_tool_call';
  mcp_tool_call: {
    tool_name: string;
    tool_call_id: string;
    state: 'success' | 'loading';
    result: [];
  };
}

export type ServerMessage =
  | ConversationInitiationMetadataEvent
  | AgentResponseEvent
  | UserTranscriptEvent
  | UserMessageEvent
  | PingEvent
  | AgentToolResponseEvent
  | McpToolCallEvent
  | AudioEvent;