import { describe, expect, it } from 'bun:test';
import { easeHearing, HEARING_THRESHOLD, hearingFromPresence, hearingLevelFromVolume } from './hearing';

describe('hearing someone', () => {
  it('hears nobody below the firmware threshold, and someone clearly above it', () => {
    expect(hearingFromPresence(0)).toBe(0);
    expect(hearingFromPresence(HEARING_THRESHOLD)).toBe(0);
    expect(hearingFromPresence(0.9)).toBe(1);
  });

  it('reads a quiet microphone as more than nothing, and never past 1', () => {
    expect(hearingLevelFromVolume(0.05)).toBeGreaterThan(0.25);
    expect(hearingLevelFromVolume(4)).toBe(1);
    expect(hearingLevelFromVolume(-1)).toBe(0);
  });

  it('comes up quickly when someone speaks and goes slowly when they stop', () => {
    let up = 0;
    let down = 1;
    for (let frame = 0; frame < 6; frame++) {
      up = easeHearing(up, 1, 1 / 60);
      down = easeHearing(down, 0, 1 / 60);
    }
    expect(up).toBeGreaterThan(1 - down);
  });
});
