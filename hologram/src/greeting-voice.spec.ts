import { describe, expect, it } from 'bun:test';
import { GREETING_FRAME_SECONDS, GREETING_FRAMES, GREETING_FULL } from './greeting-envelope';
import {
  createGreetingReaders,
  fillGreetingSpectrum,
  GREETING_REPEAT_SECONDS,
  GREETING_SECONDS,
} from './greeting-voice';
import { fillSimulatedSpectrum } from './simulated-voice';
import { SPEAKING_LOUDEST, SPECTRUM_BIN_COUNT, simulatedVolume } from './voice-analysis';

const spectrumAt = (seconds: number) => fillGreetingSpectrum(seconds, new Uint8Array(SPECTRUM_BIN_COUNT));

describe('the greeting', () => {
  it('is silent before and after the recording', () => {
    expect(simulatedVolume(spectrumAt(-0.1))).toBe(0);
    expect(simulatedVolume(spectrumAt(GREETING_SECONDS))).toBe(0);
  });

  it('is loudest where the recording is, and about as loud as the simulated voice gets', () => {
    const rows = GREETING_FRAMES.length / 13;
    let loudestRow = 0;
    for (let row = 0; row < rows; row++) {
      if (GREETING_FRAMES[row * 13] === GREETING_FULL) loudestRow = row;
    }
    // A little under, not over: the loudest moment of a real voice is peaky, and its strongest
    // bins stop at 255 where a smooth made-up spectrum would not.
    const peak = simulatedVolume(spectrumAt(loudestRow * GREETING_FRAME_SECONDS));
    expect(peak).toBeGreaterThan(SPEAKING_LOUDEST * 0.6);
    expect(peak).toBeLessThanOrEqual(SPEAKING_LOUDEST);
  });

  it('follows the words rather than holding one level: it rises and falls while it plays', () => {
    const volumes = Array.from({ length: Math.floor(GREETING_SECONDS / 0.04) }, (_, step) =>
      simulatedVolume(spectrumAt(step * 0.04)),
    );
    const loud = volumes.filter((volume) => volume > SPEAKING_LOUDEST * 0.5).length;
    const quiet = volumes.filter((volume) => volume < SPEAKING_LOUDEST * 0.15).length;
    expect(loud).toBeGreaterThan(3);
    expect(quiet).toBeGreaterThan(1);
  });

  it('reads wherever the player says it is', () => {
    let position = 0;
    const readers = createGreetingReaders(() => position);
    position = GREETING_SECONDS + 1;
    expect(readers.getVolume()).toBe(0);
    position = GREETING_SECONDS / 2;
    expect(readers.getSpectrum()).toHaveLength(SPECTRUM_BIN_COUNT);
  });

  it('is what sample mode speaks with, over and over', () => {
    const moment = GREETING_SECONDS * 0.4;
    const sample = (seconds: number) =>
      Array.from(fillSimulatedSpectrum('greeting', seconds, new Uint8Array(SPECTRUM_BIN_COUNT)));
    expect(sample(moment)).toEqual(Array.from(spectrumAt(moment)));
    expect(sample(moment + GREETING_REPEAT_SECONDS * 3)).toEqual(sample(moment));
    // ...with a rest between repeats.
    expect(simulatedVolume(new Uint8Array(sample(GREETING_SECONDS + 0.1)))).toBe(0);
  });
});
