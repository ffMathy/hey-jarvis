import { describe, expect, it } from 'bun:test';
import { INTERRUPTED_TOO_SOON_MS } from 'hologram';
import {
  AUDIBLE_LEVEL,
  createVoiceWatch,
  QUIET_BEFORE_ONSET_MS,
  SILENT_FOR_MS,
  SILENT_LEVEL,
  STOPPED_FOR_MS,
  type VoiceSample,
} from './voice-watch';

/** A frame every 14 ms, as at 72 Hz. */
const FRAME_MS = 14;

const SPEAKING = 0.05;

function createWatched() {
  let time = 10_000;
  const watch = createVoiceWatch(() => time);
  const sample = (overrides: Partial<VoiceSample> = {}) =>
    watch.sample({ level: 0, contextRunning: true, serverSaysSpeaking: false, ...overrides });
  /** Frames for `milliseconds` at `level`, and whatever the watch said on the way. */
  const frames = (milliseconds: number, overrides: Partial<VoiceSample> = {}) => {
    const said = new Set<string>();
    for (let elapsed = 0; elapsed < milliseconds; elapsed += FRAME_MS) {
      time += FRAME_MS;
      const demotion = sample(overrides);
      if (demotion !== undefined) said.add(demotion);
    }
    return [...said];
  };
  return {
    watch,
    sample,
    frames,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

describe('the echo signs', () => {
  it('an interruption as soon as his voice starts is his first syllables coming back', () => {
    const { watch, frames } = createWatched();
    frames(QUIET_BEFORE_ONSET_MS + 100);
    frames(INTERRUPTED_TOO_SOON_MS - 50, { level: SPEAKING });
    expect(watch.interrupted()).toBe('echo-early-interruption');
  });

  it('an interruption well into what he is saying is someone talking over him', () => {
    const { watch, frames } = createWatched();
    frames(QUIET_BEFORE_ONSET_MS + 100);
    frames(1_500, { level: SPEAKING });
    expect(watch.interrupted()).toBeUndefined();
  });

  it('a pause inside a sentence is not him starting again', () => {
    const { watch, frames } = createWatched();
    frames(1_000, { level: SPEAKING });
    frames(QUIET_BEFORE_ONSET_MS - 100);
    frames(100, { level: SPEAKING });
    expect(watch.interrupted()).toBeUndefined();
  });

  it('counts his start from the audio, at the level the research gives for speech', () => {
    const { watch, frames } = createWatched();
    frames(QUIET_BEFORE_ONSET_MS + 100, { level: AUDIBLE_LEVEL * 0.9 });
    frames(100, { level: AUDIBLE_LEVEL });
    expect(watch.interrupted()).toBe('echo-early-interruption');
  });

  it('two interruptions nobody said anything in give it away', () => {
    const { watch, frames } = createWatched();
    frames(2_000, { level: SPEAKING });
    expect(watch.interrupted()).toBeUndefined();
    frames(2_000, { level: SPEAKING });
    expect(watch.interrupted()).toBe('echo-unexplained-interruptions');
  });

  it('interruptions with the user’s words after each are barge-ins, however many', () => {
    const { watch, frames } = createWatched();
    for (let turn = 0; turn < 4; turn++) {
      frames(2_000, { level: SPEAKING });
      expect(watch.interrupted()).toBeUndefined();
      expect(watch.userSaid('no, the other one')).toBeUndefined();
    }
  });

  it('a transcript of the user that repeats his line is his voice coming back', () => {
    const { watch, frames } = createWatched();
    watch.agentSaid('Your meeting with Pepper has been moved to three o’clock, sir.');
    frames(1_000, { level: SPEAKING });
    expect(watch.userSaid('meeting with pepper has been moved')).toBe('echo-transcript');
  });

  it('starts every conversation with nothing held against it', () => {
    const { watch, frames } = createWatched();
    frames(2_000, { level: SPEAKING });
    watch.interrupted();
    watch.agentSaid('Your meeting with Pepper has been moved to three o’clock, sir.');
    watch.reset();
    frames(2_000, { level: SPEAKING });
    expect(watch.interrupted()).toBeUndefined();
    expect(watch.userSaid('meeting with pepper has been moved')).toBeUndefined();
  });
});

describe('the silence signs', () => {
  it('nothing through the panner while the server hears him, for long enough, is a silent path', () => {
    const { frames } = createWatched();
    expect(frames(SILENT_FOR_MS - 100, { level: SILENT_LEVEL / 2, serverSaysSpeaking: true })).toEqual([]);
    expect(frames(200, { level: SILENT_LEVEL / 2, serverSaysSpeaking: true })).toEqual(['spatial-silent']);
  });

  it('a moment of him through the panner starts the count again', () => {
    const { frames } = createWatched();
    frames(SILENT_FOR_MS - 100, { level: 0, serverSaysSpeaking: true });
    frames(FRAME_MS, { level: SPEAKING, serverSaysSpeaking: true });
    expect(frames(SILENT_FOR_MS - 100, { level: 0, serverSaysSpeaking: true })).toEqual([]);
  });

  it('quiet while the server hears nothing is just him listening', () => {
    const { frames } = createWatched();
    expect(frames(10_000, { level: 0 })).toEqual([]);
  });

  it('judges nothing while no track is going through the panner at all', () => {
    const { frames } = createWatched();
    expect(frames(10_000, { level: undefined, serverSaysSpeaking: true })).toEqual([]);
  });

  it('an AudioContext stopped for longer than a moment silences him', () => {
    const { frames } = createWatched();
    expect(frames(STOPPED_FOR_MS - 100, { contextRunning: false })).toEqual([]);
    frames(FRAME_MS);
    expect(frames(STOPPED_FOR_MS - 100, { contextRunning: false })).toEqual([]);
    expect(frames(STOPPED_FOR_MS + 100, { contextRunning: false })).toEqual(['context-not-running']);
  });
});
