import type { ServerMessage } from './conversation-strategy';

/**
 * Signatures of an agent reciting its tooling instead of using it.
 *
 * Calling a tool is a machine action. When one of these reaches the transcript the
 * words went to the speakers instead: no tool ran, no answer came back, and the user
 * sat listening to machinery. Matched literally rather than by LLM judgement, because
 * the failure has an exact, mechanical signature and deserves an exact verdict.
 */
export const SPOKEN_TOOL_CALL_PATTERNS: { pattern: RegExp; description: string }[] = [
  { pattern: /routePromptWorkflow/i, description: 'the routePromptWorkflow tool name' },
  { pattern: /getNextInstructionsWorkflow/i, description: 'the getNextInstructionsWorkflow tool name' },
  { pattern: /transfer_to_agent/i, description: 'the transfer_to_agent tool name' },
  // Hanging up has its own way of going wrong: rather than reciting the call, the
  // agent writes a stage direction for it — `[end_call invoked]` — which is an audio
  // tag as far as the voice is concerned, so the user hears nothing and stays on a
  // line that was never closed.
  { pattern: /end_call/i, description: 'the end_call tool name' },
  {
    // `something(argument=` — code, not speech. The opening bracket has to follow the
    // name with nothing in between, which is what separates it from the parenthetical
    // asides Jarvis is fond of: "the route (scenic = the long way)" is prose, and the
    // space before the bracket is the whole difference.
    pattern: /\b[a-zA-Z_][a-zA-Z0-9_]*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*=/,
    description: 'a function call with named arguments',
  },
];

/** Descriptions of everything in `spoken` that should have stayed under the hood. */
export function findSpokenToolCallsInText(spoken: string): string[] {
  return SPOKEN_TOOL_CALL_PATTERNS.filter(({ pattern }) => pattern.test(spoken)).map(({ description }) => description);
}

/** The same, across every line the agent actually said, quoted for the failure message. */
export function findSpokenToolCalls(messages: ServerMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.type !== 'agent_response') return [];

    const spoken = message.agent_response_event.agent_response;
    return findSpokenToolCallsInText(spoken).map((description) => `${description}, in: "${spoken.trim()}"`);
  });
}
