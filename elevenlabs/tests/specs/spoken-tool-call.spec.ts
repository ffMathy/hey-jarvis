import { describe, expect, it } from 'bun:test';
import type { ServerMessage } from '../utils/conversation-strategy.js';
import { findSpokenToolCalls, findSpokenToolCallsInText } from '../utils/spoken-tool-call.js';

/**
 * The conversation evals need live credentials and a tunnel; this does not. It pins
 * down what the detector behind them treats as an agent reciting its tooling, so a
 * change in that judgement fails here — cheaply, in CI, on every push — rather than
 * quietly widening or narrowing what those evals are able to catch.
 */
describe('findSpokenToolCallsInText', () => {
  describe('reciting a tool call', () => {
    // The first entry is the failure that prompted all of this, verbatim: the agent
    // read the call out in character, audio tags and all, and no tool ever ran.
    const recitations = [
      '[fastly spoken but in a normal pitch] [sounding like Jarvis from the Iron Man movies] routePromptWorkflow(userQuery="Check my calendar for today")',
      'routePromptWorkflow(userQuery="Check my calendar for today")',
      'assistant → routePromptWorkflow(userQuery="What\'s on my calendar today?")',
      'routePromptWorkflow(userQuery = "spaces around the equals")',
      '[dry] I shall now invoke getNextInstructionsWorkflow, sir.',
      'Calling transfer_to_agent now, sir.',
      // A tool this codebase does not have. The generic shape still catches it, so a
      // renamed or newly added tool does not silently escape the net.
      'unknownFutureTool(someArgument="value")',
    ];

    for (const spoken of recitations) {
      it(`flags ${JSON.stringify(spoken.slice(0, 60))}`, () => {
        expect(findSpokenToolCallsInText(spoken).length).toBeGreaterThan(0);
      });
    }
  });

  describe('ordinary Jarvis speech', () => {
    // Parentheticals and equals signs are both squarely within Jarvis's register, so
    // these are the cases where an over-eager detector would start failing good runs.
    const speech = [
      '[sighs] Naturally, sir. Let me see what trivial engagements await you.',
      '[dry] It is 21:53, sir. Riveting.',
      'Your calendar shows two engagements: standup at 9am and a design review at 2pm.',
      '[amused] You want me to check the weather? How delightfully pedestrian.',
      'Copenhagen is a temperate 15°C with a modest 20% chance of rain, sir.',
      'I am Jarvis, sir. [dry] Surely we have met.',
      'The route (scenic = the long way) would take an hour, sir.',
      'Shall I take the A4 (the faster road) instead, sir?',
      '[matter-of-factly] Two of your three lights remain on, sir.',
    ];

    for (const spoken of speech) {
      it(`leaves ${JSON.stringify(spoken.slice(0, 60))} alone`, () => {
        expect(findSpokenToolCallsInText(spoken)).toEqual([]);
      });
    }
  });
});

describe('findSpokenToolCalls', () => {
  function agentResponse(text: string): ServerMessage {
    return { type: 'agent_response', agent_response_event: { agent_response: text } } as ServerMessage;
  }

  it('quotes the offending line so the failure can be read at a glance', () => {
    const spoken = findSpokenToolCalls([agentResponse('routePromptWorkflow(userQuery="Check my calendar")')]);

    // A recited call trips both the tool's own name and the generic call shape, and
    // reporting each reason separately is the point: whichever one a future recitation
    // trips, the failure says so rather than just "something looked like code".
    expect(spoken).toHaveLength(2);
    expect(spoken.join('\n')).toContain('the routePromptWorkflow tool name');
    expect(spoken.join('\n')).toContain('a function call with named arguments');
    for (const reason of spoken) {
      expect(reason).toContain('Check my calendar');
    }
  });

  it('reports a clean conversation as clean', () => {
    const spoken = findSpokenToolCalls([
      agentResponse('[sighs] Naturally, sir. Let me see what trivial engagements await you.'),
      agentResponse('Two meetings, sir: standup at 9am and a design review at 2pm.'),
    ]);

    expect(spoken).toEqual([]);
  });

  it('ignores everything that is not the agent speaking', () => {
    // A real tool call carries the tool's name too. Reading that as a recitation
    // would fail exactly the conversations that did the right thing.
    const messages = [
      { type: 'mcp_tool_call', mcp_tool_call: { tool_name: 'routePromptWorkflow', state: 'success', result: [] } },
      { type: 'user_message', text: 'call routePromptWorkflow for me' },
    ] as unknown as ServerMessage[];

    expect(findSpokenToolCalls(messages)).toEqual([]);
  });
});
