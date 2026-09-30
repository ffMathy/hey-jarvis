import { describe, expect, it } from 'bun:test';
import { ClientEvent } from '@elevenlabs/elevenlabs-js/api';
import agentConfig from '../../src/assets/agent-config.json';

/**
 * What the devices assume of the committed agent config, checked on every push.
 *
 * The config reaches ElevenLabs only through `deploy`, and that runs in the release workflow —
 * after the merge, on `main`, where nobody is watching it. The apps that talk to the agent are
 * specced in their own packages, and turbo caches those specs until something in their package
 * changes, so a change made to this file alone is never run past them. This spec is what stands
 * between the two.
 */
describe('the committed agent config', () => {
  const clientEvents = agentConfig.conversationConfig.conversation.clientEvents;

  it('asks only for client events ElevenLabs can send', () => {
    const knownEvents: readonly string[] = Object.values(ClientEvent);

    for (const clientEvent of clientEvents) {
      expect(knownEvents).toContain(clientEvent);
    }
  });

  it("sends every client the MCP calls the apps' thinking phase follows", () => {
    // `hologram/src/tool-activity.ts` holds the sphere in its thinking state from the first routing
    // call to the last answer, and it hears of those calls through this event alone.
    expect(clientEvents).toContain(ClientEvent.McpToolCall);
  });

  it('declares no client tool, since no device answers one', () => {
    // A client tool is answered by the device holding the conversation, and none of them answers
    // any: the apps' SDK reports a tool it was not given as an error, and the Voice speaker ignores
    // the call, leaving the agent silent until the tool's response timeout. Sir sends a photo with
    // the phone's camera button, which asks nothing of the agent.
    const clientTools = agentConfig.conversationConfig.agent.prompt.tools.filter((tool) => tool.type === 'client');

    expect(clientTools).toEqual([]);
    expect(clientEvents).not.toContain(ClientEvent.ClientToolCall);
  });
});
