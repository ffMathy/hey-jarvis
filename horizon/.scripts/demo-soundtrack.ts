import { REFERENCE_DISTANCE_METRES, ROLLOFF } from '../src/conversation/spatial-voice';
import type { RoomPoint } from '../src/debug-hook';
import { rotate } from '../src/xr/ray';
import type { GreetingClip } from './demo-encode';
import type { Pose } from './demo-shot';

/**
 * The demo video's soundtrack: his greeting as the filmed head would hear it from where he stands.
 *
 * The app plays his voice through an HRTF panner at his anchor, with the listener following the
 * head (`src/conversation/spatial-voice.ts`). The film does the same offline, from the very camera
 * path the pictures are shot along (`demo-shot.ts`): every few milliseconds it works out where he
 * is relative to the head — how far, and how far round to one side — and turns that into a gain
 * for each ear, which every sample of the greeting is then multiplied by.
 *
 * **Loudness** follows the app's own distance model exactly: Web Audio's `inverse` model with the
 * app's reference distance and rolloff, so he is at full level within a metre, at 1/1.3 of it at
 * 1.6 m, and quieter still as the head backs away.
 *
 * **Direction** is an equal-power pan rather than an HRTF. A film is heard on speakers as often as
 * on headphones, where an HRTF's filtering sounds like a fault; a pan says left or right plainly
 * on both. It is kept narrow (see {@link PAN_WIDTH}), so a voice to one side leans that way rather
 * than jumping into one ear. Straight ahead, both ears get exactly the distance model's gain, so a
 * film in which he is always centred sounds just as the app would.
 */

/** Where he is as the head hears him, in metres: to its right, above it, and ahead of it. */
export interface HeardFrom {
  right: number;
  up: number;
  ahead: number;
}

/** What each ear hears of him, as a multiple of the recording. */
export interface StereoGains {
  left: number;
  right: number;
}

/**
 * How far to one side a voice heard from straight beside the head is panned, from 0 (centred) to 1
 * (only in that ear).
 *
 * 0.6 leaves the far ear about 10 dB below the near one for a voice at 90°, and about 4 dB for one
 * 30° off — near what a head's own shadow does to a voice, and never so much that turning feels
 * like a switch being thrown.
 */
export const PAN_WIDTH = 0.6;

/** How often the gains are worked out along the film, per second; samples between are interpolated. */
export const GAIN_SAMPLES_PER_SECOND = 200;

/**
 * How long the greeting takes to fall silent where a select cuts it off mid-word, in seconds: long
 * enough that the cut is not a click, short enough to still sound like a cut.
 */
export const CUT_FADE_SECONDS = 0.008;

/**
 * The loudest the recording is let reach, as a share of full scale, heard from a metre ahead or
 * nearer: about −3 dBFS. The recording itself peaks at −16 dBFS, which a headset's volume makes up
 * for; a film is played at whatever level its viewer's player happens to be at, so it is raised.
 * Equal power keeps the near ear under 1.35 times this, so nothing clips.
 */
export const FILM_PEAK = 0.7;

/** Where `speaker` is relative to `head`: the room's offset between them, turned into the head's frame. */
export function heardFrom(head: Pose, speaker: RoomPoint): HeardFrom {
  const { x, y, z, w } = head.orientation;
  const offset = {
    x: speaker.x - head.position.x,
    y: speaker.y - head.position.y,
    z: speaker.z - head.position.z,
  };
  // The inverse of a unit quaternion is its conjugate, which undoes the head's turn.
  const local = rotate(offset, { x: -x, y: -y, z: -z, w });
  // An XR view looks down its −Z, with +X to its right and +Y up.
  return { right: local.x, up: local.y, ahead: -local.z };
}

/**
 * The app's distance model: Web Audio's `inverse`, with the panner's reference distance and
 * rolloff from `spatial-voice.ts`. Nothing is lost within the reference distance, and the maximum
 * distance does not come into it — Web Audio uses that only in its `linear` model.
 */
export function distanceGain(distanceMetres: number): number {
  const beyond = Math.max(distanceMetres, REFERENCE_DISTANCE_METRES) - REFERENCE_DISTANCE_METRES;
  return REFERENCE_DISTANCE_METRES / (REFERENCE_DISTANCE_METRES + ROLLOFF * beyond);
}

/**
 * Each ear's gain for a voice heard `from` there: the distance model's gain, panned with equal
 * power by how far round to the side he is.
 *
 * The pan follows the sine of his angle off the line straight ahead (his distance to the right,
 * over his distance), so a voice ahead is centred, one beside the head is panned furthest, and one
 * behind is centred again — which is as much as two channels can say. The gains are scaled so a
 * centred voice gets the distance gain in each ear, and the power of the two together is the same
 * wherever he is.
 */
