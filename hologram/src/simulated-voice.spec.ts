import { describe, expect, it } from 'bun:test';
import { createSimulatedSpectrum, fillSimulatedSpectrum, simulatedVolume } from './simulated-voice';
import { perceivedLevel, QUIETEST_SPEECH } from './voice-levels';

/**
 * The two moods sample mode shows without a microphone.
 *
 * What is pinned here is what tells them apart to look at, because there is nothing on the screen
 * that says which one is running. Speech is irregular and loud enough to count as speech; thinking
 * is quiet enough *not* to, except for a tick at the end of each pass — so the sphere sweeps and
 * ticks rather than glowing, and the two moods can never quietly become the same thing.
 */

/** The strictest gate any platform applies: a browser's, twice the phone's. See `speech-floor.web.ts`. */
const BROWSER_SPEECH_FLOOR = 0.2;

/**
 * Every reading of a mood over `seconds`, at the 40 ms the hologram actually polls at — as levels
 * the tracker would see, not as raw spectrum means.
 *
 * Through `perceivedLevel`, because that is the quantity every gate in `voice-levels.ts` is
 * written against, and it is a square root with gain: comparing a raw mean with a speech floor
 * compares two different things and quietly passes.
 */
function readings(mood: 'speaking' | 'thinking', seconds: number): number[] {
  const spectrum = createSimulatedSpectrum();
  const levels: number[] = [];
  for (let step = 0; step * 0.04 < seconds; step++) {
    levels.push(perceivedLevel(simulatedVolume(fillSimulatedSpectrum(mood, step * 0.04, spectrum))));
  }
  return levels;
}

describe('the voices sample mode makes up', () => {
  it('gives the same second the same spectrum, however long the page has been open', () => {
    const once = Array.from(fillSimulatedSpectrum('speaking', 3.28, createSimulatedSpectrum()));
    const again = Array.from(fillSimulatedSpectrum('speaking', 3.28, createSimulatedSpectrum()));

    expect(again).toEqual(once);
  });

  it('speaks loudly enough to count as speech anywhere, and leaves gaps between the words', () => {
    const levels = readings('speaking', 12);
    const loud = levels.filter((level) => level > BROWSER_SPEECH_FLOOR).length;
    const silent = levels.filter((level) => level < QUIETEST_SPEECH / 2).length;

    // Plainly talking for a good part of the time...
    expect(loud / levels.length).toBeGreaterThan(0.2);
    // ...and plainly not, for a good part of it. Speech that never stops gives the tracker no
    // onsets to find, and the sphere settles into one unchanging agitated state.
    expect(silent / levels.length).toBeGreaterThan(0.2);
  });

  it('speaks to an irregular rhythm rather than a beat', () => {
    // The gaps between the starts of sounds must not all be the same length, or the sphere pulses
    // like a metronome — which is what it did before the phrasing and the breaths went in.
    const levels = readings('speaking', 20);
    const starts: number[] = [];
    for (let index = 1; index < levels.length; index++) {
      if ((levels[index] ?? 0) > BROWSER_SPEECH_FLOOR && (levels[index - 1] ?? 0) <= BROWSER_SPEECH_FLOOR) {
        starts.push(index * 0.04);
      }
    }
    const gaps = starts.slice(1).map((start, index) => start - (starts[index] ?? 0));

    expect(gaps.length).toBeGreaterThan(8);
    expect(new Set(gaps.map((gap) => Math.round(gap * 100))).size).toBeGreaterThan(3);
  });

  it('thinks below the level anything counts as speech, so it searches rather than talks', () => {
    const levels = readings('thinking', 12);
    const quiet = levels.filter((level) => level < QUIETEST_SPEECH).length;

    // Almost all of the time it is under even the phone's gate, which is the lower of the two:
    // no glow, no swell, only the bands moving.
    expect(quiet / levels.length).toBeGreaterThan(0.85);
  });

  it('never reaches the level anything counts as speech, so the sphere answers with no bursts', () => {
    // Thinking used to tick loudly once a pass, to make the tracker throw a chip burst. It does
    // not any more: bursts are what *speech* does, and the sphere has a thinking state of its own
    // now — the plane sweeping through it, and the ring that blooms when a pass finishes. Left
    // here, the ticks would have Jarvis throwing sparks while he reads a file.
    const levels = readings('thinking', 20);

    expect(Math.max(...levels)).toBeLessThan(QUIETEST_SPEECH);
  });
});
