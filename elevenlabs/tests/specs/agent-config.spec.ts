import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * The one silence after a finished request that is not the end of the call: sir busy with a photo.
 *
 * ElevenLabs asks Jarvis to speak again three seconds into any silence (`turnTimeout`), and after a
 * finished request the answer is to hang up without a word. That rule is stated in four places the
 * agent reads at once: the prompt's **When Sir Is Silent**, the `end_call` and `skip_turn`
 * descriptions here, and routing's `FINISHED_REQUEST_INSTRUCTIONS`, which closes every finished
 * request. The exception for a photo on its way was once written in the prompt alone, and the three
 * that said to hang up outweighed it — routing's the freshest of them, and the one the prompt says to
 * follow literally — so Jarvis could hang up on sir while he was framing the shot.
 *
 * An exception has to be stated wherever the rule it breaks is, so every one of them states it, in
 * the same words: on a device that has said it has a camera button, he said he would send a photo or
 * has opened the camera, and nothing has settled it since — the photo, a message that it did not
 * arrive, a note that he closed the camera without one, or his saying it is not coming. This holds the
 * prompt and both copies of each description to that, and `workflows.spec.ts` in `mcp/` holds
 * routing's copy to the same phrases; the live half, a finished request followed by an open camera and
 * the same request followed by nothing, is `camera.integration.spec.ts`.
 *
 * A word from sir about anything else once ended the wait as well. The request it was routed as ended
 * on the hang-up, so its silence closed the line on him on his way to the camera — and a question asked
 * beside the photo he announced made that word certain. What still bounds a wait nothing settles is
 * ElevenLabs' thirty-second `silenceEndCallTimeout`.
 */
describe('the silence after a finished request, while a photo is on its way', () => {
  const prompt = readFileSync(join(import.meta.dir, '..', '..', 'src', 'assets', 'agent-prompt.md'), 'utf8');
  const agentPrompt = agentConfig.conversationConfig.agent.prompt;

  /**
   * What each statement of the exception says, whichever words surround it. The descriptions set the
   * middle phrase off with hyphens and the prompt with dashes, so the phrases stop short of both.
   */
  const WAITING_FOR_A_PHOTO = [
    'waiting for a photo from him on a device that has told you it has a camera button',
    'he said he would send one, or a note says he has opened the camera on his phone',
    'and since then the photo has not come, nor a message that it did not reach you, nor a note that he closed the ' +
      'camera without one, and he has not said it is not coming',
  ];

  /** The config's copy of a system tool's description in its `tools` list, beside `builtInTools`. */
  function listedDescription(toolName: string): string | undefined {
    return agentPrompt.tools.find((tool) => tool.name === toolName)?.description;
  }

  /** The text from `start` up to the next `end` after it, or nothing when `start` is not there at all. */
  function sectionOf(text: string, start: string, end: string): string {
    const startIndex = text.indexOf(start);
    if (startIndex === -1) {
      return '';
    }
    const endIndex = text.indexOf(end, startIndex + start.length);
    return text.slice(startIndex, endIndex === -1 ? undefined : endIndex);
  }

  function expectTheException(text: string): void {
    for (const phrase of WAITING_FOR_A_PHOTO) {
      expect(text).toContain(phrase);
    }
    expect(text).not.toContain('a word from him');
  }

  it('gives each system tool one description, in both of the places the config lists it', () => {
    // The test agent is deployed with `tools` cleared, so it reads `builtInTools`; the agent sir talks
    // to is sent both. A change made to one copy alone is tested in one form and shipped in another.
    expect(listedDescription('skip_turn')).toBe(agentPrompt.builtInTools.skipTurn.description);
    expect(listedDescription('end_call')).toBe(agentPrompt.builtInTools.endCall.description);
  });

  it('has skip_turn wait on a photo, even straight after a finished request', () => {
    const description = agentPrompt.builtInTools.skipTurn.description;

    expectTheException(sectionOf(description, 'Call it when:', '\n\n'));
    expect(sectionOf(description, 'Do not call it when a request of his has just finished', '.')).toContain(
      'unless you are waiting for a photo from him',
    );
  });

  it("has end_call's silence after a finished request wait on a photo instead", () => {
    const silence = sectionOf(
      agentPrompt.builtInTools.endCall.description,
      '## 3) Silence after a finished request',
      '\n---',
    );

    expectTheException(silence);
    expect(silence).toContain('call skip_turn instead');
  });

  it("has the prompt's When Sir Is Silent wait on a photo, and never hang up on it", () => {
    const whenSirIsSilent = sectionOf(prompt, '# When Sir Is Silent', '\n---');

    expectTheException(whenSirIsSilent);
    expect(whenSirIsSilent).toContain('never `end_call`');
    expect(sectionOf(whenSirIsSilent, '**Your last reply finished a request**', '\n')).toContain(
      'you are not waiting for a photo from him',
    );
  });

  it('has the prompt send sir to his phone where there is no camera button, and not wait for that photo', () => {
    // The watch, the Voice speaker and a telephone call share the agent. The photo goes to the phone's
    // own conversation, and one held open here for it keeps that conversation from starting, since the
    // agent takes one at a time.
    const noCameraButton = sectionOf(prompt, '**Only a device with a camera button can send you one.**', '\n');

    expect(noCameraButton).toContain('tell him to send it from his phone');
    expect(noCameraButton).toContain('this one is not waiting for it');
    expect(noCameraButton).toContain('gets `end_call` without a word');
  });

  it('has the prompt end the wait on a camera closed without a photo', () => {
    // Once it "changed nothing", which left the wait the open camera had started still standing.
    const cameraClosed = sectionOf(prompt, '**A note that he closed the camera without a photo**', '\n');

    expect(cameraClosed).toContain('ends the wait for one, even one he said he would send');
    expect(cameraClosed).not.toContain('changes nothing');
  });
});
