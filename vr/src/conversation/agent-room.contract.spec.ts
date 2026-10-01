import { describe, expect, it } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Conversation } from '@elevenlabs/client';
import type { StartSession } from 'hologram';

/**
 * What the headset relies on in the installed ElevenLabs SDK, read from the SDK itself.
 *
 * The session reaches Jarvis's LiveKit room through the conversation's protected `connection`,
 * because the SDK offers no public way to his audio track, and checks it with `instanceof Room`
 * against this app's `livekit-client`. A new SDK version that moves either breaks nothing loudly:
 * the hologram quietly goes back to the SDK's own readings, which never read his pauses as silence,
 * and interruptions stop dropping the queued tail of his sentence. So this fails instead. It is the
 * phone's `mobile/src/agent-audio-track.contract.spec.ts`, for this app's copies. It also pins what
 * `hologram`'s fakes copy from the SDK for contextual updates — how a context id is sent — so the
 * specs driven by them stay true to it.
 */

const VR_ROOT = join(import.meta.dir, '../..');

/** The installed `@elevenlabs/client`, followed through bun's links to where its own dependencies sit. */
const CLIENT_SDK = realpathSync(join(VR_ROOT, 'node_modules/@elevenlabs/client'));

function readClientSource(relativePath: string): string {
  return readFileSync(join(CLIENT_SDK, 'dist', relativePath), 'utf8');
}

/**
 * Whether `Conversation.startSession` can be handed to the session as its `startSession` as it is.
 * Checked by the typechecker, which runs over this file with the rest of the app: if a new SDK's
 * options or conversations stop fitting, `true` stops being assignable here and the build fails.
 */
type StartSessionFits = typeof Conversation.startSession extends StartSession ? true : false;
const startSessionFits: StartSessionFits = true;

describe("the SDK's conversation", () => {
  it('keeps its connection on `connection`', () => {
    expect(readClientSource('BaseConversation.js')).toContain('this.connection = connection;');
  });

  it('gives a WebRTC connection a `getRoom` that returns its LiveKit room', () => {
    const source = readClientSource('utils/WebRTCConnection.js');

    expect(source).toMatch(/getRoom\(\)\s*\{\s*return this\.room;\s*\}/);
    expect(source).toMatch(/import \{[^}]*\bRoom\b[^}]*\} from "livekit-client"/);
  });

  it('makes that room from the same livekit-client this app imports, or `instanceof Room` could never be true', () => {
    const clientsLiveKit = realpathSync(join(CLIENT_SDK, '../../livekit-client'));
    const appsLiveKit = realpathSync(join(VR_ROOT, 'node_modules/livekit-client'));

    expect(clientsLiveKit).toBe(appsLiveKit);
  });

  it("finds the agent's participant by 'agent' in its identity, as `isAgentIdentity` does", () => {
    expect(readClientSource('utils/WebRTCConnection.js')).toContain('participant.identity.includes("agent")');
  });

  it('reports a room that closed under the conversation in the words `describeDisconnect` looks for', () => {
    // The text the error panel replaces with "The connection to Jarvis dropped."; if it changes,
    // the raw LiveKit sentence would be what the user reads in the room.
    expect(readClientSource('utils/WebRTCConnection.js')).toMatch(
      /message: `LiveKit connection state changed to \$\{state\}`/,
    );
  });

  it('takes `Conversation.startSession` as the session’s `startSession`, unchanged', () => {
    expect(startSessionFits).toBe(true);
  });

  it('sends a contextual update with its context id, which is what lets a newer one replace it', () => {
    expect(readClientSource('BaseConversation.js')).toMatch(
      /type: "contextual_update",\s*text,\s*\.\.\.\(options\?\.contextId \? \{ context_id: options\.contextId \} : \{\}\)/,
    );
  });
});
