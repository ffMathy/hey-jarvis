/**
 * How many of Jarvis's particles a phone can afford, worked out while it draws them.
 *
 * The drawing's cost is its geometry: a GPU turns every stroked path into triangles, and this one
 * hands it more than a thousand that are different every frame. How many a given phone can manage
 * at the frame rate it is asked for is not a thing anyone can know in advance — it was 8 frames a
 * second on one phone and 58 in that same phone's browser — so instead of choosing a number, the
 * drawing measures what it is getting and moves the number until the number is right.
 *
 * It is a PID controller, in the incremental (velocity) form: each measurement decides how much to
 * *change* the particle count, not what the count should be. That form is the right one here
 * because the count itself is the integrator — which is also what makes the rate limits below
 * honest, and what makes running into the floor or the ceiling free of wind-up.
 *
 * Nothing here imports anything. It runs in a worklet on the UI thread, beside the drawing.
 *
 * ## What it steers by, and why it is not the frame rate
 *
 * The error is a **frame time**, not a frame rate, even though a frame rate is what it is handed.
 * They are reciprocals, so it looks like a distinction without a difference, and it is the single
 * most important thing in this file.
 *
 * Frame *time* is roughly a straight line in the particle count: a fixed cost for everything that
 * is not particles, plus a cost per particle. Frame *rate* is one over that, which is a hyperbola.
 * A controller has one set of gains, and one set of gains can only be right if the thing it steers
 * responds by the same amount wherever it happens to be. In frame-rate terms it does not: the same
 * handful of particles is worth twenty frames a second near the knee of the curve and two frames a
 * second away from it, so gains tuned where it is slow tear the count apart where it is fast.
 *
 * The reciprocal also makes the error wildly lopsided, which is what used to make the climb
 * unusable. Measured against a target of forty, a phone drawing at 120 reports an error of -2,
 * while the very worst a phone can report on the other side is +1. In frame time those same two
 * readings are -0.67 and +1 — the same order of magnitude, on both sides of the target, on every
 * screen. That is why the proportional and derivative terms can be used in both directions here,
 * where the previous version had to leave them off the climb and paper over the gap.
 *
 * ## What was here before, and why it could not settle
 *
 * The version this replaces called itself a PI controller, and the shape of it was
 * `density += -(Kp * error + Ki * carried) * dt`. That is a position-form PI — but its output was
 * a *rate*, and density is itself an integral of that rate. So the term labelled P was integrating
 * the error and the term labelled I was integrating it twice. There was no proportional action
 * anywhere in the loop, and a double integrator is a hundred and eighty degrees of phase lag: an
 * oscillator, which is what it was, and no amount of retuning those two numbers was ever going to
 * make it not be one. The rate limits were what held it together, which is why the comments used
 * to say the damping came from them.
 *
 * It also only ran in one direction. The whole `error < 0` half — every particle Jarvis gains on
 * the way in, on every launch — never looked at the gains at all; it halved the distance to a
 * remembered ceiling instead. A controller that is a controller for half its range is a heuristic
 * with a controller bolted to one side.
 *
 * ## Why the D term is here now
 *
 * It used to be left out deliberately, on the grounds that differentiating a noisy measurement
 * mostly produces more noise. That is true of the *raw* measurement, and the answer to it is the
 * low-pass filter below rather than doing without the term — because what D buys here is the one
 * thing nothing else can supply.
 *
 * The drawing gets cheaper and cheaper to the phone until suddenly it does not. Below the count a
 * phone can afford, every count looks the same: the frame rate is pinned to the screen's refresh
 * and the error sits at a constant, saying nothing at all about how much room is left. Then the
 * room runs out and the error moves. D is what notices it *moving* — it brakes on the change,
 * while the error itself is still small, which is the only warning the cliff ever gives.
 */

