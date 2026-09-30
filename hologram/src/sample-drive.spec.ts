import { describe, expect, it } from 'bun:test';
import {
  createSampleDrive,
  SAMPLE_SILENCE,
  type SampleDrive,
  simulatedJarvisVoice,
  simulatedUserVoice,
} from './sample-drive';
import { hearsSomeone, moodOf, SAMPLE_MODES, type SampleMode, SILENT_VOICE } from './sample-mode';
import { createSimulatedSpectrum, fillSimulatedSpectrum, type SimulatedMood, simulatedUserAt } from './simulated-voice';
import { simulatedVolume } from './voice-analysis';
import type { JarvisVoice, UserVoice } from './voice-contract';

/** A clock that only moves when told to, in milliseconds, starting somewhere other than nought. */
function manualClock(start = 5000) {
  let time = start;
  return {
    now: () => time,
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

// The two places sample mode's voices were built before they were shared, copied as the reference
// the shared code is held to: `useSimulatedVoice` and `useSimulatedUser` in `react/use-simulated-voice.ts`,
// with `Date.now` and the hook's refs made arguments, and `driveFor` in the headset's
// `horizon/src/app/sample-driver.ts`.

function referenceHookVoice(mood: SimulatedMood | undefined, now: () => number, spectrum: Uint8Array): JarvisVoice {
  if (!mood) {
    return SILENT_VOICE;
  }
  const startedAt = { current: now() };
  const read = () => fillSimulatedSpectrum(mood, (now() - startedAt.current) / 1000, spectrum);
  return {
    listening: true,
    speaking: true,
    getVolume: () => simulatedVolume(read()),
    getSpectrum: read,
  };
}

function referenceHookUser(active: boolean, now: () => number): UserVoice | undefined {
  if (!active) {
    return undefined;
  }
  const startedAt = { current: now() };
  const at = () => simulatedUserAt((now() - startedAt.current) / 1000);
  return {
    getPresence: () => at().presence,
    getVolume: () => at().volume,
  };
}

function referenceHeadsetDrive(chosen: SampleMode, now: () => number, spectrum: Uint8Array): SampleDrive {
  const startedAt = now();
  const seconds = () => (now() - startedAt) / 1000;
  const mood = moodOf(chosen);
  let voice: JarvisVoice = SILENT_VOICE;
  if (mood !== undefined) {
    const read = () => fillSimulatedSpectrum(mood, seconds(), spectrum);
    voice = { listening: true, speaking: true, getVolume: () => simulatedVolume(read()), getSpectrum: read };
  }
  const user: UserVoice | undefined = hearsSomeone(chosen)
    ? { getPresence: () => simulatedUserAt(seconds()).presence, getVolume: () => simulatedUserAt(seconds()).volume }
    : undefined;
  return { voice, user, thinking: chosen === 'thinking' };
}

/** Milliseconds after a voice is made at which it is read: at once, on the beat, mid-phrase, and long after. */
const READ_AFTER_MS = [0, 40, 333, 700, 1300, 4999, 12345, 60000];

const MOODS: readonly (SimulatedMood | undefined)[] = [undefined, 'speaking', 'thinking', 'greeting'];

/** Reads two voices at the same moment, in the order the hologram does, and expects the same answers. */
function expectSameVoice(voice: JarvisVoice, reference: JarvisVoice) {
  expect(voice.listening).toBe(reference.listening);
  expect(voice.speaking).toBe(reference.speaking);
  expect(voice.getVolume()).toBe(reference.getVolume());
  expect(Array.from(voice.getSpectrum())).toEqual(Array.from(reference.getSpectrum()));
}

function expectSameUser(user: UserVoice | undefined, reference: UserVoice | undefined) {
  expect(user === undefined).toBe(reference === undefined);
  expect(user?.getPresence()).toBe(reference?.getPresence());
  expect(user?.getVolume()).toBe(reference?.getVolume());
}

describe('simulatedJarvisVoice, against the phone’s hook before it was shared', () => {
  for (const mood of MOODS) {
    it(`gives the same readings for ${mood ?? 'no mood'} throughout`, () => {
      const clock = manualClock();
      const voice = simulatedJarvisVoice(mood, clock.now, createSimulatedSpectrum());
      const reference = referenceHookVoice(mood, clock.now, createSimulatedSpectrum());
      let elapsed = 0;
      for (const after of READ_AFTER_MS) {
        clock.advance(after - elapsed);
        elapsed = after;
        expectSameVoice(voice, reference);
      }
    });
  }

  it('is the silent voice itself with no mood, so a screen switching to it rebuilds nothing', () => {
    expect(simulatedJarvisVoice(undefined, manualClock().now, createSimulatedSpectrum())).toBe(SILENT_VOICE);
  });

  it('fills the spectrum it was given rather than a new one on every reading', () => {
    const spectrum = createSimulatedSpectrum();
    const voice = simulatedJarvisVoice('speaking', manualClock().now, spectrum);
    expect(voice.getSpectrum()).toBe(spectrum);
    expect(voice.getSpectrum()).toBe(spectrum);
  });

  it('is timed from when it was made, not from when the clock started', () => {
    const clock = manualClock(90000);
    const voice = simulatedJarvisVoice('greeting', clock.now, createSimulatedSpectrum());
    clock.advance(700);
    const expected = fillSimulatedSpectrum('greeting', 0.7, createSimulatedSpectrum());
    expect(Array.from(voice.getSpectrum())).toEqual(Array.from(expected));
  });
});

describe('simulatedUserVoice, against the phone’s hook before it was shared', () => {
  it('gives the same readings throughout', () => {
    const clock = manualClock();
    const user = simulatedUserVoice(clock.now);
    const reference = referenceHookUser(true, clock.now);
    let elapsed = 0;
    for (const after of READ_AFTER_MS) {
      clock.advance(after - elapsed);
      elapsed = after;
      expectSameUser(user, reference);
      expect(user.getPresence()).toBe(simulatedUserAt(after / 1000).presence);
    }
  });
});

describe('createSampleDrive, against the headset’s driver before it was shared', () => {
  for (const mode of SAMPLE_MODES) {
    it(`hands the hologram the same ${mode} throughout`, () => {
      const clock = manualClock();
      const drive = createSampleDrive(mode, clock.now, createSimulatedSpectrum());
      const reference = referenceHeadsetDrive(mode, clock.now, createSimulatedSpectrum());
      expect(drive.thinking).toBe(reference.thinking);
      expect(drive.voice === SILENT_VOICE).toBe(reference.voice === SILENT_VOICE);
      let elapsed = 0;
      for (const after of READ_AFTER_MS) {
        clock.advance(after - elapsed);
        elapsed = after;
        expectSameVoice(drive.voice, reference.voice);
        expectSameUser(drive.user, reference.user);
      }
    });
  }

  it('is what the phone’s two hooks give for the same mode', () => {
    for (const mode of SAMPLE_MODES) {
      const clock = manualClock();
      const drive = createSampleDrive(mode, clock.now, createSimulatedSpectrum());
      const voice = referenceHookVoice(moodOf(mode), clock.now, createSimulatedSpectrum());
      const user = referenceHookUser(hearsSomeone(mode), clock.now);
      clock.advance(1234);
      expectSameVoice(drive.voice, voice);
      expectSameUser(drive.user, user);
    }
  });

  it('says nothing, hears nobody and thinks of nothing with no mood chosen', () => {
    expect(SAMPLE_SILENCE).toEqual({ voice: SILENT_VOICE, user: undefined, thinking: false });
    expect(createSampleDrive('idle', manualClock().now, createSimulatedSpectrum())).toEqual(SAMPLE_SILENCE);
  });
});
