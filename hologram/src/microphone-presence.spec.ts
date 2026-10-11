import { describe, expect, it } from 'bun:test';
import { hearingFromPresence } from './hearing';
import { presenceFromMicrophoneLevel } from './microphone-presence';

/** A level, 0–1 of full scale, from decibels. */
const atDecibels = (decibels: number) => 10 ** (decibels / 20);

describe('presence from the microphone alone', () => {
  it('hears nobody in silence, a quiet room, or a reading that is not a number', () => {
    expect(presenceFromMicrophoneLevel(0)).toBe(0);
    expect(presenceFromMicrophoneLevel(atDecibels(-60))).toBe(0);
    expect(presenceFromMicrophoneLevel(atDecibels(-45))).toBe(0);
    expect(presenceFromMicrophoneLevel(Number.NaN)).toBe(0);
    expect(presenceFromMicrophoneLevel(-0.5)).toBe(0);
  });

  it('is sure of a voice at arm’s length, and never more than sure', () => {
    expect(presenceFromMicrophoneLevel(atDecibels(-30))).toBeCloseTo(1, 10);
    expect(presenceFromMicrophoneLevel(atDecibels(-12))).toBe(1);
    expect(presenceFromMicrophoneLevel(1)).toBe(1);
    expect(presenceFromMicrophoneLevel(4)).toBe(1);
  });

  it('crosses the lattice’s threshold between a quiet room and speech', () => {
    expect(hearingFromPresence(presenceFromMicrophoneLevel(atDecibels(-44)))).toBe(0);
    expect(hearingFromPresence(presenceFromMicrophoneLevel(atDecibels(-38)))).toBeGreaterThan(0.5);
    expect(hearingFromPresence(presenceFromMicrophoneLevel(atDecibels(-30)))).toBe(1);
  });

  it('rises with the level', () => {
    const levels = [-44, -42, -40, -38, -36, -34, -32].map((decibels) =>
      presenceFromMicrophoneLevel(atDecibels(decibels)),
    );
    for (let index = 1; index < levels.length; index++) {
      expect(levels[index]).toBeGreaterThan(levels[index - 1] ?? 0);
    }
  });
});
