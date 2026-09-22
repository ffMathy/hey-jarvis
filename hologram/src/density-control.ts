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
 * ## What it steers by: how long a picture takes to build
 *
 * **The frame rate cannot be steered to, on a real screen.** A phone presents whole refreshes, so
 * on a sixty hertz screen it runs at sixty frames a second or thirty and nothing in between — and
 * the target is forty. Aimed at a number it can never reach, the integral term never rests: below
 * the edge it reads "room" and climbs, past it "too many" and sheds, and it goes round that loop for
 * as long as Jarvis is on screen. Worse, the frame rate says nothing at all below the edge — it sits
 * at the refresh whatever the count is — and then halves in one step. A PID wants a signal that
 * moves a little when the count moves a little, and the frame rate is the opposite of that.
 *
 * How long each picture takes to build is exactly that signal. It is timed on the thread that
 * does it, it grows steadily with every particle drawn, and it is not rounded to a refresh. So the
 * loop steers the mean build time of each window toward {@link BUILD_BUDGET_MS}, and settles.
 *
 * **It does not see the painting**, which is Skia's half of a frame and happens after the picture
 * is handed over. So the frame rate is kept as a backstop rather than a target: two windows running
 * behind it set a ceiling the count may not climb past (see {@link BELOW_WHERE_IT_FELL}), which
 * catches a phone whose painting runs out of room before its building does. And with no build
 * time to go on — nothing timed yet — the loop steers by the frame rate as it used to.
 *
 * ## Why an error in time rather than in rate
 *
 * Build time is a time already, and so is the frame-rate reading: the error is a **frame time**,
 * not a frame rate, even though a frame rate is what it is handed. They are reciprocals, so it
 * looks like a distinction without a difference, and it matters.
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
 * How long building one picture may take on average, in milliseconds: half of a sixty hertz frame.
 *
 * The other half is for painting it, and for everything else the thread does. That split is a
 * guess rather than a measurement — nobody has yet read both halves off a phone — and it is safe
 * either way round: a phone whose painting needs more than half is caught by the frame-rate
 * ceiling, and one that needs less simply draws a little under what it could.
 */
export const BUILD_BUDGET_MS = 8;

/**
 * What a device asks the loop to hold: the frame rate it steers to and how long a picture may take
 * to build. A phone's is {@link PHONE_PACE}; a watch asks for fewer frames and more particles.
 */
export interface DensityPace {
  targetFramesPerSecond: number;
  buildBudgetMs: number;
}

/** The phone's pace: {@link TARGET_FRAMES_PER_SECOND} and {@link BUILD_BUDGET_MS}. */
export const PHONE_PACE: DensityPace = {
  targetFramesPerSecond: TARGET_FRAMES_PER_SECOND,
  buildBudgetMs: BUILD_BUDGET_MS,
};

/**
 * The watch's pace: thirty frames a second, and half of a thirty-hertz frame to build each picture.
 *
 * **At the user's asking, and for a dense sphere rather than a smooth one.** At the phone's pace the
 * watch ran "super smooth, almost too smooth" — spare capacity spent on frames nobody needs on a
 * wrist, where it could have been spent on particles. Thirty is also a rate a sixty-hertz watch
 * face can actually hold, being every other refresh, so the loop has a real place to settle.
 */
export const WATCH_PACE: DensityPace = {
  targetFramesPerSecond: 30,
  buildBudgetMs: 16,
};

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
 * of 5000, so a fortieth of it is 125 fragments rather than 250, and nothing here can tell the
 * difference: this module imports nothing and never sees a count, only a share. It is the right
 * trade there anyway — on a watch the floor is a last resort rather than a resting place.
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
 * takes: from {@link FEWEST_PARTICLES} to nearly all of them in about six seconds.
 *
 * **It was three times this, and that was most of what the user saw go wrong.** A reading can only
 * say the phone has fallen behind once a whole window has been drawn too slowly, and the filter and
 * the lone-hitch rejection below add a window or two more before anything moves. At nearly half
 * the swarm a second, that is thousands of particles added past the edge before the loop has heard
 * about the edge at all: Jarvis arrived smooth, lagged a second later, and then shed and climbed
 * back into the same lag. Slower, the overshoot a late reading costs is a few hundred particles,
 * and he fills in behind his arrival rather than in a rush that the phone then has to pay for.
 *
 * The falling rate is a backstop rather than the usual path — with the clamps above in place the
 * controller's own step is nearly always the smaller of the two. It is what bounds the very worst
 * case, which is the case that used to be unbounded.
 */
