import type { ServerMessage } from './conversation-strategy';

/**
 * Where the agent's words fell relative to the results it was waiting on.
 *
 * `silent` is the failure this exists for: the agent routed the request and said
 * nothing until the whole lookup finished, so its one utterance arrived with the
 * acknowledgement fused onto the front of the answer, far too late to be one.
 *
 * Deliberately counts utterances rather than checking whether speech preceded the
 * `mcp_tool_call` event. The "I'm on it" line comes from the routing tool's own
 * instructions, so it legitimately lands *after* the first call — what matters is
 * only that the user heard something before the results did.
 */
export type AcknowledgementTiming =
  | { kind: 'no-request' }
  | { kind: 'no-tool-call' }
  | { kind: 'acknowledged'; acknowledgement: string }
  | { kind: 'silent' };

/**
 * Ways of announcing a lookup. The routing tool issues this line itself once the
 * request is queued, so an agent that also says its own leaves the user told twice
 * that he is being attended to — once by Jarvis, once by the tool.
 */
export const LOOKUP_PROMISE_PATTERNS: RegExp[] = [
  /\blet me (?:just )?(?:check|see|look|have a look|consult|take a look)/i,
  /\ballow me to (?:check|see|consult|look)/i,
  /\bi(?:'| a)?ll (?:check|see|look|take a look|have a look)/i,
  /\bone moment\b/i,
  /\bchecking (?:on )?(?:that|those|it|them)\b/i,
  /\bi'?m on it\b/i,
];

/** Audio tags are delivery notes, not words. A reply of nothing but tags is silence. */
export function stripAudioTags(spoken: string): string {
  return spoken
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastIndexOfType(messages: ServerMessage[], type: ServerMessage['type']): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].type === type) return index;
  }
  return -1;
}

/** Everything the agent actually said after the user's last request, tags stripped. */
function spokenAfterRequest(messages: ServerMessage[], requestIndex: number): string[] {
  const spoken: string[] = [];
  for (let index = requestIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.type !== 'agent_response') continue;

    const words = stripAudioTags(message.agent_response_event.agent_response);
    if (words.length > 0) spoken.push(words);
  }
  return spoken;
}

export function classifyAcknowledgementTiming(messages: ServerMessage[]): AcknowledgementTiming {
  const requestIndex = lastIndexOfType(messages, 'user_message');
  if (requestIndex === -1) return { kind: 'no-request' };

  const routed = messages.some((message, index) => index > requestIndex && message.type === 'mcp_tool_call');
  // Nothing was routed, so there was no wait to talk over. Whether the agent should
  // have routed at all is a different assertion's business.
  if (!routed) return { kind: 'no-tool-call' };

  const spoken = spokenAfterRequest(messages, requestIndex);
  // One utterance means the user heard nothing until the answer itself landed.
  if (spoken.length < 2) return { kind: 'silent' };

  return { kind: 'acknowledged', acknowledgement: spoken[0] };
}

/**
 * Lookup promises the agent made itself before routing — the half of a duplicate
 * acknowledgement that is its to stop making.
 */
export function findLookupPromisesBeforeRouting(messages: ServerMessage[]): string[] {
  const requestIndex = lastIndexOfType(messages, 'user_message');
  if (requestIndex === -1) return [];

  const promises: string[] = [];
  for (let index = requestIndex + 1; index < messages.length; index++) {
    const message = messages[index];
    if (message.type === 'mcp_tool_call') break;
    if (message.type !== 'agent_response') continue;

    const spoken = stripAudioTags(message.agent_response_event.agent_response);
    if (LOOKUP_PROMISE_PATTERNS.some((pattern) => pattern.test(spoken))) promises.push(spoken);
  }
  return promises;
}

/** The message order itself, for a failure that can be read without guessing. */
export function describeMessageOrder(messages: ServerMessage[]): string {
  return messages.map((message) => message.type).join(' → ');
}
