import { describe, expect, it } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the ElevenLabs SDK keeps a conversation's LiveKit room.
 *
 * `roomOfConversation` reaches for it through the conversation's protected
 * `connection`, because the SDK offers no public way to Jarvis's audio track. A
 * new SDK version that moves it breaks nothing loudly: the hologram quietly goes
 * back to the SDK's own readings, which on Android barely move it. So this reads
 * the installed SDK and fails if the room is no longer where
 * `agent-audio-track.ts` looks for it.
 */

const MOBILE_ROOT = join(import.meta.dir, '..');

/** The installed `@elevenlabs/react-native`, followed through bun's links to where its own dependencies sit beside it. */
const REACT_NATIVE_SDK = realpathSync(join(MOBILE_ROOT, 'node_modules/@elevenlabs/react-native'));
/** The `@elevenlabs/client` that copy of the SDK resolves. */
const CLIENT_SDK = realpathSync(join(REACT_NATIVE_SDK, '../client'));

function readClientSource(relativePath: string): string {
  return readFileSync(join(CLIENT_SDK, 'dist', relativePath), 'utf8');
}

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
    const appsLiveKit = realpathSync(join(MOBILE_ROOT, 'node_modules/livekit-client'));

    expect(clientsLiveKit).toBe(appsLiveKit);
  });

  it("finds the agent's participant by 'agent' in its identity, as `isAgentIdentity` does", () => {
    const nativeVolume = readFileSync(join(REACT_NATIVE_SDK, 'src/nativeVolume.ts'), 'utf8');

    expect(nativeVolume).toContain('participant.identity?.includes("agent")');
  });
});