const FALLING_PER_SECOND = 0.6;
const RISING_PER_SECOND = 0.15;

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
 * How much of a remembered count to begin with, next time: half of it.
 *
 * **Half, and the halving is the whole point rather than a margin on it.** It was nine tenths, on
 * the reasoning that a phone which managed a number yesterday will manage it today and the climb
 * is two seconds nobody should have to watch. That reasoning has a hole in it, and the hole is
 * what the user actually saw: a phone is not the same phone twice. The number was proved on a cool
 * phone with nothing else running, and it was then handed back verbatim to a hot phone with a
 * conversation, a microphone and whatever else Android felt like doing — which drew all of them at
 * a few frames a second, and then died.
 *
 * Beginning at half of it means the phone is never asked, cold, for more than it has already been
 * seen to hold comfortably, and the loop spends its first second finding out what today's phone is
 * good for rather than recovering from an assumption about yesterday's. Climbing back from a half
 * costs a few seconds at {@link RISING_PER_SECOND} — and that second is spent going *up*,
 * which is the direction nobody notices. The second it replaces was spent shedding, which is the
 * direction everybody does.
 *
 * With nothing remembered at all there is nothing to halve, and the loop starts at
 * {@link FEWEST_PARTICLES} — see `startFromRemembered`.
 */
const REMEMBERED_SHARE = 0.5;

/**
 * How far under the count where the phone fell behind the loop may climb back to: at most nine
 * tenths of it, and less the further behind it fell.
 *
 * **This is what stops the loop climbing straight back into the lag it has just left.** On a sixty
 * hertz screen a phone presents sixty frames a second or thirty, and nothing in between — so
 * {@link TARGET_FRAMES_PER_SECOND} is not a rate it can sit at. Below the edge it reads sixty, which
 * says "room", and the loop climbs; past the edge it reads thirty, which says "too many", and the
 * loop sheds. Without a memory of the edge that is the loop's whole life: climb, lag, shed, climb,
 * lag — the sphere stuttering every few seconds for as long as it is on screen, on a phone that
 * gets hotter every time and whose edge therefore comes lower every time, until it does not come
 * back. Which is what the user watched: too many particles, a lag, *more* particles, and a freeze.
 *
 * So the first time the phone is seen falling behind — two windows running, so a lone hitch cannot
 * do it — the lower of the two counts it fell behind at becomes a ceiling, scaled by how far short
 * of the target it fell, and the loop does not climb above it again for the rest of this
 * appearance. Frame time is roughly a straight line in the count, so a phone making three quarters
 * of the target at some count can afford about three quarters of it; the scale is that, never more
 * than {@link BELOW_WHERE_IT_FELL} so there is always a margin, and never less than
 * {@link FARTHEST_BELOW_WHERE_IT_FELL}, because a reading that far off is more likely a stall than a
 * measurement of what the particles cost. It only ever comes
 * down: a phone that falls behind under the ceiling has shown the edge is lower now, usually
 * because it is hotter or busier, and gets a lower one. The next appearance starts afresh and finds
 * its own.
 */
const BELOW_WHERE_IT_FELL = 0.9;
const FARTHEST_BELOW_WHERE_IT_FELL = 0.5;

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
   *
   * **Only counts where the loop has arrived, and that is a correction rather than a refinement.**
   * It used to be set from any window at all whose frame rate cleared the target, which sounds
   * like the same thing and is not, because of where the climb spends its time. Below the count a
   * phone can afford, its frame rate is pinned to the screen's refresh and stays there whatever
   * the count does — so every rung of a climb that is about to overshoot reads as "comfortably
   * making the target", right up to the rung that is not. The number written down was therefore
   * the last one before the cliff: not what the phone could hold, but the most it could be given
   * before it fell over. Started from on a phone that was hotter or busier than the one that
   * proved it, that is a sphere too heavy to draw, which is what the user watched crawl and crash.
   *
   * So it is recorded where the loop has stopped moving: on the target, or at the ceiling with
   * room still to spare. Both are the phone *holding* a count rather than passing through it.
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
  /**
   * The last frame-rate reading, kept apart from {@link lastReading} because with build time to
   * steer by the two are different readings: this one only ever sets the ceiling.
   */
  lastFrameReading: number;
  /** How many measurements have landed. Zero means nothing has been measured on this phone yet. */
  windows: number;
  /** How big a step to take, as a share of the one asked for. See {@link TRUST_SHRINK}. */
  trust: number;
  /** Which way the last step went, which is how the loop knows it has just turned around. */
  lastStep: number;
  /**
   * The most particles the loop may climb to on this appearance: 1 until the phone has been seen
   * falling behind, and then a little under where it fell. See {@link BELOW_WHERE_IT_FELL}.
   */
  ceiling: number;
  /** The share drawn during the last window, so a slow window can be pinned on what caused it. */
  lastDensity: number;
  /** The frame rate this device steers to. See {@link DensityPace}. */
  targetFramesPerSecond: number;
  /** How long building a picture may take on this device, in milliseconds. See {@link DensityPace}. */
  buildBudgetMs: number;
}