/**
 * The frame rate it steers toward, and the rate Jarvis actually runs at.
 *
 * Exactly forty, not a little under it. It used to sit under the view's cap because a measurement
 * saturates at the cap — at the cap exactly, "fast enough" and "could draw far more" read the same,
 * and the loop would settle wherever it happened to land. That is no longer a worry: the cap in
 * `hologram-view.tsx` is now a hundred and twenty, far above this, so there is real error on both
 * sides of forty and the loop can see it.
 *
 * Which means this number does the work. The loop *adds* particles until the frame rate falls to
 * here, so lowering it buys a denser sphere and raising it a smoother one.
 *
 * One thing it is worth knowing about forty on a sixty hertz screen: a screen presents whole
 * refreshes, so the rates it can actually hold are sixty, thirty, twenty — and forty is not among
 * them. A phone averaging forty there is really alternating, and the count that produces it sits
 * exactly where the drawing has just filled a refresh. That is a fine place to sit, and it is why
 * the settled band below is measured against the noise of the average rather than set to nothing.
 */
export const TARGET_FRAMES_PER_SECOND = 40;

/**
 * Never fewer than this share of the particles: past it he stops looking like himself.
 *
 * A share, and it therefore has to move whenever `PARTICLE_COUNT` does. What matters is the count
 * it works out to — about 250 fragments, which is where the swarm stops reading as a swarm — and
 * not the fraction. It was a fifth of a thousand, then a twentieth of five thousand, and it is a
 * fortieth of ten thousand, each time for the same reason: left alone while the ceiling rises, the
 * floor rises with it, and a phone that could manage three hundred would be pinned above what it
 * can draw and stutter for ever.
 *
 * A watch is the one place this lands somewhere else, knowingly. `watch-density.ts` builds a scene
 * of 1200, so a fortieth of it is thirty fragments rather than 250, and nothing here can tell the
 * difference: this module imports nothing and never sees a count, only a share. It is the right
 * trade there anyway — on a watch the floor is a last resort rather than a resting place, and a
 * watch that cannot hold the target at thirty fragments was never going to hold it at sixty.
 *
 * **It is a floor, not a destination.** Ending up here used to be routine — see `steerDensity` for
 * the single measurement that could send the whole sphere down to it — and that was a bug rather
 * than this constant doing its job.
 */
export const FEWEST_PARTICLES = 0.025;

/**
 * How wide a band around the target counts as arrived, in frame time.
 *
 * Inside it nothing moves at all. That is stronger than it sounds and it is deliberate: below the
 * measurement's own noise there is no information to act on, and acting on it anyway is exactly
 * what makes the swarm breathe. A rate averaged over half a second is roughly twenty-odd frames,
 * and on a screen that can only present whole refreshes those frames are a mix of two durations,
 * so the average carries a few percent of sampling noise all by itself. Six percent of the target
 * frame time — a modest millisecond and a half — sits just above it.
 */
const SETTLED_WITHIN = 0.06;

/**
 * The three gains, against an error measured in frame time and a step measured in share per second.
 *
 * The integral term is the one that finds the answer: it is what accumulates into a particle count
 * that holds the target, and it alone decides where the loop settles. P and D do not choose the
 * destination, they damp the journey — P against the error's movement, D against its acceleration.
 *
 * `INTEGRAL_GAIN` is large enough that on the way up the rate limit below is what actually paces
 * the climb rather than the gain, which is what makes the entrance the same on every phone: see
 * `RISING_PER_SECOND`. Near the target the settled band and `trust` have long since taken over, so
 * the size here costs nothing where it would otherwise hurt.
 */
const PROPORTIONAL_GAIN = 0.35;
const INTEGRAL_GAIN = 1.2;
const DERIVATIVE_GAIN = 0.08;

/**
 * How much of each new reading to believe, as a low-pass on the error.
 *
 * This is what makes a derivative term safe to take. It is also why the reading is filtered once,
 * here, and every term then works off the same filtered number: differencing two differently-aged
 * versions of the same signal is how a controller ends up chasing its own filter.
 */
const MEASUREMENT_SHARE = 0.3;

