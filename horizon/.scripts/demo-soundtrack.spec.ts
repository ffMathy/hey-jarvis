import { describe, expect, it } from 'bun:test';
import { REFERENCE_DISTANCE_METRES, ROLLOFF } from '../src/conversation/spatial-voice';
import { createCameraPath, demoScript, lookingAt, type Pose } from './demo-shot';
import {
  CUT_FADE_SECONDS,
  distanceGain,
  FILM_PEAK,
  filmLevel,
  gainsAt,
  gainTimeline,
  heardFrom,
  PAN_WIDTH,
  spatialSoundtrack,
  stereoGains,
  wavFile,
} from './demo-soundtrack';

const EYE = { x: 0, y: 1.6, z: 0 };

/** A head at the eye, looking at `target`. */
function headLookingAt(target: { x: number; y: number; z: number }): Pose {
  return { position: EYE, orientation: lookingAt(EYE, target) };
}

/** The gains for a voice `metres` from the head, `degrees` round to its right (negative: its left). */
function gainsFor(metres: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return stereoGains({ right: metres * Math.sin(radians), up: 0, ahead: metres * Math.cos(radians) });
}

describe('heardFrom', () => {
  it('says where he is in the head’s own frame: ahead, to its right, above it', () => {
    const head = headLookingAt({ x: 0, y: 1.6, z: -2 });
    const heard = heardFrom(head, { x: 0.5, y: 1.4, z: -2 });
    expect(heard.ahead).toBeCloseTo(2, 9);
    expect(heard.right).toBeCloseTo(0.5, 9);
    expect(heard.up).toBeCloseTo(-0.2, 9);
  });

  it('turns with the head: facing right, something straight ahead of the room is on its left', () => {
    const head = headLookingAt({ x: 3, y: 1.6, z: 0 });
    const heard = heardFrom(head, { x: 0, y: 1.6, z: -2 });
    expect(heard.right).toBeCloseTo(-2, 9);
    expect(heard.ahead).toBeCloseTo(0, 9);
  });
});

describe('distanceGain', () => {
  it('is the app’s own inverse model: full within the reference distance, then its rolloff', () => {
    expect(distanceGain(1)).toBeCloseTo(1, 12);
    expect(distanceGain(1.6)).toBeCloseTo(
      REFERENCE_DISTANCE_METRES / (REFERENCE_DISTANCE_METRES + ROLLOFF * (1.6 - REFERENCE_DISTANCE_METRES)),
      12,
    );
    expect(distanceGain(1.6)).toBeCloseTo(1 / 1.3, 12);
    expect(distanceGain(0.8)).toBe(1);
    expect(distanceGain(0)).toBe(1);
  });

  it('keeps falling past the maximum distance, which only the linear model uses', () => {
    expect(distanceGain(12)).toBeLessThan(distanceGain(10));
  });
});

describe('stereoGains', () => {
  it('centres him when he is straight ahead, at exactly the app’s gain in each ear', () => {
    for (const metres of [0.8, 1, 1.6, 1.9]) {
      const gains = gainsFor(metres, 0);
      expect(gains.left).toBeCloseTo(distanceGain(metres), 12);
      expect(gains.right).toBeCloseTo(distanceGain(metres), 12);
    }
  });

  it('is louder in the left ear when he is on the left, and mirrors on the right', () => {
    const left = gainsFor(1.6, -30);
    const right = gainsFor(1.6, 30);
    expect(left.left).toBeGreaterThan(left.right);
    expect(left.left).toBeCloseTo(right.right, 12);
    expect(left.right).toBeCloseTo(right.left, 12);
    // About 4 dB between the ears 30° off: a lean, not a jump into one ear.
    expect(20 * Math.log10(left.left / left.right)).toBeCloseTo(4.25, 1);
  });

  it('keeps the power of both ears together the same wherever he is round the head', () => {
    for (const degrees of [-90, -45, 0, 20, 90, 180]) {
      const gains = gainsFor(1.6, degrees);
      expect(gains.left ** 2 + gains.right ** 2).toBeCloseTo(2 * distanceGain(1.6) ** 2, 9);
    }
  });

  it('pans furthest for a voice beside the head, and no further than its width', () => {
    const beside = gainsFor(1, -90);
    const angle = ((1 - PAN_WIDTH) * Math.PI) / 4;
    expect(beside.left).toBeCloseTo(Math.SQRT2 * Math.sin(Math.PI / 2 - angle), 9);
    expect(beside.right).toBeCloseTo(Math.SQRT2 * Math.cos(Math.PI / 2 - angle), 9);
    expect(gainsFor(1, -60).left).toBeLessThan(beside.left);
  });

  it('is quieter at 1.9 m than at arm’s length, where nothing is lost', () => {
    const near = gainsFor(0.8, 0);
    const far = gainsFor(1.9, 0);
    expect(near.left).toBeCloseTo(1, 12);
    expect(far.left).toBeLessThan(near.left);
    expect(far.right).toBeLessThan(near.right);
  });
});

