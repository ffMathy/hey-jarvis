import { describe, expect, it } from 'bun:test';
import {
  easeHearing,
  easeHearingLevel,
  HEARING_THRESHOLD,
  heardRise,
  hearingFromPresence,
  hearingLevelFromVolume,
} from './hearing';

describe('hearing someone', () => {
  it('hears nobody below the firmware threshold, and someone clearly above it', () => {
    expect(hearingFromPresence(0)).toBe(0);
    expect(hearingFromPresence(HEARING_THRESHOLD)).toBe(0);
    expect(hearingFromPresence(0.9)).toBe(1);
  });

  it('shows as soon as the score clears the threshold, not after it has climbed most of the way', () => {
    expect(hearingFromPresence(HEARING_THRESHOLD + 0.03)).toBeGreaterThan(0.3);
    expect(hearingFromPresence(0.4)).toBe(1);
  });

  it('is most of the way up within a tenth of a second of someone speaking', () => {
    let up = 0;
    for (let frame = 0; frame < 6; frame++) {
      up = easeHearing(up, 1, 1 / 60);
    }
    expect(up).toBeGreaterThan(0.8);
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

describe('the rise of their loudness, which marks each syllable they say', () => {
  it('is how far a step lifted their eased loudness, while the score says they speak', () => {
    const before = 0.2;
    const eased = easeHearingLevel(before, 0.8, 1 / 60);
    expect(heardRise(before, eased, 1)).toBe(eased - before);
    expect(heardRise(before, eased, 0.01)).toBe(eased - before);
  });

  it('is nothing while it falls or holds, or while the score says nobody is talking, however loud the room gets', () => {
    expect(heardRise(0.6, easeHearingLevel(0.6, 0.2, 1 / 60), 1)).toBe(0);
    expect(heardRise(0.6, 0.6, 1)).toBe(0);
    expect(heardRise(0.1, easeHearingLevel(0.1, 1, 1 / 60), 0)).toBe(0);
  });
});
