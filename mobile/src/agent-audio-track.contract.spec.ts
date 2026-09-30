import { describe, expect, it } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Conversation } from '@elevenlabs/client';
import type { StartSession } from 'hologram';

/**
 * Where the ElevenLabs SDK keeps a conversation's LiveKit room.
 *
 * `roomOfConversation` reaches for it through the conversation's protected
 * `connection`, because the SDK offers no public way to Jarvis's audio track. A
 * new SDK version that moves it breaks nothing loudly: the hologram quietly goes
 * back to the SDK's own readings, which on Android barely move it. So this reads
 * the installed SDK and fails if the room is no longer where
 * `roomOfConversation` looks for it — the shared half in
 * `hologram/src/agent-audio-track.ts`, handed this app's own `Room` check by
 * `agent-audio-track.ts`. It stays here rather than beside the shared half
 * because the copies it compares are this app's.
 */

const MOBILE_ROOT = join(import.meta.dir, '..');
const WATCH_ROOT = join(MOBILE_ROOT, '../watch');
/** The `hologram` workspace package, whose conversation entry dials with `Conversation.startSession`. */
const HOLOGRAM_ROOT = realpathSync(join(MOBILE_ROOT, 'node_modules/hologram'));

/** The installed `@elevenlabs/react-native`, followed through bun's links to where its own dependencies sit beside it. */
const REACT_NATIVE_SDK = realpathSync(join(MOBILE_ROOT, 'node_modules/@elevenlabs/react-native'));
/** The `@elevenlabs/client` that copy of the SDK resolves. */
const CLIENT_SDK = realpathSync(join(REACT_NATIVE_SDK, '../client'));

function readClientSource(relativePath: string): string {
  return readFileSync(join(CLIENT_SDK, 'dist', relativePath), 'utf8');
}

/**
 * Whether `Conversation.startSession` can be handed to hologram's session as its `startSession` as
 * it is. Checked by the typechecker, which runs over this file with the rest of the app: if a new
 * SDK's options or conversations stop fitting, `true` stops being assignable here and the build
 * fails.
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
    const appsLiveKit = realpathSync(join(MOBILE_ROOT, 'node_modules/livekit-client'));

    expect(clientsLiveKit).toBe(appsLiveKit);
  });

  it("finds the agent's participant by 'agent' in its identity, as `isAgentIdentity` does", () => {
    const nativeVolume = readFileSync(join(REACT_NATIVE_SDK, 'src/nativeVolume.ts'), 'utf8');

    expect(nativeVolume).toContain('participant.identity?.includes("agent")');
  });
});

/**
 * The conversation no longer goes through the SDK's React provider: `useJarvisSession` in
 * `hologram/conversation` dials with `Conversation.startSession` from `@elevenlabs/client` itself.
 * On a device that only works while the strategy `@elevenlabs/react-native` registers as a side
 * effect lands on the very copy of `@elevenlabs/client` that hologram imports — a second copy would
 * have no strategy at all, and the first attempt to talk would fail with "No voice session setup
 * strategy registered", on a phone and nowhere else. So this holds all of it to one copy, for the
 * watch as well as the phone, since the watch has no tests of its own.
 */
describe('the client the conversation dials with', () => {
  it('is the very copy of `@elevenlabs/client` the React Native SDK registers its strategy on', () => {
    const hologramsClient = realpathSync(join(HOLOGRAM_ROOT, 'node_modules/@elevenlabs/client'));
    const phonesClient = realpathSync(join(MOBILE_ROOT, 'node_modules/@elevenlabs/client'));
    const watchesSdk = realpathSync(join(WATCH_ROOT, 'node_modules/@elevenlabs/react-native'));
    const watchesClient = realpathSync(join(WATCH_ROOT, 'node_modules/@elevenlabs/client'));

    expect(hologramsClient).toBe(CLIENT_SDK);
    expect(phonesClient).toBe(CLIENT_SDK);
    expect(realpathSync(join(watchesSdk, '../client'))).toBe(CLIENT_SDK);
    expect(watchesClient).toBe(CLIENT_SDK);
  });

  it('registers the native strategy where `Conversation.startSession` looks for it', () => {
    const setup = readFileSync(join(REACT_NATIVE_SDK, 'dist/index.react-native.js'), 'utf8');

    expect(setup).toMatch(/import \{[^}]*\bsetSetupStrategy\b[^}]*\} from "@elevenlabs\/client\/internal"/);
    expect(setup).toContain('setSetupStrategy(reactNativeSessionSetup);');
    expect(readClientSource('internal.js')).toMatch(
      /export \{[^}]*\bsetSetupStrategy\b[^}]*\} from "\.\/platform\/VoiceSessionSetup\.js"/,
    );
    expect(readClientSource('VoiceConversation.js')).toContain(
      'import { ensureSetupStrategy } from "./platform/VoiceSessionSetup.js";',
    );
  });

  it('hands React Native the same `Conversation` as everywhere else', () => {
    expect(readClientSource('platform/react-native/index.js')).toContain('export * from "../../index.js";');
  });

  it('takes `Conversation.startSession` as the session’s `startSession`, unchanged', () => {
    expect(startSessionFits).toBe(true);
  });
});
