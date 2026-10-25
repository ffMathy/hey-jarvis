import type { JarvisVoice, UserVoice } from './voice-contract';
import { bandEdges, VOICE_BAND_COUNT } from './voice-levels';

/**
 * Jarvis drawn on one device from a conversation held on another: the watch showing what the phone's
 * sphere is doing, when the phone took the summoning into its earbuds.
 *
 * The watch cannot hear that conversation — it is in the phone's AirPods — so the phone sends it what
 * its own sphere is being handed, a few times a second: whether he is talking and how loud, his
 * spectrum folded down to the bands the drawing uses, whether someone is talking to him, and whether
 * he is thinking. The watch hands those to its sphere as a voice and a listener of its own, and he
 * moves on the wrist as he would have if the conversation were there.
 *
 * Plain bytes, encoded and decoded here so that both ends are one file: a Data Layer message is a
 * byte array, and a frame is {@link MIRROR_FRAME_LENGTH} of them —
 *
 * | Byte | Holds |
 * | --- | --- |
 * | 0 | {@link MIRROR_FRAME_VERSION} |
 * | 1 | flags: listening, speaking, thinking, and whether there is a listener at all |
 * | 2 | his volume, square-root coded so that quiet speech keeps its resolution |
 * | 3 | the listener's presence, ElevenLabs' `vad_score` |
 * | 4 | the listener's volume, coded as his is |
 * | 5… | {@link VOICE_BAND_COUNT} band means, 0–255, of his spectrum |
 *
 * The bands are the *means* the drawing would fold his spectrum into, not the folded values: handed
 * back to `foldSpectrum` as a spectrum one bin a band, each folds to exactly what the phone's did.
 * A whole spectrum would be a kilobyte a frame over Bluetooth for nothing the drawing reads.
 */

/** Which layout a frame is in, so a phone and a watch a release apart ignore each other rather than misread. */
export const MIRROR_FRAME_VERSION = 1;

/** How long a frame is: the header, and a byte a band. */
export const MIRROR_FRAME_LENGTH = 5 + VOICE_BAND_COUNT;

/**
 * How often the phone sends one.
 *
 * Twice the drawing's own reading interval: the sphere eases toward each reading anyway, so twelve a
 * second still moves smoothly, and the Data Layer is a Bluetooth link that also carries everything
 * else the watch does.
 */
export const MIRROR_INTERVAL_MS = 80;

/**
 * How long without a frame before the watch takes him to be at rest.
 *
 * The phone says when it stops (an empty frame, see {@link isMirrorEnd}), but a message can be lost,
 * and a phone that went out of range says nothing. Long enough to ride out a few dropped frames.
 */
export const MIRROR_STALE_MS = 1500;

const LISTENING = 1;
const SPEAKING = 2;
const THINKING = 4;
const HAS_USER = 8;

/** What the phone's sphere is being handed at one moment. */
export interface MirroredSphereState {
  voice: Pick<JarvisVoice, 'listening' | 'speaking' | 'getVolume' | 'getSpectrum'>;
  user?: UserVoice;
  thinking: boolean;
}

/** One frame, read back. */
export interface MirrorFrame {
  listening: boolean;
  speaking: boolean;
  thinking: boolean;
  /** Whether the phone's sphere was handed a listener at all. */
  hasUser: boolean;
  volume: number;
  presence: number;
  userVolume: number;
  /** {@link VOICE_BAND_COUNT} band means, 0–255: a spectrum one bin a band. */
  bands: number[];
}

/** Him doing nothing: what the watch shows before the first frame and after the last. */
export const MIRROR_AT_REST: MirrorFrame = {
  listening: false,
  speaking: false,
  thinking: false,
  hasUser: false,
  volume: 0,
  presence: 0,
  userVolume: 0,
  bands: new Array<number>(VOICE_BAND_COUNT).fill(0),
};

/** A byte from 0–1. */
function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255);
}

/**
 * Each band's mean bin, as `foldSpectrum` would take it before its square root: so the watch,
 * folding these, gets the phone's bands back. Silence for a spectrum too short to fold, as there.
 */
export function bandMeans(spectrum: ArrayLike<number>, bandCount: number = VOICE_BAND_COUNT): number[] {
  if (spectrum.length < bandCount) {
    return new Array<number>(bandCount).fill(0);
  }
  const edges = bandEdges(spectrum.length, bandCount);
  const means: number[] = [];
  for (let band = 0; band < bandCount; band++) {
    const start = edges[band] ?? 0;
    const end = edges[band + 1] ?? spectrum.length;
    let sum = 0;
    for (let index = start; index < end; index++) {
      sum += spectrum[index] ?? 0;
    }
    means.push(Math.round(Math.min(255, Math.max(0, sum / Math.max(1, end - start)))));
  }
  return means;
}

