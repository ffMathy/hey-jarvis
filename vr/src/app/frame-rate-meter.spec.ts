import { describe, expect, it } from 'bun:test';
import { createFrameRateMeter } from './frame-rate-meter';

describe('createFrameRateMeter', () => {
  it('has nothing to say before two frames', () => {
    const meter = createFrameRateMeter();
    expect(meter.rate).toBe(0);
    meter.frame(100);
    expect(meter.rate).toBe(0);
    expect(meter.frameMilliseconds).toBe(0);
  });

  it('measures a steady rate', () => {
    const meter = createFrameRateMeter();
    for (let frame = 0; frame <= 180; frame += 1) meter.frame(frame * (1000 / 90));
    expect(meter.rate).toBeCloseTo(90, 6);
    expect(meter.frameMilliseconds).toBeCloseTo(1000 / 90, 6);
  });

  it('follows a change within about a second', () => {
    const meter = createFrameRateMeter();
    let time = 0;
    for (const interval of [...Array(90).fill(1000 / 90), ...Array(80).fill(1000 / 72)]) {
      time += interval;
      meter.frame(time);
    }
    expect(meter.rate).toBeCloseTo(72, 0);
  });
});
