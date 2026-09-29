import { describe, expect, it } from 'bun:test';
import { MATERIALISE_SECONDS, VOICE_BAND_COUNT } from 'hologram';
import { silentFrame } from './silent-frame';

describe('silentFrame', () => {
  it('counts his arrival up over the phone’s materialise time, then holds him fully here', () => {
    expect(silentFrame(0).appearance).toBe(0);
    expect(silentFrame(MATERIALISE_SECONDS / 2).appearance).toBeCloseTo(0.5, 12);
    expect(silentFrame(MATERIALISE_SECONDS).appearance).toBe(1);
    expect(silentFrame(MATERIALISE_SECONDS * 10).appearance).toBe(1);
  });

  it('has nobody talking, nothing thought and every particle drawn', () => {
    const frame = silentFrame(12.5);
    expect(frame.time).toBe(12.5);
    expect(frame.level).toBe(0);
    expect(frame.bands).toEqual(new Array(VOICE_BAND_COUNT).fill(0));
    expect(frame.speaking).toBe(false);
    expect(frame.agitation).toBe(0);
    expect(frame.burstStrength).toBe(0);
    expect(frame.thinking).toBe(0);
    expect(frame.presence).toBe(1);
    expect(frame.density).toBe(1);
    expect(frame.hearing).toBeUndefined();
  });
});
