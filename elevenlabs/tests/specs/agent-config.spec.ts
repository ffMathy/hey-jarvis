import { describe, expect, it } from 'bun:test';
import { ClientEvent, ToolInterruptionMode } from '@elevenlabs/elevenlabs-js/api';
import { PromptAgentApiModelInputToolsItem } from '@elevenlabs/elevenlabs-js/serialization';
import agentConfig from '../../src/assets/agent-config.json';

/**
 * The committed config reaches ElevenLabs only through `deploy`, and that runs in the release
 * workflow — after the merge, on `main`, where nobody is watching it — and it lets both kinds of
 * mistake through. It serialises the update with `unrecognizedObjectKeys: 'strip'`, so a key the
 * SDK does not know — `expects_response` written beside the camelCase keys it expects — is dropped
 * without a word, and the agent quietly keeps whatever it had. And since the voice model outran
 * the SDK's enums it passes `allowUnrecognizedEnumValues` too (`toConversationConfigBody` in
 * `src/main.ts`), so a misspelt enum value goes to ElevenLabs as written, for the server to accept
 * or refuse. Both are caught here, on every push, by the same serialiser run strictly.
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
});

/**
 * The agent's half of showing Jarvis something, held to what the phone's half assumes of it.
 *
 * The phone and the watch answer the tool named `OPEN_CAMERA_TOOL` in `hologram/src/camera-request.ts`
 * — the phone with the answers in `mobile/src/camera-answers.ts` — and Mastra's instructions name it
 * as `OPEN_CAMERA_TOOL` in `mcp/mastra/verticals/vision/tools.ts`. Nothing but this file stands
 * between those spellings and the configuration below. The devices' own specs pin their side, but
 * turbo caches them until something in their package changes; this spec runs on every push, so a
 * change made here alone is still checked against what the device expects.
 */
describe('the openCamera client tool', () => {
  const openCamera = agentConfig.conversationConfig.agent.prompt.tools.find(
    (tool) => tool.type === 'client' && tool.name === 'openCamera',
  );

  it('is declared as a client tool, under the name the phone answers', () => {
    expect(openCamera).toBeDefined();
  });

  it('holds the turn until the phone answers, for as long as ElevenLabs allows', () => {
    // Sir framing a shot takes a while, and the answer carries the photo's id: an agent that did
    // not wait would have nothing to ask about.
    expect(openCamera?.expectsResponse).toBe(true);
    expect(openCamera?.responseTimeoutSecs).toBe(120);
  });

  it('asks the model for nothing, so nothing the model reads can choose where the photo goes', () => {
    // The upload URL reaches the phone in the relayed `preparePhotoUpload` result instead. A
    // parameter here is one the model could be talked into filling with some other address.
    expect(openCamera?.parameters?.properties).toEqual({});
  });

  it('cannot be interrupted while the camera is open', () => {
    // Sir speaking mid-capture would otherwise cancel the pending call, and the photo's id would
    // arrive for a call the agent had already let go of.
    expect(openCamera?.interruptionMode).toBe(ToolInterruptionMode.DisableDuringTool);
  });

  it('sends every client the events the phone answers it through', () => {
    const clientEvents = agentConfig.conversationConfig.conversation.clientEvents;

    // The MCP results carry the upload URL, relayed by ElevenLabs rather than written by the model.
    expect(clientEvents).toContain(ClientEvent.McpToolCall);
    // The call itself, which the phone answers with the photo's id.
    expect(clientEvents).toContain(ClientEvent.ClientToolCall);
  });
});
