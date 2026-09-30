/**
 * Strategy interface for different conversation implementations
 */
export interface ConversationStrategy {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(text: string): Promise<string>;
  /**
   * Background the agent keeps without it starting a turn — what a device says about itself once
   * connected, such as the headset saying it lights up what Jarvis works on. An update with the
   * same `contextId` as an earlier one replaces it, the way the headset's pointing updates do.
   */
  sendContextualUpdate(text: string, contextId?: string): Promise<void>;
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

/** A client tool call — one the device answers rather than a server — as the device receives it. */
export interface ClientToolCall {
  tool_name: string;
  tool_call_id: string;
  parameters?: Record<string, unknown>;
}

interface ClientToolCallEvent {
  type: 'client_tool_call';
  client_tool_call: ClientToolCall;
}

/** The device's answer to a client tool call, recorded as it was sent. */
export interface ClientToolResultEvent {
  type: 'client_tool_result';
  tool_call_id: string;
  result: string;
  is_error: boolean;
}

/** A contextual update the device sent, recorded as it was sent. */
export interface ContextualUpdateEvent {
  type: 'contextual_update';
  text: string;
  /**
   * The context this update belongs to. ElevenLabs drops an older update with the same id from
   * what the model sees, so only the latest of each context is ever in front of it.
   */
  context_id?: string;
}

/**
 * How a test's stand-in device answers a client tool call: the `result` string to send back, or
 * `undefined` to leave the call unanswered, which is what every test gets unless it passes one.
 */
export type ClientToolAnswerer = (call: ClientToolCall) => string | undefined;

/**
 * Everything a conversation's message log holds. Mostly what ElevenLabs sent, plus what the test
 * itself sent — its messages, its contextual updates and its answers to client tool calls — in the
 * order they happened, so the log reads as the whole exchange.
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
  | ClientToolCallEvent
  | ClientToolResultEvent
  | AudioEvent;

/** Names of the MCP tools the agent invoked, one per event ElevenLabs reported. */
export function mcpToolNamesIn(messages: ServerMessage[]): string[] {
  return messages.flatMap((message) => (message.type === 'mcp_tool_call' ? [message.mcp_tool_call.tool_name] : []));
}

/**
 * The contextual updates the agent still sees, in the order they were sent: every update without a
 * context id, and only the latest of each context id, because ElevenLabs drops an older update with
 * the same id from what the model sees.
 */
export function latestContextualUpdates(messages: ServerMessage[]): ContextualUpdateEvent[] {
  const updates = messages.flatMap((message) => (message.type === 'contextual_update' ? [message] : []));
  return updates.filter(
    (update, index) =>
      update.context_id === undefined ||
      !updates.slice(index + 1).some((later) => later.context_id === update.context_id),
  );
}

/** Names of the client tools the agent invoked, in the order it invoked them. */
export function clientToolNamesIn(messages: ServerMessage[]): string[] {
  return messages.flatMap((message) =>
    message.type === 'client_tool_call' ? [message.client_tool_call.tool_name] : [],
  );
}

/**
 * The conversation as text for the evaluator: what each side said, what the device told the agent,
 * and the tools that ran with what they were given and what came back.
 */
export function transcriptOf(messages: ServerMessage[]): string {
  // An answer carries only the id of the call it answers, so the name is looked up for it.
  const clientToolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.type === 'client_tool_call') {
      clientToolNames.set(message.client_tool_call.tool_call_id, message.client_tool_call.tool_name);
    }
  }

  return messages
    .map((message) => {
      switch (message.type) {
        case 'user_message':
          return `> USER: ${message.text}`;
        case 'contextual_update':
          return message.context_id
            ? `> CONTEXT UPDATE FROM THE DEVICE (replacing any earlier "${message.context_id}" update): ${message.text}`
            : `> CONTEXT UPDATE FROM THE DEVICE: ${message.text}`;
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
        case 'client_tool_call':
          return `> CLIENT TOOL: ${message.client_tool_call.tool_name} ${JSON.stringify(message.client_tool_call.parameters ?? {})}`;
        case 'client_tool_result':
          return `> DEVICE ANSWERED ${clientToolNames.get(message.tool_call_id) ?? 'a client tool'}: ${message.result}`;
        default:
          return '';
      }
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
