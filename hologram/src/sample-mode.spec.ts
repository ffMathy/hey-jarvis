import { describe, expect, it } from 'bun:test';
import { describeFrameRate, moodOf, nextSampleMode, SAMPLE_MODES, type SampleMode, SILENT_VOICE } from './sample-mode';

describe('sample mode', () => {
  it('walks speaking, thinking and idle, and wraps round to the first', () => {
    expect(nextSampleMode('speaking')).toBe('thinking');
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
    expect(moodOf('speaking')).toBe('speaking');
    expect(moodOf('thinking')).toBe('thinking');
    expect(moodOf('idle')).toBeUndefined();
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
