/**
 * How many of Jarvis's particles a phone can afford, worked out while it draws them.
 *
 * The drawing's cost is its geometry: a GPU turns every stroked path into triangles, and this one
 * hands it more than a thousand that are different every frame. How many a given phone can manage
 * at the frame rate it is asked for is not a thing anyone can know in advance — it was 8 frames a
 * second on one phone and 58 in that same phone's browser — so instead of choosing a number, the
 * drawing measures what it is getting and moves the number until the number is right.
 *
 * It is a PI controller. The user asked for PID, and the D is deliberately absent: the measurement
 * is a frame rate averaged over half a second, which is noisy, and differentiating noise mostly
 * produces more noise. What the D term would buy — damping — comes instead from the rate limits
 * below, which are the thing that actually stops this hunting.
 *
 * Nothing here imports anything. It runs in a worklet on the UI thread, beside the drawing.
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
 */
export const FEWEST_PARTICLES = 0.025;

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
 * steady and unhurried. Equal rates give the textbook result and the wrong behaviour: the loop
 * finds the edge of what the phone can do and then oscillates across it, which on screen is the
 * swarm breathing in and out.
 *
 * The rising rate is what the climb actually runs at — see `steerDensity`, where the proportional
 * term is deliberately not used on that side — so this is also how long the entrance takes: from
 * {@link FEWEST_PARTICLES} to nearly all of them in about three seconds.
 *
 * **It has to move when the floor does**, which is not obvious and cost a failing test to notice.
 * The climb covers a distance measured in shares, so starting from a fortieth rather than a fifth
 * is a longer way to go at the same speed, and the entrance — the one part of this anybody watches
 * — got slower every time the ceiling went up. Raised from 0.3 to 0.35 when the floor became a
 * twentieth, and to 0.36 when it became a fortieth, both times to keep the entrance where it was:
 * a fortieth to everything at 0.36 a second is the same 2.7 s the old pair came to.
 */
const FALLING_PER_SECOND = 0.9;
const RISING_PER_SECOND = 0.36;

/** How much accumulated error the integral may carry, so a long slow patch cannot wind it up. */
const CARRIED_LIMIT = 0.5;

/** What share of the remaining room to the ceiling a single climb may take: halving, so it lands. */
const APPROACH_SHARE = 0.5;

/**
 * A frame rate at least this high means the count that produced it is sustainable.
 *
 * It was a number just under the view's cap, on the reasoning that being pinned at the cap meant
 * there was room nobody could measure. That only worked while the cap was close to the target. With
 * the cap at a hundred and twenty it would never be reached on a 60 Hz screen at all, and the
 * remembered count — which is only written down when this is met — would have stayed empty for
 * ever on half the phones in the world.
 *
 * Making the target is the honest signal now: a density that holds the rate being asked for is a
 * density this phone can manage, which is exactly what is worth remembering.
 */
const SUSTAINED_FRAMES_PER_SECOND = TARGET_FRAMES_PER_SECOND;

/** How fast the remembered ceiling itself lifts, once the phone is plainly not working for it. */
const CEILING_CREEP_PER_SECOND = 0.1;

/** How near the ceiling counts as up against it. */
const RAISE_CEILING_WITHIN = 0.02;

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
  /** 0–1: the share of the particles being drawn. */
  density: number;
  /** The integral term: how long it has been wrong, and by how much. */
  carried: number;
  /**
   * The most this phone has been shown to manage — everything, until it proves otherwise.
   *
   * **This is what stops the loop hunting, and a plain PI cannot.** The frame rate saturates at the
   * cap, so there is a whole range of densities that all measure sixty and then a cliff: on a phone
   * that affords four tenths, three tenths reads sixty and five tenths reads forty. Nothing in the
   * error tells the loop it is one step from the cliff, so it steps off, sheds, climbs, and steps
   * off again — for as long as you watch it.
   *
   * Remembering where it landed turns that into an approach: the climb slows as it nears this and
   * settles just under it. It only rises again when the phone shows real headroom.
   */
  ceiling: number;
  /**
   * The error the previous measurement showed, so that one bad window cannot dump the lot.
   *
   * Changing anything about the screen — walking to the next mood, say — re-renders it, and a
   * re-render rebuilds the drawing worklet, which Reanimated re-serialises the scene for. That is
   * one hitch, over in a frame or two, and it lands in a window half a second wide: the loop used
   * to read it as the phone collapsing and shed everything. Shedding on the *gentler* of the last
   * two windows costs half a second of reaction to a real slowdown and ignores a lone spike
   * entirely.
   */
  lastError: number;
  /**
   * The most particles this phone has ever been seen drawing at the cap, 0 until it has.
   *
   * The difference from {@link ceiling} is what each is for. The ceiling is where the loop is
   * heading *now*, and it drops the moment something else on the phone gets busy. This only ever
   * goes up, and it is what is worth writing down and starting from next time: not a guess about
   * the hardware, but a thing this phone actually did.
   */
  proven: number;
}

