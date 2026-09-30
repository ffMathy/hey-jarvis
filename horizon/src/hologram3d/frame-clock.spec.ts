import { describe, expect, it } from 'bun:test';
import {
  advanceVoiceActivity,
  createVoiceActivityState,
  easeBands,
  easeHearing,
  easeHearingLevel,
  easeLevel,
  foldSpectrum,
  hearingFromPresence,
  hearingLevelFromVolume,
  type JarvisVoice,
  LEAVING_SECONDS,
  MATERIALISE_SECONDS,
  perceivedLevel,
  SILENT_VOICE,
  THOUGHT_FADE_SECONDS,
  VOICE_BAND_COUNT,
  voiceDrive,
} from 'hologram';
import { createFrameClock, type HologramDrive } from './frame-clock';

/** A spectrum with something in every band, so the fold and the easing both have work to do. */
const SPECTRUM = Uint8Array.from({ length: 1024 }, (_, bin) => (bin * 37) % 256);

function steadyVoice(volume: number): JarvisVoice & { reads: number } {
  const voice = {
    listening: true,
    speaking: true,
    reads: 0,
    getVolume: () => {
      voice.reads += 1;
      return volume;
    },
    getSpectrum: () => SPECTRUM,
  };
  return voice;
}

function drive(overrides: Partial<HologramDrive> = {}): HologramDrive {
  return { voice: SILENT_VOICE, thinking: false, leaving: false, ...overrides };
}

describe('the frame clock', () => {
  it('takes one step exactly as the phone’s view does', () => {
    const clock = createFrameClock();
    const voice = steadyVoice(0.09);
    const user = { getPresence: () => 0.7, getVolume: () => 0.04 };
    const step = 0.02;
    clock.advance(step, drive({ voice, user, thinking: true }));

    const target = perceivedLevel(0.09);
    const activity = advanceVoiceActivity(createVoiceActivityState(), target, step);
    const level = easeLevel(0, target, step);
    const frame = clock.frame(1);
    expect(frame.time).toBeCloseTo(step, 12);
    expect(frame.level).toBeCloseTo(voiceDrive(level, activity.loudest), 12);
    const bands = easeBands(new Array(VOICE_BAND_COUNT).fill(0), foldSpectrum(SPECTRUM), step);
    frame.bands.forEach((band, index) => {
      expect(band).toBeCloseTo(bands[index] ?? Number.NaN, 12);
    });
    expect(frame.speaking).toBe(true);
    expect(frame.agitation).toBeCloseTo(activity.agitation, 12);
    expect(frame.burstAge).toBeCloseTo(activity.burstAge, 12);
    expect(frame.burstStrength).toBeCloseTo(activity.burstStrength, 12);
    expect(frame.burstCount).toBe(activity.burstCount);
    expect(frame.thinking).toBeCloseTo(step / THOUGHT_FADE_SECONDS, 12);
    expect(frame.presence).toBe(1);
    expect(frame.hearing).toBeCloseTo(easeHearing(0, hearingFromPresence(0.7), step), 12);
    expect(frame.hearingLevel).toBeCloseTo(easeHearingLevel(0, hearingLevelFromVolume(0.04), step), 12);
    expect(frame.appearance).toBeCloseTo(step / MATERIALISE_SECONDS, 12);
    expect(frame.density).toBe(1);
  });

  it('reads the voice every 40 ms of its own time, not every frame', () => {
    const clock = createFrameClock();
    const voice = steadyVoice(0.05);
    for (let frame = 0; frame < 90; frame++) clock.advance(1 / 90, drive({ voice }));
    // One reading at the start and one every 40 ms of the second after it.
    expect(voice.reads).toBeGreaterThanOrEqual(25);
    expect(voice.reads).toBeLessThanOrEqual(26);
  });

  it('reads a new voice at once rather than at the next beat', () => {
    const clock = createFrameClock();
    clock.advance(1 / 90, drive());
    const voice = steadyVoice(0.05);
    clock.advance(1 / 90, drive({ voice }));
    expect(voice.reads).toBe(1);
  });

  it('holds back a step shorter than a hundred-and-twenty-eighth of a second, then takes the lot', () => {
    const clock = createFrameClock();
    clock.advance(0.005, drive());
    expect(clock.time).toBe(0);
    clock.advance(0.005, drive());
    expect(clock.time).toBeCloseTo(0.01, 12);
  });

  it('starts the arrival again on every summon, fully present', () => {
    const clock = createFrameClock();
    for (let frame = 0; frame < 30; frame++) clock.advance(1 / 60, drive({ leaving: true }));
    expect(clock.presence).toBe(0);
    clock.arrive();
    expect(clock.time).toBe(0);
    expect(clock.presence).toBe(1);
    expect(clock.frame(1).appearance).toBe(0);
  });

  it('is gone LEAVING_SECONDS after he is sent away, and not before', () => {
    const clock = createFrameClock();
    for (let frame = 0; frame < 120; frame++) clock.advance(1 / 60, drive());
    const steps = Math.floor(LEAVING_SECONDS * 60);
    for (let frame = 0; frame < steps - 2; frame++) clock.advance(1 / 60, drive({ leaving: true }));
    expect(clock.presence).toBeGreaterThan(0);
    for (let frame = 0; frame < 4; frame++) clock.advance(1 / 60, drive({ leaving: true }));
    expect(clock.presence).toBe(0);
  });

  it('hears nothing from a voice that is not listening', () => {
    const clock = createFrameClock();
    const voice = { ...steadyVoice(0.5), listening: false };
    for (let frame = 0; frame < 30; frame++) clock.advance(1 / 60, drive({ voice }));
    expect(clock.frame(1).level).toBe(0);
    expect(clock.frame(1).agitation).toBe(0);
  });

  it('ignores a step that is not a finite number of seconds', () => {
    const clock = createFrameClock();
    clock.advance(Number.NaN, drive());
    clock.advance(Number.POSITIVE_INFINITY, drive());
    clock.advance(-1, drive());
    expect(clock.time).toBe(0);
  });
});
