import { describe, expect, it } from 'bun:test';
import {
  createSphereMirror,
  decodeMirrorFrame,
  encodeMirrorFrame,
  MIRROR_AT_REST,
  MIRROR_FRAME_LENGTH,
  MIRROR_STALE_MS,
  type MirroredSphereState,
} from './mirrored-sphere';
import { createSimulatedSpectrum, fillSimulatedSpectrum, simulatedUserAt } from './simulated-voice';
import { foldSpectrum, perceivedLevel } from './voice-levels';

/** The phone's sphere while he talks: the spectrum sample mode makes, at `seconds`. */
function phoneSphereAt(seconds: number, volume: number): MirroredSphereState {
  const spectrum = fillSimulatedSpectrum('speaking', seconds, createSimulatedSpectrum());
  const listener = simulatedUserAt(seconds);
  return {
    voice: { listening: true, speaking: true, getVolume: () => volume, getSpectrum: () => spectrum },
    user: { getPresence: () => listener.presence, getVolume: () => listener.volume },
    thinking: false,
  };
}

describe('a frame of the phone sphere, sent to the watch', () => {
  it('folds back on the watch into the bands the phone drew', () => {
    for (const seconds of [0.1, 0.7, 1.3, 2.2]) {
      const sphere = phoneSphereAt(seconds, 0.12);
      const frame = decodeMirrorFrame(encodeMirrorFrame(sphere));

      expect(frame).toBeDefined();
      const phoneBands = foldSpectrum(sphere.voice.getSpectrum());
      const watchBands = foldSpectrum(frame?.bands ?? []);
      for (let band = 0; band < phoneBands.length; band++) {
        // One byte's rounding of a mean, under the fold's square root.
        expect(Math.abs((watchBands[band] ?? 0) - (phoneBands[band] ?? 0))).toBeLessThan(0.04);
      }
    }
  });

  it('keeps quiet speech loud enough to tell apart', () => {
    for (const volume of [0.02, 0.05, 0.12, 0.3]) {
      const frame = decodeMirrorFrame(encodeMirrorFrame(phoneSphereAt(0.5, volume)));

      expect(Math.abs(perceivedLevel(frame?.volume ?? 0) - perceivedLevel(volume))).toBeLessThan(0.01);
    }
  });

  it('carries the listener, and whether he is thinking', () => {
    const sphere = { ...phoneSphereAt(1, 0.1), thinking: true };
    const frame = decodeMirrorFrame(encodeMirrorFrame(sphere));
    const listener = simulatedUserAt(1);

    expect(frame).toMatchObject({ listening: true, speaking: true, thinking: true, hasUser: true });
    expect(Math.abs((frame?.presence ?? 0) - listener.presence)).toBeLessThan(0.005);
    expect(Math.abs((frame?.userVolume ?? 0) - listener.volume)).toBeLessThan(0.002);
  });

  it('reads nothing from a voice that is not listening', () => {
    const silent: MirroredSphereState = {
      voice: {
        listening: false,
        speaking: false,
        getVolume: () => {
          throw new Error('read a voice nobody is listening to');
        },
        getSpectrum: () => {
          throw new Error('read a voice nobody is listening to');
        },
      },
      thinking: false,
    };

    expect(decodeMirrorFrame(encodeMirrorFrame(silent))).toEqual(MIRROR_AT_REST);
  });

  it('is short enough to send a dozen times a second over Bluetooth', () => {
    expect(encodeMirrorFrame(phoneSphereAt(0.5, 0.1))).toHaveLength(MIRROR_FRAME_LENGTH);
    expect(MIRROR_FRAME_LENGTH).toBeLessThan(64);
  });

  it('is not misread from a layout it does not know', () => {
    const frame = encodeMirrorFrame(phoneSphereAt(0.5, 0.1));

    expect(decodeMirrorFrame([2, ...frame.slice(1)])).toBeUndefined();
    expect(decodeMirrorFrame(frame.slice(1))).toBeUndefined();
  });
});

describe('the watch, mirroring the phone', () => {
  it('follows the latest frame, and says when what it renders changes', () => {
    let now = 1000;
    const mirror = createSphereMirror(() => now);
    const frame = encodeMirrorFrame(phoneSphereAt(0.5, 0.2));

    expect(mirror.receive(frame, now)).toBe(true);
    expect(mirror.receive(frame, now + 80)).toBe(false);
    now += 80;
    expect(mirror.voice.getVolume()).toBeCloseTo(0.2, 2);
    expect(mirror.voice.getSpectrum()).toHaveLength(24);
    expect(mirror.user.getPresence()).toBeGreaterThan(0);
  });

  it('comes to rest when the phone says it has stopped', () => {
    const mirror = createSphereMirror(() => 1000);
    mirror.receive(encodeMirrorFrame(phoneSphereAt(0.5, 0.2)), 1000);

    expect(mirror.receive([], 1000)).toBe(true);
    expect(mirror.current(1000)).toEqual(MIRROR_AT_REST);
    expect(mirror.voice.getVolume()).toBe(0);
  });

  it('comes to rest when the phone goes quiet without saying so', () => {
    const mirror = createSphereMirror(() => 1000 + MIRROR_STALE_MS + 1);
    mirror.receive(encodeMirrorFrame(phoneSphereAt(0.5, 0.2)), 1000);

    expect(mirror.current(1000 + MIRROR_STALE_MS + 1)).toEqual(MIRROR_AT_REST);
    expect(mirror.voice.getVolume()).toBe(0);
  });

  it('says the conversation is over when the phone says it has stopped', () => {
    const mirror = createSphereMirror(() => 1000);
    mirror.receive(encodeMirrorFrame(phoneSphereAt(0.5, 0.2)), 1000);
    expect(mirror.hasEnded()).toBe(false);

    mirror.receive([], 1000);

    expect(mirror.hasEnded()).toBe(true);
  });

  it('does not take the phone going quiet for the conversation being over', () => {
    const mirror = createSphereMirror(() => 1000 + MIRROR_STALE_MS + 1);
    mirror.receive(encodeMirrorFrame(phoneSphereAt(0.5, 0.2)), 1000);

    expect(mirror.current(1000 + MIRROR_STALE_MS + 1)).toEqual(MIRROR_AT_REST);
    expect(mirror.hasEnded()).toBe(false);
  });

  it('follows the phone again once it sends a frame after stopping', () => {
    const mirror = createSphereMirror(() => 2000);
    mirror.receive([], 1000);

    mirror.receive(encodeMirrorFrame(phoneSphereAt(0.5, 0.2)), 2000);

    expect(mirror.hasEnded()).toBe(false);
  });

  it('ignores a message that is not a frame', () => {
    const mirror = createSphereMirror(() => 1000);

    expect(mirror.receive([9, 9, 9], 1000)).toBe(false);
    expect(mirror.current(1000)).toEqual(MIRROR_AT_REST);
  });
});