/**
 * Where it starts: a fifth of them, climbing — unless it is being handed what it had before.
 *
 * `startingDensity` is for the case where the hologram is built again over a screen that already
 * knew the answer. Nothing about the phone changed while a view was being remade, so beginning at
 * a fifth again would be throwing away a measurement and making the user watch it be taken twice.
 *
 * Otherwise it begins sparse. It began at *everything*, on the reasoning that a phone which can
 * manage it never has to find out.
 * What that looks like is the first second being the worst second — Jarvis arrives stuttering and
 * then recovers, which is the one moment anybody is looking at him. Starting under what any phone
 * can draw and climbing means the arrival is smooth and the swarm fills in behind it, which is
 * also just a better entrance.
 *
 * `RISING_PER_SECOND` is what makes that climb quick rather than a crawl: from here to everything
 * is under three seconds on a phone that can take it.
 */
export function createDensityControl(startingDensity: number = FEWEST_PARTICLES): DensityControl {
  const density = startingDensity <= 0 ? FEWEST_PARTICLES : clamp(startingDensity, FEWEST_PARTICLES, 1);
  return { density, carried: 0, ceiling: 1, lastError: 0, proven: 0 };
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
  // `lastError` is set by every steer with a real reading, and `proven` by every one at the cap, so
  // the two being untouched is what "nothing has been measured" looks like.
  if (control.lastError !== 0 || control.proven !== 0 || share <= control.density) {
    return;
  }
  control.density = clamp(share, FEWEST_PARTICLES, 1);
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
  // Shedding answers the gentler of this window and the last, so a single hitch is not a verdict.
  const sustained = Math.min(error, control.lastError);
  control.lastError = error;

  if (framesPerSecond >= SUSTAINED_FRAMES_PER_SECOND && control.density > control.proven) {
    // Holding the target at this many is the phone saying it can. Only ever upward: this is the
    // one number worth keeping, and a busy minute should not talk it down.
    control.proven = control.density;
  }

  if (error > -SETTLED_WITHIN && error < SETTLED_WITHIN) {
    // Arrived. Let what it has been carrying drain away, so that coming back to the target twice
    // from the same side does not leave the loop leaning.
    control.carried -= control.carried * deltaSeconds;
    return;
  }

  if (error < 0) {
    // **Faster than it needs to be: climb, but toward what this phone has been shown to manage.**
    //
    // The proportional term is deliberately not used on this side. It would make the climb's speed
    // depend on how far above the target the phone happens to be, which is a number that changes
    // wildly between a screen that refreshes 60 times a second and one that does 120. What paces
    // the climb instead is the room left to the ceiling, halved each time, so it lands rather than
    // steps over — and that is the same on every phone.
    control.carried -= control.carried * deltaSeconds;
    const room = Math.max(0, control.ceiling - control.density);
    // Halving the remaining room lands *near* the ceiling and never quite on it, so the last
    // sliver is taken whole. Otherwise "all of them" is asymptotic and never actually all of them.
    const step = room < RAISE_CEILING_WITHIN ? room : Math.min(RISING_PER_SECOND * deltaSeconds, room * APPROACH_SHARE);
    control.density = clamp(control.density + step, FEWEST_PARTICLES, 1);
    // And if it is up against the ceiling while the cap is *still* holding the frame rate down,
    // the ceiling itself was pessimistic — something else was busy at the time — so it lifts.
    if (room < RAISE_CEILING_WITHIN && framesPerSecond >= SUSTAINED_FRAMES_PER_SECOND) {
      control.ceiling = Math.min(1, control.ceiling + CEILING_CREEP_PER_SECOND * deltaSeconds);
    }
    return;
  }

  if (sustained <= 0) {
    // One slow window after a fast one. Wait to see whether it is the phone or a hiccup.
    return;
  }

  // Too slow, and here the proportional term earns its place: how far behind it is says how much
  // has to go, and going most of the way at once is what keeps a bad moment short.
  control.carried = clamp(control.carried + sustained * deltaSeconds, -CARRIED_LIMIT, CARRIED_LIMIT);

  const push = PROPORTIONAL_GAIN * sustained + INTEGRAL_GAIN * control.carried;
  const step = clamp(-push * deltaSeconds, -FALLING_PER_SECOND * deltaSeconds, 0);

  control.density = clamp(control.density + step, FEWEST_PARTICLES, 1);
  // Where it landed is now the most this phone is known to manage; the climb aims here.
  control.ceiling = control.density;
}