/**
 * Reads the phone's sphere once, into a frame to send. Nothing is read from a voice that is not
 * listening, as the drawing reads nothing from one.
 */
export function encodeMirrorFrame({ voice, user, thinking }: MirroredSphereState): number[] {
  const flags =
    (voice.listening ? LISTENING : 0) |
    (voice.speaking ? SPEAKING : 0) |
    (thinking ? THINKING : 0) |
    (user ? HAS_USER : 0);
  const volume = voice.listening ? Math.sqrt(Math.max(0, voice.getVolume())) : 0;
  const bands = voice.listening ? bandMeans(voice.getSpectrum()) : MIRROR_AT_REST.bands;
  return [
    MIRROR_FRAME_VERSION,
    flags,
    toByte(volume),
    toByte(user ? user.getPresence() : 0),
    toByte(user ? Math.sqrt(Math.max(0, user.getVolume())) : 0),
    ...bands,
  ];
}

/** Whether a message is the phone saying it has stopped: an empty one. */
export function isMirrorEnd(frame: ArrayLike<number>): boolean {
  return frame.length === 0;
}

/** A frame read back, or `undefined` for anything that is not one in this layout. */
export function decodeMirrorFrame(frame: ArrayLike<number>): MirrorFrame | undefined {
  if (frame.length !== MIRROR_FRAME_LENGTH || frame[0] !== MIRROR_FRAME_VERSION) {
    return undefined;
  }
  const byte = (index: number) => (frame[index] ?? 0) & 0xff;
  const flags = byte(1);
  const bands: number[] = [];
  for (let band = 0; band < VOICE_BAND_COUNT; band++) {
    bands.push(byte(5 + band));
  }
  return {
    listening: (flags & LISTENING) !== 0,
    speaking: (flags & SPEAKING) !== 0,
    thinking: (flags & THINKING) !== 0,
    hasUser: (flags & HAS_USER) !== 0,
    volume: (byte(2) / 255) ** 2,
    presence: byte(3) / 255,
    userVolume: (byte(4) / 255) ** 2,
    bands,
  };
}

/** What a watch hands its sphere while it mirrors the phone, and how it is fed. */
export interface SphereMirror {
  /** Takes one message from the phone, at `nowMs`. Says whether the flags the view renders from changed. */
  receive(frame: ArrayLike<number>, nowMs: number): boolean;
  /** The latest frame, or him at rest once none has come for {@link MIRROR_STALE_MS}. */
  current(nowMs: number): MirrorFrame;
  /** Readers for his voice, over {@link current}. Stable, so the view's polling is too. */
  voice: Pick<JarvisVoice, 'getVolume' | 'getSpectrum'>;
  /** And for the listener's, likewise. */
  user: UserVoice;
}

/**
 * The watch's end: holds the latest frame and reads it out as a voice and a listener.
 *
 * `now` is handed in rather than read, so the staleness is testable; the watch gives it
 * `Date.now`.
 */
export function createSphereMirror(now: () => number): SphereMirror {
  let latest: MirrorFrame = MIRROR_AT_REST;
  let receivedAt = Number.NEGATIVE_INFINITY;

  const current = (nowMs: number) => (nowMs - receivedAt > MIRROR_STALE_MS ? MIRROR_AT_REST : latest);

  return {
    receive(frame, nowMs) {
      const before = current(nowMs);
      if (isMirrorEnd(frame)) {
        latest = MIRROR_AT_REST;
        receivedAt = Number.NEGATIVE_INFINITY;
      } else {
        const decoded = decodeMirrorFrame(frame);
        if (!decoded) {
          return false;
        }
        latest = decoded;
        receivedAt = nowMs;
      }
      return !sameFlags(before, current(nowMs));
    },
    current,
    voice: {
      getVolume: () => current(now()).volume,
      getSpectrum: () => current(now()).bands,
    },
    user: {
      getPresence: () => current(now()).presence,
      getVolume: () => current(now()).userVolume,
    },
  };
}

/** Whether two frames would render the same — every flag the view takes as a prop. */
export function sameFlags(a: MirrorFrame, b: MirrorFrame): boolean {
  return (
    a.listening === b.listening && a.speaking === b.speaking && a.thinking === b.thinking && a.hasUser === b.hasUser
  );
}