/**
 * The worst error worth believing, and the longest window worth counting as evidence.
 *
 * **These two are the whole of the bug this file was rewritten for, so they are worth reading
 * carefully.** A measurement arrives as a frame rate and a window, and the loop used to take both
 * at face value. When a phone stalls — a re-render, a collection, another app waking up — one
 * frame can take two seconds, and the window that contains it reports half a frame a second over
 * two seconds. Both halves of that then made the step bigger: the error was enormous because the
 * rate was nearly zero, and the step was scaled by a window that was four times its usual length.
 * The two multiplied, and one such window took the sphere from whatever it was drawing straight to
 * {@link FEWEST_PARTICLES} — the entire range, in a single measurement, from one slow frame.
 *
 * So: a rate below half the target is simply "too slow" and nothing is gained by knowing how much
 * too slow, and half a second is all the evidence a half-second window can hold however long the
 * wall clock says it took. A window longer than that is not more evidence, it is a stall.
 */
const WORST_ERROR = 1;
const LONGEST_WINDOW = 0.5;
const SHORTEST_WINDOW = 0.1;

/**
 * How fast the count may fall, and rise, as a share of the whole per second.
 *
 * **Asymmetric, and that is the design.** Dropping particles when the phone is struggling should
 * happen fast enough to be over before anyone reads it as stuttering; adding them back should be
 * steady and unhurried. Equal rates give the textbook result and the wrong behaviour: the loop
 * finds the edge of what the phone can do and then oscillates across it, which on screen is the
 * swarm breathing in and out.
 *
 * The rising rate is what the climb actually runs at. Below the count a phone can afford, its
 * frame rate is pinned to the screen's refresh and stays there whatever the count does, so the
 * measurement says only "there is room" and never how much — and a controller facing a sensor that
 * has stopped answering should move at a deliberate pace rather than at one computed from a number
 * that is not telling it anything. That pace is this. It is also therefore how long the entrance
 * takes: from {@link FEWEST_PARTICLES} to nearly all of them in about two seconds.
 *
 * The falling rate is a backstop rather than the usual path — with the clamps above in place the
 * controller's own step is nearly always the smaller of the two. It is what bounds the very worst
 * case, which is the case that used to be unbounded.
 */
const FALLING_PER_SECOND = 0.6;
const RISING_PER_SECOND = 0.45;

/**
 * How the loop shrinks its own footsteps when it starts to hunt, and grows them again when it is
 * getting somewhere.
 *
 * **This is what finally stopped the breathing, and it is worth explaining because it is not a
 * gain.** A phone cannot present part of a refresh, so between "the drawing fits in a frame" and
 * "it does not" there is nothing: a few hundred particles either side of that line is the
 * difference between sixty frames a second and thirty. The loop therefore faces a plant whose
 * sensitivity where it wants to sit is something like ten times what it is anywhere else, and no
 * single set of gains is right for both. Tuned for the flat part the loop crawls; tuned for the
 * cliff it tears the count apart every time the phone is merely busy.
 *
 * Rather than guess the sensitivity, the loop watches its own footprints. A step that undoes the
 * last one means it stepped over the line, so the next step is half the size; a step that carries
 * on in the same direction means there is still ground to cover, so the next is a little bigger.
 * Within a few seconds of arriving the steps are small enough that the count stops visibly moving,
 * and on a phone that is plainly nowhere near the line they stay full size.
 *
 * {@link PLAIN_TROUBLE} is the escape hatch. Shrinking makes sense while the loop is picking at
 * the edge of what a phone can do; it must not leave the loop picking at it when the phone has
 * genuinely fallen off a cliff. An error past here is not hunting, it is trouble, and it is
 * answered at full size.
 */
const TRUST_SHRINK = 0.5;
const TRUST_GROW = 1.3;
const LEAST_TRUST = 0.06;
const PLAIN_TROUBLE = 0.5;

/**
 * How much of a remembered count to begin with, next time.
 *
 * A tenth under what the phone managed before, at the user's asking, and the reason is that a
 * phone is not the same phone twice: what it had spare last time is not what it has spare now, and
 * beginning exactly at the old number means the first thing that happens is a shed. Starting just
 * under it means the first thing that happens is the climb finishing, which nobody notices.
 */
const REMEMBERED_MARGIN = 0.9;

