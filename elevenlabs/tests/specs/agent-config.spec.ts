import { describe, expect, it } from 'bun:test';
import {
  ClientEvent,
  PreToolSpeechMode,
  ToolErrorHandlingMode,
  ToolExecutionMode,
} from '@elevenlabs/elevenlabs-js/api';
import { PromptAgentApiModelInputToolsItem } from '@elevenlabs/elevenlabs-js/serialization';
import agentConfig from '../../src/assets/agent-config.json';
import { toTestAgentClientEvents, toTestAgentTools } from '../../src/main';

/**
 * The client tool that lights up what a request touches, spelled as the headset registers it in
 * `hologram/` and as Mastra's routing instructions name it in `mcp/mastra/verticals/routing/`.
 * Copied rather than imported, because this package imports nothing of the devices': nothing but
 * this spec stands between those spellings and the configuration below.
 */
const MARK_AFFECTED_TOOL = 'markAffected';

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
 * The agent's half of lighting up what Jarvis works on, held to what the headset's half assumes.
 *
 * Every Jarvis device talks to this one agent — the phone, the watch, the headset, the Voice
 * speaker and a telephone call — and only the headset has anything to light up. So the tool must
 * never hold up a conversation, never be announced, and never hand the agent an error to retry
 * from a device that does not know it.
 */
describe('the markAffected client tool', () => {
  const markAffected = agentConfig.conversationConfig.agent.prompt.tools.find(
    (tool) => tool.type === 'client' && tool.name === MARK_AFFECTED_TOOL,
  );

  it('is declared as a client tool, under the name the headset answers', () => {
    expect(markAffected).toBeDefined();
  });

  it('never holds up the conversation waiting for a device to answer', () => {
    // The Voice speaker and a telephone call never answer a client tool at all. A tool that waited
    // would stall the agent there for its whole response timeout, in the middle of a request.
    expect(markAffected?.expectsResponse).toBe(false);
  });

  it('runs the moment it is called, so the glow shows while the work is under way', () => {
    // `post_tool_speech` would hold it until Jarvis had finished speaking, which is usually the
    // answer: by then there is nothing left to light up.
    expect(markAffected?.executionMode).toBe(ToolExecutionMode.Immediate);
  });

  it('is never introduced out loud', () => {
    expect(markAffected?.preToolSpeech).toBe(PreToolSpeechMode.Off);
  });

  it('hides a failed call from the agent', () => {
    // A device without the tool answers with an error, and the prompt tells the agent to repeat a
    // call that errs. Shown the error, it would call again and again from a phone that can never
    // answer it any differently.
    expect(markAffected?.toolErrorHandlingMode).toBe(ToolErrorHandlingMode.Hide);
  });

  it('asks for a list of entities, each an opaque id with an optional display name', () => {
    // The headset parses exactly this: `{ entities: [{ id, name? }] }`. The id is required because
    // it is what the headset keys every placement on; the name is only ever a label.
    expect(markAffected?.parameters).toMatchObject({
      type: 'object',
      required: ['entities'],
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    });
    expect(Object.keys(markAffected?.parameters?.properties ?? {})).toEqual(['entities']);
    expect(Object.keys(markAffected?.parameters?.properties?.entities?.items?.properties ?? {}).sort()).toEqual([
      'id',
      'name',
    ]);
  });

  it('sends every client the call, so the headset hears it', () => {
    // An event missing from `clientEvents` is not sent, whatever the docs say: `agent_tool_request`
    // and `mcp_tool_call` both stayed silent until they were listed.
    expect(agentConfig.conversationConfig.conversation.clientEvents).toContain(ClientEvent.ClientToolCall);
  });
});

/**
 * The test agent is deployed from the same file with its own overrides, and the integration evals
 * only mean something if it still has what the routing loop tells it to call.
 */
describe('the test agent overrides', () => {
  const committedTools = agentConfig.conversationConfig.agent.prompt.tools;

  it('keeps markAffected, which the routing instructions name', () => {
    const kept = toTestAgentTools(committedTools).map((tool) => tool.name);

    expect(kept).toContain(MARK_AFFECTED_TOOL);
  });

  it('keeps nothing but client tools', () => {
    const kept = toTestAgentTools(committedTools);

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((tool) => tool.type === 'client')).toBe(true);
  });

  it('emits the events the evals read, even from a config that has lost them', () => {
    expect(toTestAgentClientEvents([ClientEvent.AgentResponse])).toEqual([
      ClientEvent.AgentResponse,
      ClientEvent.McpToolCall,
      ClientEvent.ClientToolCall,
    ]);
  });

  it('leaves a config that already lists them as it was', () => {
    const listed = [ClientEvent.ClientToolCall, ClientEvent.AgentResponse, ClientEvent.McpToolCall];

    expect(toTestAgentClientEvents(listed)).toEqual(listed);
  });
});