/**
 * Where it starts: at the floor, climbing — unless it is being handed half of what it proved.
 *
 * `startingDensity` is only ever `startFromRemembered` of a count this phone was seen *holding*,
 * which is half of it. There is deliberately no way to start it anywhere else. It used to be
 * handed the live share off the previous appearance as well, so that a hologram built again did
 * not have to re-measure — and since the assistant's window keeps its React surface between
 * summonings, "built again" included every summoning after the first. Jarvis therefore opened at
 * whatever he happened to be drawing when he was last dismissed, on a phone that had since gone
 * and done something else. That is the entrance the user reported: far too many particles, a few
 * frames a second, and eventually no Jarvis at all.
 *
 * Otherwise it begins sparse. It began at *everything*, on the reasoning that a phone which can
 * manage it never has to find out. What that looks like is the first second being the worst second
 * — Jarvis arrives stuttering and then recovers, which is the one moment anybody is looking at him.
 * Starting under what any phone can draw and climbing means the arrival is smooth and the swarm
 * fills in behind it, which is also just a better entrance.
 *
 * `RISING_PER_SECOND` paces that climb: from the floor to everything is about six seconds on a
 * phone that can take it, and from half of a remembered count a few.
 */
export function createDensityControl(
  startingDensity: number = FEWEST_PARTICLES,
  pace: DensityPace = PHONE_PACE,
): DensityControl {
  const density = startingDensity <= 0 ? FEWEST_PARTICLES : clamp(startingDensity, FEWEST_PARTICLES, 1);
  return {
    density,
    proven: 0,
    error: 0,
    previousError: 0,
    errorBeforeThat: 0,
    lastReading: 0,
    lastFrameReading: 0,
    windows: 0,
    trust: 1,
    lastStep: 0,
    ceiling: 1,
    lastDensity: density,
    targetFramesPerSecond: pace.targetFramesPerSecond,
    buildBudgetMs: pace.buildBudgetMs,
  };
}

/**
 * Where to begin, given what this phone managed last time.
 *
 * Kept here rather than wherever the number is stored, because it is a decision about the loop
 * rather than about storage: see {@link REMEMBERED_SHARE} for why it is half of the old value and
 * not the old value.
 */
