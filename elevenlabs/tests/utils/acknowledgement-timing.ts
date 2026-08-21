import type { ServerMessage } from './conversation-strategy';

/**
 * Where the agent's first words fell relative to the work it queued.
 *
 * `silent` is the failure this exists for: the agent routed the request and began
 * polling without saying anything, so the user heard nothing between asking and the
 * final answer — which then arrived with the acknowledgement fused onto the front of
 * it, far too late to be one.
 */
export type AcknowledgementTiming =
  | { kind: 'no-request' }
  | { kind: 'no-tool-call' }
  | { kind: 'spoke-first'; acknowledgement: string }
  | { kind: 'silent' };

/** Audio tags are delivery notes, not words. A reply of nothing but tags is silence. */
export function stripAudioTags(spoken: string): string {
  return spoken.replace(/\[[^\]]*\]/g, ' ').trim();
}

function lastIndexOfType(messages: ServerMessage[], type: ServerMessage['type']): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].type === type) return index;
  }
  return -1;
}

/**
 * Reads the socket's message order to place the agent's first words. The events
 * arrive in the order they happened, so an `agent_response` sitting between the
 * user's message and the first `mcp_tool_call` is the user having been spoken to
 * before the wait began.
 */
export function classifyAcknowledgementTiming(messages: ServerMessage[]): AcknowledgementTiming {
  const requestIndex = lastIndexOfType(messages, 'user_message');
  if (requestIndex === -1) return { kind: 'no-request' };

  const toolCallIndex = messages.findIndex(
    (message, index) => index > requestIndex && message.type === 'mcp_tool_call',
  );
  // Nothing was routed, so there was no wait to talk over. Whether the agent
  // should have routed at all is a different assertion's business.
  if (toolCallIndex === -1) return { kind: 'no-tool-call' };

  for (let index = requestIndex + 1; index < toolCallIndex; index++) {
    const message = messages[index];
    if (message.type !== 'agent_response') continue;

    const acknowledgement = stripAudioTags(message.agent_response_event.agent_response);
    if (acknowledgement.length > 0) return { kind: 'spoke-first', acknowledgement };
  }

  return { kind: 'silent' };
}

/** The message order itself, for a failure that can be read without guessing. */
export function describeMessageOrder(messages: ServerMessage[]): string {
  return messages.map((message) => message.type).join(' → ');
}
