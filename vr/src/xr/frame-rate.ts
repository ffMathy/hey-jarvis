/**
 * Which display rate to ask the headset for.
 *
 * A Quest runs an immersive page at whatever `updateTargetFrameRate` asks for, out of the rates in
 * `supportedFrameRates` (a Quest 3 offers 72, 80, 90 and 120). While Jarvis waits for the wake word
 * nothing is drawn at all, and every frame the headset composites is battery spent on an empty
 * layer, so the room asks for the lowest. The moment he is summoned it asks for the highest up to
 * {@link HIGHEST_WANTED_FRAME_RATE}: he is mostly motion, and motion is what a low rate shows.
 */

/**
 * The fastest the room ever asks for.
 *
 * Not 120: that is a third more fill for a hologram that is glow and particles, on a headset that
 * is also running a wake-word model and a WebRTC call, and 90 is already the rate a Quest 3 treats
 * as its own.
 */
export const HIGHEST_WANTED_FRAME_RATE = 90;

export type FrameRateTarget = 'lowest' | 'highest';

/** The rate to ask for, or undefined when the headset offers no choice. */
export function chooseFrameRate(supported: ArrayLike<number> | undefined, target: FrameRateTarget): number | undefined {
  const rates = Array.from(supported ?? []).filter((rate) => Number.isFinite(rate) && rate > 0);
  if (rates.length === 0) return undefined;
  const lowest = Math.min(...rates);
  if (target === 'lowest') return lowest;
  const wanted = rates.filter((rate) => rate <= HIGHEST_WANTED_FRAME_RATE);
  return wanted.length > 0 ? Math.max(...wanted) : lowest;
}