export function startFromRemembered(proven: number): number {
  return proven <= 0 ? FEWEST_PARTICLES : clamp(proven * REMEMBERED_SHARE, FEWEST_PARTICLES, 1);
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
 * The reading the PID steers by: build time against its budget when there is one, and the frame
 * rate's reading when nothing has been timed yet. Both are "how far over, as a share", so the
 * gains mean the same thing whichever it is.
 */
function steeringReading(frameReading: number, buildMilliseconds: number, buildBudgetMs: number): number {
  'worklet';
  if (buildMilliseconds <= 0) {
    return frameReading;
  }
  return clamp(buildMilliseconds / buildBudgetMs - 1, -1, WORST_ERROR);
}

/**
 * Lowers the ceiling when two windows running have fallen behind, and cuts the count down to it.
 * Says whether it cut, because a window that has been cut has already taken its step.
 *
 * Two windows running behind the target: this phone has an edge, and it is under what was drawn in
 * either of them. See BELOW_WHERE_IT_FELL.
 *
 * Straight down to it, rather than at the controller's pace: the filter is a window or two behind
 * the phone, and every one of those windows would be drawn at a rate the user can see stutter. The
 * ceiling is already a count the phone was just seen to be unable to hold, less a margin, so there
 * is nothing to find out by approaching it gradually.
 *
 * Below `clamp`, for the reason `seedFromRemembered` gives.
 */
function lowerTheCeiling(control: DensityControl, trusted: number, drawnNow: number, drawnBefore: number): boolean {
  'worklet';
  if (trusted < SETTLED_WITHIN) {
    return false;
  }
  const fellAt = drawnNow < drawnBefore ? drawnNow : drawnBefore;
  // The share of the target it was making, which is what the reading is the reciprocal of.
  const making = clamp(1 / (1 + trusted), FARTHEST_BELOW_WHERE_IT_FELL, BELOW_WHERE_IT_FELL);
  const ceiling = clamp(fellAt * making, FEWEST_PARTICLES, 1);
  if (ceiling < control.ceiling) {
    control.ceiling = ceiling;
  }
  if (control.density <= control.ceiling) {
    return false;
  }
  control.density = control.ceiling;
  control.lastStep = 0;
  return true;
}

/**
 * Raises `proven` to the count being drawn, if the loop has arrived there and is holding the target.
 *
 * Arrived is either sitting on the target, or pinned at the ceiling with room to spare — which is
 * as arrived as a phone that can draw everything it is allowed to ever gets. See `proven` for why
 * only these count.
 */
function recordWhatItHolds(control: DensityControl, framesPerSecond: number, onTarget: boolean): void {
  'worklet';
  const atCeiling = control.density >= control.ceiling && control.error <= 0;
  const holding = (onTarget || atCeiling) && framesPerSecond >= control.targetFramesPerSecond;
  if (holding && control.density > control.proven) {
    control.proven = control.density;
  }
}

/**
 * Moves the particle count toward whatever holds the device's target frame rate — {@link TARGET_FRAMES_PER_SECOND}
 * on a phone, {@link WATCH_PACE} on a watch.
 *
 * `framesPerSecond` of zero means nothing has been measured yet, and nothing is changed — the loop
 * must not act on the first frame, before there is a rate to act on. Neither does the first real
 * measurement: an incremental controller works in differences, and one reading has nothing to
 * differ from.
 */
export function steerDensity(
  control: DensityControl,
  framesPerSecond: number,
  deltaSeconds: number,
  buildMilliseconds = 0,
): void {
  'worklet';
  if (framesPerSecond <= 0 || deltaSeconds <= 0) {
    return;
  }

  // Half a second's worth at most, however long the wall clock says this took: see LONGEST_WINDOW.
  const windowSeconds = clamp(deltaSeconds, SHORTEST_WINDOW, LONGEST_WINDOW);
  // The error, in frame time, normalised by the target — which is exactly the target rate over the
  // measured one, less one. Positive when the phone is too slow. Bounded below by -1 whatever the
  // screen does, and clamped above: see WORST_ERROR. This one only sets the ceiling, unless there is
  // no build time to steer by.
  const frameReading = clamp(control.targetFramesPerSecond / framesPerSecond - 1, -1, WORST_ERROR);
  const reading = steeringReading(frameReading, buildMilliseconds, control.buildBudgetMs);

  // What was drawn during the window this reading measures, and during the one before it.
  const drawnNow = control.density;
  const drawnBefore = control.lastDensity;
  control.lastDensity = drawnNow;

  if (control.windows === 0) {
    // Nothing to difference against yet. Start the filter *at* the reading rather than at zero, or
    // the first second of every launch is spent watching a filter catch up with a phone.
    control.windows = 1;
    control.error = reading;
    control.previousError = reading;
    control.errorBeforeThat = reading;
    control.lastReading = reading;
    control.lastFrameReading = frameReading;
    return;
  }
  control.windows += 1;

  // The gentler of each reading and the last, so that a lone hitch is not a verdict.
  const trusted = reading < control.lastReading ? reading : control.lastReading;
  control.lastReading = reading;
  const trustedFrame = frameReading < control.lastFrameReading ? frameReading : control.lastFrameReading;
  control.lastFrameReading = frameReading;

  const cut = lowerTheCeiling(control, trustedFrame, drawnNow, drawnBefore);

  control.errorBeforeThat = control.previousError;
  control.previousError = control.error;
  control.error += (trusted - control.error) * MEASUREMENT_SHARE;

  const error = control.error;
  // Arrived, and worth remembering as what this phone holds: see `recordWhatItHolds`.
  const onTarget = error > -SETTLED_WITHIN && error < SETTLED_WITHIN;
  recordWhatItHolds(control, framesPerSecond, onTarget);

  if (onTarget || cut) {
    // Inside the band nothing moves: see SETTLED_WITHIN. And a window that has just been cut down
    // to a new ceiling has already taken its step; the controller's own on top would be shedding
    // twice for one slowdown.
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
  control.density = clamp(control.density + step, FEWEST_PARTICLES, control.ceiling);
  // What actually happened, which is what the next step is judged against — the step asked for and
  // the step taken are different things at the floor, at the ceiling and at the rate limits.
  control.lastStep = control.density - before;
}
