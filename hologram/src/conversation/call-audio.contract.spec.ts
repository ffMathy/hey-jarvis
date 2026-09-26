import { describe, expect, it } from 'bun:test';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That the call's audio still starts off the main thread on Android.
 *
 * `startCallAudio` goes through LiveKit's `AudioSwitchManager`, which as published switches the
 * audio mode into `MODE_IN_COMMUNICATION` on the main thread — the thread Reanimated draws the sphere
 * on — and Android takes a noticeable moment to switch it. That was the one freeze in his arrival,
 * at the moment the greeting started. The root `patches/` directory moves the switch onto a thread
 * of its own and makes `startAudioSession` resolve only once the call's audio is up, so the greeting
 * is not played into the earpiece while it switches.
 *
 * A LiveKit bump that leaves the patch behind breaks nothing loudly — the freeze just comes back —
 * so this reads the installed package and fails if it is not the patched one.
 */

/** The installed `@livekit/react-native`, followed through bun's links. */
const LIVEKIT = realpathSync(join(import.meta.dir, '../../node_modules/@livekit/react-native'));
const NATIVE_SOURCES = join(LIVEKIT, 'android/src/main/java/com/livekit/reactnative');

function readNativeSource(relativePath: string): string {
  return readFileSync(join(NATIVE_SOURCES, relativePath), 'utf8');
}

describe("LiveKit's audio session on Android", () => {
  it('switches the audio mode on a thread of its own before AudioSwitch starts on the main one', () => {
    const manager = readNativeSource('audio/AudioSwitchManager.java');

    expect(manager).toContain('private final ExecutorService sequencer');
    expect(manager).toMatch(/switchModeTo\(audioMode\);\s*\}\s*runOnMainAndWait\(/);
  });

  it('puts the mode back after stopping, since AudioSwitch now finds the call mode already set', () => {
    expect(readNativeSource('audio/AudioSwitchManager.java')).toContain('switchModeTo(modeBeforeStart)');
  });

  it("resolves `startAudioSession` once the session is up, so the greeting is played as the call's audio", () => {
    expect(readNativeSource('LivekitReactNativeModule.kt')).toMatch(
      /fun startAudioSession\(promise: Promise\)\s*\{\s*audioManager\.start \{ promise\.resolve\(null\) \}/,
    );
  });
});