export interface DensityControl {
  /** 0–1: the share of the particles being drawn. This is the controller's integrator. */
  density: number;
  /**
   * The most particles this phone has ever been seen drawing while holding the target, 0 until it
   * has.
   *
   * Only ever upward, and it is what is worth writing down and starting from next time: not a
   * guess about the hardware, but a thing this phone actually did. A busy minute should not be
   * allowed to talk it down — the loop will shed for the busy minute, and `density` is where that
   * shows; this is the high-water mark, and the point of a high-water mark is that it stays.
   */
  proven: number;
  /** The error, low-passed. See {@link MEASUREMENT_SHARE} — every term works off this one number. */
  error: number;
  /** What {@link error} was one window ago, and two, which is what P and D are differences of. */
  previousError: number;
  /** @see previousError */
  errorBeforeThat: number;
  /**
   * The last *unfiltered* reading, so that one bad window cannot dump the lot.
   *
   * Changing anything about the screen — walking to the next mood, say — re-renders it, and a
   * re-render rebuilds the drawing worklet, which Reanimated re-serialises the scene for. That is
   * one hitch, over in a frame or two, and it lands in a window half a second wide. Feeding the
   * filter the *gentler* of the last two raw readings costs half a second of reaction to a real
   * slowdown and rejects a lone spike outright.
   */
  lastReading: number;
  /** How many measurements have landed. Zero means nothing has been measured on this phone yet. */
  windows: number;
  /** How big a step to take, as a share of the one asked for. See {@link TRUST_SHRINK}. */
  trust: number;
  /** Which way the last step went, which is how the loop knows it has just turned around. */
  lastStep: number;
}

/**
 * Where it starts: at the floor, climbing — unless it is being handed what it had before.
 *
 * `startingDensity` is for the case where the hologram is built again over a screen that already
 * knew the answer. Nothing about the phone changed while a view was being remade, so beginning at
 * the floor again would be throwing away a measurement and making the user watch it be taken twice.
 *
 * Otherwise it begins sparse. It began at *everything*, on the reasoning that a phone which can
 * manage it never has to find out. What that looks like is the first second being the worst second
 * — Jarvis arrives stuttering and then recovers, which is the one moment anybody is looking at him.
 * Starting under what any phone can draw and climbing means the arrival is smooth and the swarm
 * fills in behind it, which is also just a better entrance.
 *
 * `RISING_PER_SECOND` is what makes that climb quick rather than a crawl: from here to everything
 * is a bit over two seconds on a phone that can take it.
 */
export function createDensityControl(startingDensity: number = FEWEST_PARTICLES): DensityControl {
  const density = startingDensity <= 0 ? FEWEST_PARTICLES : clamp(startingDensity, FEWEST_PARTICLES, 1);
  return {
    density,
    proven: 0,
    error: 0,
    previousError: 0,
    errorBeforeThat: 0,
    lastReading: 0,
    windows: 0,
    trust: 1,
    lastStep: 0,
  };
}

/**
 * Where to begin, given what this phone managed last time.
 *
 * Kept here rather than wherever the number is stored, because it is a decision about the loop
 * rather than about storage: see {@link REMEMBERED_MARGIN} for why it is not simply the old value.
 */
export function startFromRemembered(proven: number): number {
  return proven <= 0 ? FEWEST_PARTICLES : clamp(proven * REMEMBERED_MARGIN, FEWEST_PARTICLES, 1);
}

function clamp(value: number, lowest: number, highest: number): number {
  'worklet';
  return value < lowest ? lowest : value > highest ? highest : value;
}

/**
 * Starts a control at a remembered share, if it has not measured anything yet.
 *
 * **This exists because the remembered number arrives late.** Reading it back is a promise — a
 * keystore read on a phone, `localStorage` in a browser — so it is not there on the first render,
 * and the control is built on the first render. Handing it to `createDensityControl` therefore
 * handed it `undefined` every time: the number was written down faithfully, read back faithfully,
 * and then ignored, and the user watched the climb happen from scratch on every launch.
 *
 * Only before anything has been measured, and only upward. Once a real frame rate has been seen,
 * what the loop has worked out here and now beats anything remembered from last time; and a
 * remembered share below where the climb has already reached would be a step backwards.
 *
 * **Below `clamp`, and it has to be.** A worklet captures what it closes over in an object built
 * where the function is *defined*, and Reanimated's plugin rewrites a worklet from a hoisted
 * `function` declaration into a `const` that is not hoisted. Written above `clamp`, this captured
 * it before it existed, and the whole web bundle died on load with "Cannot access 'o' before
 * initialization" — a blank white page, from a source file where the ordering looked irrelevant
 * because function declarations hoist. The non-worklet functions above may still call `clamp`
 * freely: they are not transformed, and they run long after the module has finished loading.
 */