describe('the gain timeline', () => {
  it('samples along the film and interpolates between, holding its ends', () => {
    const timeline = gainTimeline((seconds) => ({ left: seconds, right: 2 * seconds }), 1, 10);
    expect(timeline.left.length).toBe(11);
    expect(gainsAt(timeline, 0.25).left).toBeCloseTo(0.25, 6);
    expect(gainsAt(timeline, 0.25).right).toBeCloseTo(0.5, 6);
    expect(gainsAt(timeline, -1).left).toBe(0);
    expect(gainsAt(timeline, 5).left).toBeCloseTo(1, 6);
  });

  it('follows the camera path: centred on him, leaning left while the head glances right, and fading as it backs away', () => {
    const script = demoScript();
    const centre = { x: 0, y: 1.45, z: -0.4 };
    const path = createCameraPath(
      script,
      { position: { x: 0, y: 1.6, z: 1.2 }, yaw: 0 },
      {
        centre,
        radius: 0.22,
        at: script.hintSeconds,
      },
    );
    const timeline = gainTimeline((seconds) => stereoGains(heardFrom(path.headAt(seconds), centre)), script.seconds);

    const settled = gainsAt(timeline, script.hintSeconds + 1.5);
    expect(settled.left).toBeCloseTo(settled.right, 1);
    expect(settled.left).toBeCloseTo(distanceGain(Math.hypot(1.6, 0.15)), 1);

    const glancing = gainsAt(timeline, (script.glance.start + script.glance.end) / 2);
    expect(20 * Math.log10(glancing.left / glancing.right)).toBeGreaterThan(3);

    const close = gainsAt(timeline, script.orbit.start + 2);
    expect(close.left).toBeCloseTo(close.right, 1);
    expect(close.left).toBeCloseTo(1, 2);

    const backed = gainsAt(timeline, script.seconds - 0.1);
    expect(backed.left).toBeLessThan(0.75);
    expect(backed.left).toBeCloseTo(backed.right, 1);
  });
});

describe('spatialSoundtrack', () => {
  const SAMPLE_RATE = 1000;
  const recording = new Float32Array(500).fill(0.5);
  const steady = gainTimeline(() => ({ left: 0.8, right: 0.4 }), 2, 10);

  it('lays the recording at every clip, raised to the film’s level and scaled for each ear', () => {
    const track = spatialSoundtrack(recording, [{ start: 0.1, duration: 0.3 }], steady, {
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      level: 2,
    });
    expect(track.left.length).toBe(2000);
    expect(track.left[99]).toBe(0);
    expect(track.left[100]).toBeCloseTo(0.5 * 2 * 0.8, 6);
    expect(track.right[200]).toBeCloseTo(0.5 * 2 * 0.4, 6);
    expect(track.left[400]).toBe(0);
  });

  it('fades a cut clip out over a few milliseconds instead of clicking, and stops at the film’s end', () => {
    const fadeSamples = Math.round(CUT_FADE_SECONDS * SAMPLE_RATE);
    const cut = spatialSoundtrack(recording, [{ start: 0, duration: 0.2 }], steady, {
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      level: 1,
    });
    expect(cut.left[199]).toBeLessThan(cut.left[199 - fadeSamples] ?? 0);
    expect(cut.left[199 - fadeSamples]).toBeCloseTo(0.4, 6);

    const late = spatialSoundtrack(recording, [{ start: 1.9, duration: 0.4 }], steady, {
      sampleRate: SAMPLE_RATE,
      seconds: 2,
      level: 1,
    });
    expect(late.left.length).toBe(2000);
    expect(late.left[1950]).toBeCloseTo(0.4, 6);
  });
});

describe('filmLevel', () => {
  it('raises the recording’s loudest sample to the film’s peak', () => {
    expect(filmLevel(new Float32Array([0.1, -0.2, 0.05]))).toBeCloseTo(FILM_PEAK / 0.2, 6);
    expect(filmLevel(new Float32Array(4))).toBe(1);
  });
});

describe('wavFile', () => {
  it('writes a stereo 32-bit float WAV, the channels interleaved', () => {
    const bytes = wavFile({ sampleRate: 48000, left: new Float32Array([0.25, -0.5]), right: new Float32Array([1, 0]) });
    const view = new DataView(bytes.buffer);
    const text = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(32);
    expect(text(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(16);
    expect(bytes.length).toBe(44 + 16);
    expect([0, 1, 2, 3].map((index) => view.getFloat32(44 + index * 4, true))).toEqual([0.25, 1, -0.5, 0]);
  });
});
