/**
 * How many of Jarvis's particles a phone can afford, worked out while it draws them.
 *
 * The drawing's cost is its geometry: a GPU turns every stroked path into triangles, and this one
 * hands it more than a thousand that are different every frame. How many a given phone can manage
 * at sixty frames a second is not a thing anyone can know in advance — it was 8 frames a second on
 * one phone and 58 in that same phone's browser — so instead of choosing a number, the drawing
 * measures what it is getting and moves the number until the number is right.
 *
 * It is a PI controller. The user asked for PID, and the D is deliberately absent: the measurement
 * is a frame rate averaged over half a second, which is noisy, and differentiating noise mostly
 * produces more noise. What the D term would buy — damping — comes instead from the rate limits
 * below, which are the thing that actually stops this hunting.
 *
 * Nothing here imports anything. It runs in a worklet on the UI thread, beside the drawing.
 */

/**
 * The frame rate it steers toward.
 *
 * Under the sixty the view caps at, on purpose. At sixty exactly the measurement saturates — the
 * cap holds it there — so the controller would have no way to tell "just fast enough" from "could
 * draw twice as much", and would sit wherever it happened to land. Aiming a little under keeps a
 * real error on both sides of the target.
 */
export const TARGET_FRAMES_PER_SECOND = 57;

/** Never fewer than this share of the particles: past it he stops looking like himself. */
export const FEWEST_PARTICLES = 0.2;

/**
 * How wide a band around the target counts as arrived, as a share of it.
 *
 * Without one the controller answers every wobble in the measurement and the particle count
 * wanders visibly. Three percent of 57 is under two frames a second, which is smaller than the
 * measurement's own noise.
 */
const SETTLED_WITHIN = 0.03;

/** How hard it answers the error it can see, and the error it has been seeing. */
const PROPORTIONAL_GAIN = 1.4;
const INTEGRAL_GAIN = 0.35;

/**
 * How fast the count may fall, and rise, as a share of the whole per second.
 *
 * **Asymmetric, and that is the design.** Dropping particles when the phone is struggling should
 * happen fast enough to be over before anyone reads it as stuttering; adding them back should be
 * slow enough that nobody catches it happening. Equal rates give the textbook result and the wrong
 * behaviour: the loop finds the edge of what the phone can do and then oscillates across it,
 * which on screen is the swarm breathing in and out.
 */
const FALLING_PER_SECOND = 0.9;
const RISING_PER_SECOND = 0.12;

/** How much accumulated error the integral may carry, so a long slow patch cannot wind it up. */
const CARRIED_LIMIT = 0.5;

export interface DensityControl {
  /** 0–1: the share of the particles being drawn. */
  density: number;
  /** The integral term: how long it has been wrong, and by how much. */
  carried: number;
}

/** Everything on, and nothing learned yet. A phone that can manage it never has to find out. */
export function createDensityControl(): DensityControl {
  return { density: 1, carried: 0 };
}

function clamp(value: number, lowest: number, highest: number): number {
  'worklet';
  return value < lowest ? lowest : value > highest ? highest : value;
}

/**
 * Moves the particle count toward whatever holds {@link TARGET_FRAMES_PER_SECOND}.
 *
 * `framesPerSecond` of zero means nothing has been measured yet, and nothing is changed — the loop
 * must not act on the first frame, before there is a rate to act on.
 */
export function steerDensity(control: DensityControl, framesPerSecond: number, deltaSeconds: number): void {
  'worklet';
  if (framesPerSecond <= 0 || deltaSeconds <= 0) {
    return;
  }

  // Positive when the phone is too slow, which is when particles have to go.
  const error = (TARGET_FRAMES_PER_SECOND - framesPerSecond) / TARGET_FRAMES_PER_SECOND;

  if (error > -SETTLED_WITHIN && error < SETTLED_WITHIN) {
    // Arrived. Let what it has been carrying drain away, so that coming back to the target twice
    // from the same side does not leave the loop leaning.
    control.carried -= control.carried * deltaSeconds;
    return;
  }

  control.carried = clamp(control.carried + error * deltaSeconds, -CARRIED_LIMIT, CARRIED_LIMIT);

  const push = PROPORTIONAL_GAIN * error + INTEGRAL_GAIN * control.carried;
  const limit = (push > 0 ? FALLING_PER_SECOND : RISING_PER_SECOND) * deltaSeconds;
  const step = clamp(-push * deltaSeconds, -limit, limit);

  control.density = clamp(control.density + step, FEWEST_PARTICLES, 1);
}