export function stereoGains(from: HeardFrom): StereoGains {
  const distance = Math.hypot(from.right, from.up, from.ahead);
  const gain = distanceGain(distance);
  const sideways = distance > 0 ? from.right / distance : 0;
  const angle = ((PAN_WIDTH * sideways + 1) * Math.PI) / 4;
  return { left: gain * Math.SQRT2 * Math.cos(angle), right: gain * Math.SQRT2 * Math.sin(angle) };
}

/** Each ear's gain along the film, {@link GAIN_SAMPLES_PER_SECOND} times a second. */
export interface GainTimeline {
  samplesPerSecond: number;
  left: Float32Array;
  right: Float32Array;
}

/** `gainsAt` sampled from the start of the film to its end, at `samplesPerSecond`. */
export function gainTimeline(
  gainsAt: (seconds: number) => StereoGains,
  seconds: number,
  samplesPerSecond = GAIN_SAMPLES_PER_SECOND,
): GainTimeline {
  const count = Math.ceil(seconds * samplesPerSecond) + 1;
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const gains = gainsAt(index / samplesPerSecond);
    left[index] = gains.left;
    right[index] = gains.right;
  }
  return { samplesPerSecond, left, right };
}

/**
 * The gains at `seconds`, interpolated between the two samples either side: a gain that stepped
 * every five milliseconds would be heard as a buzz while the head moved.
 */
export function gainsAt(timeline: GainTimeline, seconds: number): StereoGains {
  const last = timeline.left.length - 1;
  const position = Math.max(0, Math.min(last, seconds * timeline.samplesPerSecond));
  const below = Math.floor(position);
  const above = Math.min(last, below + 1);
  const share = position - below;
  const blend = (table: Float32Array) => (table[below] ?? 0) * (1 - share) + (table[above] ?? 0) * share;
  return { left: blend(timeline.left), right: blend(timeline.right) };
}

/** The gain that brings `recording`'s loudest sample to {@link FILM_PEAK}; 1 for a silent one. */
export function filmLevel(recording: Float32Array): number {
  let peak = 0;
  for (const sample of recording) peak = Math.max(peak, Math.abs(sample));
  return peak > 0 ? FILM_PEAK / peak : 1;
}

/** The film's two channels, one sample per `sampleRate`th of a second. */
export interface StereoTrack {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}

export interface SoundtrackOptions {
  sampleRate: number;
  /** How long the film is. */
  seconds: number;
  /** What the recording is multiplied by before it is panned: {@link filmLevel}. */
  level: number;
}

/**
 * The film's soundtrack: `recording` (mono, at the track's sample rate) laid at every clip, each
 * sample heard as the head hears him at that moment.
 *
 * Every clip starts the recording from its beginning and stops it after the clip's duration, fading
 * the last {@link CUT_FADE_SECONDS} so a cut mid-word does not click. Clips that ran past the end
 * of the film are cut there.
 */
export function spatialSoundtrack(
  recording: Float32Array,
  clips: readonly GreetingClip[],
  timeline: GainTimeline,
  options: SoundtrackOptions,
): StereoTrack {
  const { sampleRate, level } = options;
  const length = Math.round(options.seconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const fadeSamples = Math.max(1, Math.round(CUT_FADE_SECONDS * sampleRate));
  for (const clip of clips) {
    const first = Math.round(clip.start * sampleRate);
    const count = Math.min(Math.round(clip.duration * sampleRate), recording.length, length - first);
    for (let index = 0; index < count; index += 1) {
      const out = first + index;
      if (out < 0) continue;
      const fade = Math.min(1, (count - index) / fadeSamples);
      const sample = (recording[index] ?? 0) * level * fade;
      const gains = gainsAt(timeline, out / sampleRate);
      left[out] = (left[out] ?? 0) + sample * gains.left;
      right[out] = (right[out] ?? 0) + sample * gains.right;
    }
  }
  return { sampleRate, left, right };
}

/**
 * `track` as a WAV file: 32-bit float, the two channels interleaved, which ffmpeg reads without
 * losing anything before it encodes the Opus.
 */
export function wavFile(track: StereoTrack): Uint8Array<ArrayBuffer> {
  const channels = 2;
  const bytesPerSample = 4;
  const frames = Math.min(track.left.length, track.right.length);
  const dataBytes = frames * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  // Format 3 is IEEE float.
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, track.sampleRate, true);
  view.setUint32(28, track.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  text(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < frames; frame += 1) {
    view.setFloat32(44 + frame * 8, track.left[frame] ?? 0, true);
    view.setFloat32(48 + frame * 8, track.right[frame] ?? 0, true);
  }
  return new Uint8Array(buffer);
}
