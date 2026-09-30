import { describe, expect, it } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What `call-audio.ts` relies on LiveKit and the ElevenLabs SDK to keep doing.
 *
 * The audio mode is switched in and out off the main thread by `JarvisGreetingModule`, and going
 * back out has to happen after LiveKit's own stop, which puts back the call mode it found. That
 * order is not something either library promises; it follows from how each is written today. A new
 * version that changes it breaks nothing loudly — the phone is simply left in call mode after
 * Jarvis hangs up, or the freeze in his arrival comes back — so this reads the installed packages
 * and fails if any of it has moved.
 */

const HOLOGRAM_ROOT = join(import.meta.dir, '../..');

/** The installed `@livekit/react-native`, followed through bun's links. */
const LIVEKIT = realpathSync(join(HOLOGRAM_ROOT, 'node_modules/@livekit/react-native'));
const LIVEKIT_NATIVE = join(LIVEKIT, 'android/src/main/java/com/livekit/reactnative');
/** The installed `@elevenlabs/react-native`, and the `@elevenlabs/client` beside it. */
const REACT_NATIVE_SDK = realpathSync(join(HOLOGRAM_ROOT, 'node_modules/@elevenlabs/react-native'));
const CLIENT_SDK = realpathSync(join(REACT_NATIVE_SDK, '../client'));

function read(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

describe("LiveKit's audio session on Android", () => {
  const module = read(LIVEKIT_NATIVE, 'LivekitReactNativeModule.kt');
  const manager = read(LIVEKIT_NATIVE, 'audio/AudioSwitchManager.java');

  it('stops through a bridge method that returns nothing, so its work is queued rather than awaited', () => {
    expect(module).toMatch(/@ReactMethod\s+fun stopAudioSession\(\)\s*\{\s*audioManager\.stop\(\)/);
  });

  it('answers `getAudioOutputs` on the same module, which `stopCallAudio` waits on as a barrier behind the stop', () => {
    expect(module).toMatch(/@ReactMethod\s+fun getAudioOutputs\(promise: Promise\)/);
  });

  it('does its starting and stopping on the main thread, which `leaveCallMode` queues behind', () => {
    expect(manager).toContain('private final Handler handler = new Handler(Looper.getMainLooper());');
    expect(manager).toMatch(
      /public void stop\(\) \{\s*handler\.removeCallbacksAndMessages\(null\);\s*handler\.postAtFrontOfQueue\(/,
    );
  });

  it('switches into the mode it is configured with only when it manages audio focus, which the preset asks for', () => {
    expect(manager).toContain('audioSwitch.setAudioMode(audioMode);');
    expect(manager).toContain('audioSwitch.setManageAudioFocus(manageAudioFocus);');
  });
});

describe('the ElevenLabs SDK', () => {
  it("stops LiveKit's audio session as a voice session is taken down", () => {
    const setup = read(REACT_NATIVE_SDK, 'dist/index.react-native.js');

    expect(setup).toMatch(/detach: async \(\) => \{[\s\S]*?finally \{\s*await AudioSession\.stopAudioSession\(\);/);
  });

  it('takes the session down before its ending resolves, which is when the session lets the call audio go', () => {
    const conversation = read(CLIENT_SDK, 'dist/BaseConversation.js');

    expect(conversation).toMatch(
      /await this\.handleEndSession\(\);\s*\}\s*finally \{[\s\S]*?this\.updateStatus\("disconnected"\);/,
    );
    expect(read(CLIENT_SDK, 'dist/VoiceConversation.js')).toMatch(
      /async handleEndSession\(\) \{[\s\S]*?await this\.cleanUp\(\);/,
    );
  });
});