export function seedFromRemembered(control: DensityControl, share: number): void {
  'worklet';
  if (control.windows !== 0 || share <= control.density) {
    return;
  }
  control.density = clamp(share, FEWEST_PARTICLES, 1);
}

/**
 * Moves the particle count toward whatever holds {@link TARGET_FRAMES_PER_SECOND}.
 *
 * `framesPerSecond` of zero means nothing has been measured yet, and nothing is changed — the loop
 * must not act on the first frame, before there is a rate to act on. Neither does the first real
 * measurement: an incremental controller works in differences, and one reading has nothing to
 * differ from.
 */
export function steerDensity(control: DensityControl, framesPerSecond: number, deltaSeconds: number): void {
  'worklet';
  if (framesPerSecond <= 0 || deltaSeconds <= 0) {
    return;
  }

  // Half a second's worth at most, however long the wall clock says this took: see LONGEST_WINDOW.
  const windowSeconds = clamp(deltaSeconds, SHORTEST_WINDOW, LONGEST_WINDOW);
  // The error, in frame time, normalised by the target — which is exactly the target rate over the
  // measured one, less one. Positive when the phone is too slow, which is when particles have to
  // go. Bounded below by -1 whatever the screen does, and clamped above: see WORST_ERROR.
  const reading = clamp(TARGET_FRAMES_PER_SECOND / framesPerSecond - 1, -1, WORST_ERROR);

  if (framesPerSecond >= TARGET_FRAMES_PER_SECOND && control.density > control.proven) {
    // Holding the target at this many is the phone saying it can, and that is worth writing down.
    control.proven = control.density;
  }

  if (control.windows === 0) {
    // Nothing to difference against yet. Start the filter *at* the reading rather than at zero, or
    // the first second of every launch is spent watching a filter catch up with a phone.
    control.windows = 1;
    control.error = reading;
    control.previousError = reading;
    control.errorBeforeThat = reading;
    control.lastReading = reading;
    return;
  }
  control.windows += 1;

  // The gentler of this reading and the last, so that a lone hitch is not a verdict.
  const trusted = reading < control.lastReading ? reading : control.lastReading;
  control.lastReading = reading;

  control.errorBeforeThat = control.previousError;
  control.previousError = control.error;
  control.error += (trusted - control.error) * MEASUREMENT_SHARE;

  const error = control.error;
  if (error > -SETTLED_WITHIN && error < SETTLED_WITHIN) {
    // Arrived, and inside the band nothing moves: see SETTLED_WITHIN.
    return;
  }

  // The incremental PID. P answers how fast the error is moving, I answers the error itself, and D
  // answers whether it is picking up speed — which is the cliff arriving.
  const moving = error - control.previousError;
  const gathering = error - 2 * control.previousError + control.errorBeforeThat;
  const wanted = -(
    PROPORTIONAL_GAIN * moving +
    INTEGRAL_GAIN * error * windowSeconds +
    (DERIVATIVE_GAIN * gathering) / windowSeconds
  );

  if (error > PLAIN_TROUBLE || error < -PLAIN_TROUBLE) {
    // Not hunting: this phone is a long way from where it should be, so take the whole step.
    control.trust = 1;
  } else if (control.lastStep !== 0) {
    control.trust =
      wanted * control.lastStep < 0
        ? Math.max(LEAST_TRUST, control.trust * TRUST_SHRINK)
        : Math.min(1, control.trust * TRUST_GROW);
  }

  const step = clamp(wanted * control.trust, -FALLING_PER_SECOND * windowSeconds, RISING_PER_SECOND * windowSeconds);
  const before = control.density;
  control.density = clamp(control.density + step, FEWEST_PARTICLES, 1);
  // What actually happened, which is what the next step is judged against — the step asked for and
  // the step taken are different things at the floor, at the ceiling and at the rate limits.
  control.lastStep = control.density - before;
}
