import { describe, expect, it } from 'bun:test';
import {
  describeFrameRate,
  hearsSomeone,
  moodOf,
  nextSampleMode,
  SAMPLE_MODES,
  type SampleMode,
  SILENT_VOICE,
} from './sample-mode';

describe('sample mode', () => {
  it('walks speaking, listening, thinking and idle, and wraps round to the first', () => {
    expect(nextSampleMode('speaking')).toBe('listening');
    expect(nextSampleMode('listening')).toBe('thinking');
    expect(nextSampleMode('thinking')).toBe('idle');
    expect(nextSampleMode('idle')).toBe('speaking');
  });

  it('visits every mood before coming back', () => {
    const visited = new Set<string>();
    let mode: SampleMode = SAMPLE_MODES[0];
    for (const _ of SAMPLE_MODES) {
      visited.add(mode);
      mode = nextSampleMode(mode);
    }
    expect(mode).toBe(SAMPLE_MODES[0]);
    expect([...visited]).toEqual([...SAMPLE_MODES]);
  });

  it('asks for a simulated voice for speaking and thinking, and for silence at rest', () => {
    // Speaking replays the greeting's own measured pattern, as he speaks when summoned.
    expect(moodOf('speaking')).toBe('greeting');
    expect(moodOf('thinking')).toBe('thinking');
    expect(moodOf('idle')).toBeUndefined();
    expect(moodOf('listening')).toBeUndefined();
  });

  it('has someone talking to him only while listening', () => {
    expect(SAMPLE_MODES.filter(hearsSomeone)).toEqual(['listening']);
  });

  it('has a silent voice that reports nothing', () => {
    expect(SILENT_VOICE.speaking).toBe(false);
    expect(SILENT_VOICE.listening).toBe(false);
    expect(SILENT_VOICE.getVolume()).toBe(0);
    expect(SILENT_VOICE.getSpectrum()).toHaveLength(0);
  });
});

describe('the frame-rate readout', () => {
  const reading = { rate: 39.6, buildMilliseconds: 3.14, share: 0.25 };

  it('says the rate, the build time and the share as a count', () => {
    expect(describeFrameRate(reading, 1200)).toBe('40 fps · build 3.1 ms · 300 sparks');
  });

  it('drops the build time where there is no room for it', () => {
    expect(describeFrameRate(reading, 1200, { withBuildTime: false })).toBe('40 fps · 300 sparks');
  });
});
