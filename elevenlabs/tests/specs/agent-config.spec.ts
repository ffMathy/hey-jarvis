import { describe, expect, it } from 'bun:test';
import { ClientEvent } from '@elevenlabs/elevenlabs-js/api';
import { PromptAgentApiModelInputToolsItem } from '@elevenlabs/elevenlabs-js/serialization';
import agentConfig from '../../src/assets/agent-config.json';

/**
 * The committed config reaches ElevenLabs only through `deploy`, and that runs in the release
 * workflow — after the merge, on `main`, where nobody is watching it. It is unforgiving in two
 * opposite ways. The SDK serialises the update with `unrecognizedObjectKeys: 'strip'`, so a key it
 * does not know — `expects_response` written beside the camelCase keys it expects — is dropped
 * without a word, and the agent quietly keeps whatever it had. A value its enums do not know fails
 * the whole deploy instead. Either one is caught here, on every push, by the same serialiser run
 * strictly.
 */
describe('the committed agent config', () => {
  const tools = agentConfig.conversationConfig.agent.prompt.tools;
  // The client tools are the ones written here by hand. The rest come back from `refresh` exactly
  // as ElevenLabs sent them, snake_case keys the SDK has not caught up with included, and those
  // are passed through on deploy rather than stripped.
  const clientTools = tools.filter((tool) => tool.type === 'client');

  it('declares client tools, or there would be nothing here to check', () => {
    expect(clientTools.length).toBeGreaterThan(0);
  });

  for (const tool of clientTools) {
    it(`sends every key of the ${tool.name} client tool, with values ElevenLabs accepts`, () => {
      const serialised = PromptAgentApiModelInputToolsItem.json(tool, { unrecognizedObjectKeys: 'fail' });

      // The errors rather than `ok`, so a failure names the key and the reason.
      expect(serialised.ok ? [] : serialised.errors).toEqual([]);
    });

    it(`gives the ${tool.name} client tool a response timeout ElevenLabs allows`, () => {
      // The SDK types it as any number; ElevenLabs refuses anything outside one to 120 seconds.
      expect(tool.responseTimeoutSecs).toBeGreaterThanOrEqual(1);
      expect(tool.responseTimeoutSecs).toBeLessThanOrEqual(120);
    });
  }

  it('asks only for client events ElevenLabs can send', () => {
    const knownEvents: readonly string[] = Object.values(ClientEvent);

    for (const clientEvent of agentConfig.conversationConfig.conversation.clientEvents) {
      expect(knownEvents).toContain(clientEvent);
    }
  });

  it('sends every client the MCP results, which is how the phone gets its photo upload URL', () => {
    // Relayed by ElevenLabs rather than written by the model, so nothing the model reads can
    // choose where sir's photo goes. See `hologram/src/camera-request.ts`.
    expect(agentConfig.conversationConfig.conversation.clientEvents).toContain(ClientEvent.McpToolCall);
  });
});
