import { describe, expect, it } from 'bun:test';
import {
  createDensityControl,
  type DensityControl,
  FEWEST_PARTICLES,
  seedFromRemembered,
  startFromRemembered,
  steerDensity,
  TARGET_FRAMES_PER_SECOND,
} from './density-control';

/**
 * The loop that decides how many particles a phone can afford.
 *
 * Worth testing properly, and testable in a way that almost nothing else about this drawing's
 * speed has been: a controller is arithmetic, so a phone can be stood in for by a function. The
 * measurements that sent five rounds of optimisation in the wrong direction were all of *Skia* on
 * a desktop, which is a different machine doing a different thing. This is the same arithmetic
 * that will run on the phone.
 */

/**
 * A phone that can draw `affordable` of the particles at the target rate, and slows down in
 * proportion as it is given more.
 *
 * Capped as the view caps it — at a hundred and twenty, far above the target, which is the whole
 * point. A cap near the target makes the loop blind: a measurement can never come back above its
 * own cap, so "exactly fast enough" and "could draw three times as much" are the same reading. With
 * the cap up here the loop sees real error on both sides and can climb.
 */
const CAPPED_AT = 120;

function phone(affordable: number) {
  return (density: number) => Math.min(CAPPED_AT, (TARGET_FRAMES_PER_SECOND * affordable) / Math.max(density, 0.01));
}

/** Runs the loop for `seconds` against a phone, half a second at a time as the view measures. */
function settle(control: DensityControl, drawsAt: (density: number) => number, seconds: number): number[] {
  const seen: number[] = [];
  for (let step = 0; step * 0.5 < seconds; step++) {
    steerDensity(control, drawsAt(control.density), 0.5);
    seen.push(control.density);
  }
  return seen;
}

describe('deciding how many particles this phone can afford', () => {
  it('leaves a phone that can draw all of them alone', () => {
    const control = createDensityControl();
    settle(control, phone(1.4), 20);

    expect(control.density).toBe(1);
  });

  it('finds what a slower phone can manage, and stays there', () => {
    // A phone that affords 40% of the particles at the target rate.
    const control = createDensityControl();
    const path = settle(control, phone(0.4), 40);

    expect(control.density).toBeGreaterThan(0.3);
    expect(control.density).toBeLessThan(0.5);
    // And it is *settled*: the last ten seconds barely move.
    const late = path.slice(-20);
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.05);
  });

  it('sheds particles quickly when the phone falls behind, and adds them back slowly', () => {
    const control = createDensityControl();
    settle(control, phone(1.4), 10);
    expect(control.density).toBe(1);

    // Something else starts competing for the phone: it can suddenly afford a third of them.
    const falling = settle(control, phone(0.33), 4);
    expect(falling[falling.length - 1]).toBeLessThan(0.6);

    // ...and when it lets go again, they come back — steadily, at RISING_PER_SECOND, which is
    // three times slower than they went. A swarm that doubles in a heartbeat is more noticeable
    // than one that was never there.
    const oneStep = control.density;
    settle(control, phone(1.4), 0.5);
    const returned = control.density - oneStep;
    expect(returned).toBeGreaterThan(0);
    expect(returned).toBeLessThan(0.2);
  });

  it('never strips him back past what still looks like Jarvis', () => {
    const control = createDensityControl();
    // A phone that cannot manage the target at any density at all.
    settle(control, () => 4, 60);

    expect(control.density).toBe(FEWEST_PARTICLES);
  });

  it('does nothing until something has actually been measured', () => {
    const control = createDensityControl();
    const before = control.density;
    steerDensity(control, 0, 0.5);

    expect(control.density).toBe(before);
    expect(control.windows).toBe(0);
  });

  it('starts sparse and fills in quickly, so the arrival is not the worst second', () => {
    const control = createDensityControl();
    expect(control.density).toBe(FEWEST_PARTICLES);

    // Most of the way in three seconds, which is the part anybody sees...
    settle(control, phone(1.4), 3);
    expect(control.density).toBeGreaterThan(0.9);

    // ...and all the way shortly after. The climb is paced by RISING_PER_SECOND rather than by the
    // error, because below what a phone can afford its frame rate is pinned to the screen's refresh
    // and the measurement stops saying how much room is left.
    settle(control, phone(1.4), 3);
    expect(control.density).toBe(1);
  });

  it('ignores one bad window, because changing the screen costs a hitch', () => {
    // Walking to the next mood re-renders the screen, which rebuilds the drawing worklet — one
    // stall, over in a frame or two, landing in a window half a second wide. The loop used to read
    // it as the phone collapsing and shed the lot, so the spark count fell back to where it
    // started every time the user tapped.
    const control = createDensityControl();
    settle(control, phone(1.4), 8);
    const before = control.density;
    expect(before).toBe(1);

    steerDensity(control, 6, 0.5);

    expect(control.density).toBe(before);
  });

  it('still sheds when the phone is genuinely slow, one window later', () => {
    const control = createDensityControl();
    settle(control, phone(1.4), 8);

    // Two in a row is not a hiccup.
    steerDensity(control, 20, 0.5);
    steerDensity(control, 20, 0.5);

    expect(control.density).toBeLessThan(0.8);
  });

  it('remembers the most it was ever seen holding the target, and only upward', () => {
    const control = createDensityControl();
    settle(control, phone(1.4), 8);
    expect(control.proven).toBe(1);

    // Something else gets busy and it has to shed. What it *managed* is still what it managed.
    settle(control, phone(0.3), 6);
    expect(control.density).toBeLessThan(0.6);
    expect(control.proven).toBe(1);
  });

  it('starts next time a little under what it managed last time', () => {
    // Exactly at the old number and the first thing that happens is a shed; just under it and the
    // first thing that happens is the climb finishing.
    expect(startFromRemembered(0.8)).toBeCloseTo(0.72, 5);
    expect(startFromRemembered(1)).toBeCloseTo(0.9, 5);
    // Nothing remembered, and nothing to go on: begin where a phone that has never been asked does.
    expect(startFromRemembered(0)).toBe(FEWEST_PARTICLES);
    // And never under the floor, however little it managed. Below it rather than at it: the input
    // used to be 0.05, which *was* the floor, and stopped meaning anything the moment the floor
    // moved under it.
    expect(startFromRemembered(0.01)).toBe(FEWEST_PARTICLES);
  });

  it('climbs from the floor when the phone is making the target, rather than sitting there', () => {
    // The shape of a real bug, and the reason the view's cap is far above the target rather than at
    // it. With the cap *at* the target, a 60 Hz screen could only ever report 30 — a gate produces
    // the refresh divided by a whole number — and the loop read its own cap as the phone struggling
    // and stripped the sphere to the floor. Two hundred and fifty particles of the five thousand
    // there were then, on a machine that could draw thousands.
    //
    // What has to happen instead: a phone with room climbs into it.
    const control = createDensityControl();
    expect(control.density).toBe(FEWEST_PARTICLES);

    const path = settle(control, phone(0.8), 30);

    expect(control.density).toBeGreaterThan(0.6);
    expect(control.density).toBeLessThan(1);
    // And it got there by going up, not by drifting.
    expect(path[path.length - 1]).toBeGreaterThan(path[0] ?? 0);
  });

  it('never reads a fast phone as a slow one', () => {
    // Anything at or above the target is headroom, whatever the screen's refresh happens to be —
    // 60, 90 or 120. None of them may look like a phone that cannot keep up.
    for (const measured of [40, 60, 90, 120]) {
      const control = createDensityControl(0.5);
      steerDensity(control, measured, 0.5);
      steerDensity(control, measured, 0.5);

      expect(control.density).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('does not hunt across the target once it has arrived', () => {
    // The failure this is here to catch is visible on screen rather than in a number: a loop that
    // overshoots in both directions is a swarm breathing in and out for as long as you watch it.
    const control = createDensityControl();
    const path = settle(control, phone(0.55), 60);
    const late = path.slice(-40);

    let turns = 0;
    for (let index = 2; index < late.length; index++) {
      const before = (late[index - 1] ?? 0) - (late[index - 2] ?? 0);
      const after = (late[index] ?? 0) - (late[index - 1] ?? 0);
      if (before * after < 0 && Math.abs(after) > 0.002) {
        turns++;
      }
    }

    expect(turns).toBeLessThan(3);
  });
});

describe('starting from what this phone managed last time', () => {
  it('takes the remembered share when nothing has been measured yet', () => {
    // The case this is all for: the control is built before the read comes back, so it starts at
    // the floor, and the remembered number has to be applied afterwards rather than at birth.
    const control = createDensityControl();
    seedFromRemembered(control, 0.72);

    expect(control.density).toBe(0.72);
  });

  it('ignores it once a real frame rate has been seen', () => {
    // What the loop has worked out on this phone, now, beats anything from last time — and a
    // storage read that lands a second late must not undo a second of measuring.
    const control = createDensityControl();
    steerDensity(control, 12, 0.5);
    steerDensity(control, 12, 0.5);
    const measured = control.density;

    seedFromRemembered(control, 0.9);

    expect(control.density).toBe(measured);
  });

  it('never steps backwards', () => {
    const control = createDensityControl(0.6);
    seedFromRemembered(control, 0.3);

    expect(control.density).toBe(0.6);
  });

  it('will not seed below the floor', () => {
    const control = createDensityControl();
    seedFromRemembered(control, 0.001);

    expect(control.density).toBe(FEWEST_PARTICLES);
  });
});

/**
 * A phone that can only present whole refreshes, which is every real phone.
 *
 * The model above is a smooth curve: ask for more particles and the frame rate slides down. No
 * screen behaves like that. A screen presents at a refresh boundary or not at all, so the rates it
 * can hold are the refresh over a whole number — sixty, thirty, twenty — and the drawing either
 * fits in a frame or costs a whole extra one. Between "fits" and "does not" there is nothing.
 *
 * That cliff is where the loop lives, because the loop's whole job is to walk up to it. It is also
 * the thing the previous controller could not cope with: tuned gently enough not to fall off it,
 * the climb crawled; tuned to climb, it fell off the cliff and back on every few seconds, which on
 * screen is the swarm breathing in and out.
 */
function screen(refresh: number, fixedMilliseconds: number, allParticlesMilliseconds: number) {
  const vsync = 1000 / refresh;
  return (density: number, jitter: number) => {
    const work = (fixedMilliseconds + allParticlesMilliseconds * density) * (1 + jitter);
    // The app's own cap, as `hologram-view.tsx` sets it.
    return Math.max(1 / 120, (Math.max(1, Math.ceil(work / vsync)) * vsync) / 1000);
  };
}

/** Deterministic wobble, so a swing in these tests is the loop's and never the random seed's. */
function wobble(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return (value / 2147483648 - 0.5) * 0.12;
  };
}

/**
 * Runs the view's loop against such a screen: frames accumulate until half a second has gone by,
 * and the rate that comes out of it is what steers. `stall` inserts a frame that takes seconds,
 * which is what a re-render or a collection looks like from in here.
 */
function watch(
  control: DensityControl,
  draws: (density: number, jitter: number) => number,
  seconds: number,
  stall?: { at: number; lasting: number },
) {
  const jitter = wobble(99);
  const seen: { at: number; density: number }[] = [];
  let now = 0;
  let drawn = 0;
  let measuring = 0;
  while (now < seconds) {
    const frozen = stall !== undefined && now >= stall.at && now < stall.at + stall.lasting;
    const took = frozen ? stall.lasting : draws(control.density, jitter());
    now += took;
    drawn += 1;
    // As the view measures it: a gap longer than a fifth of a second is a freeze rather than a
    // frame, and counts as a fifth. See LONGEST_FRAME_WORTH_MEASURING in `hologram-view.tsx`.
    measuring += Math.min(took, 0.2);
    if (measuring >= 0.5) {
      steerDensity(control, drawn / measuring, measuring);
      seen.push({ at: now, density: control.density });
      drawn = 0;
      measuring = 0;
    }
  }
  return seen;
}

const SIXTY_HERTZ = screen(60, 6, 18);
const HUNDRED_AND_TWENTY_HERTZ = screen(120, 4, 30);

describe('the phone stalling, which is not the phone being slow', () => {
  /**
   * The bug this controller was rewritten for, as the user described it: "the amount of particles
   * keeps rising until the fps all of a sudden drops, then particle count goes all the way down to
   * 250. Then it climbs slowly back up again, and then does the same jump."
   *
   * Two hundred and fifty is {@link FEWEST_PARTICLES}, and it took exactly one measurement to get
   * there. A stalled frame made the window four times its usual length and the rate in it nearly
   * zero, and the old loop multiplied the two: the step was scaled by the window, and the window
   * was long *because* the phone had stopped. One slow frame, the whole sphere.
   */
  it('does not strip the sphere because one frame took two seconds', () => {
    const control = createDensityControl();
    settle(control, phone(0.6), 20);
    const settled = control.density;
    expect(settled).toBeGreaterThan(0.4);

    // One frame, two seconds: a rate of half a frame a second over a window four times too long.
    steerDensity(control, 1 / 2, 2);

    expect(control.density).toBe(settled);
  });

  it('answers a real freeze without going anywhere near the floor', () => {
    const control = createDensityControl();
    settle(control, phone(0.6), 20);
    const settled = control.density;

    // Three and a half seconds of nothing at all, in two windows. Long enough that the loop is
    // right to react — but reacting is not the same as giving up.
    steerDensity(control, 1 / 1.5, 1.5);
    steerDensity(control, 1 / 2, 2);

    expect(control.density).toBeGreaterThan(FEWEST_PARTICLES * 4);
    expect(control.density).toBeLessThan(settled);
  });

  it('is back where it was within a few seconds, not within a minute', () => {
    // The second half of what the user saw. The old loop pulled its own ceiling down with the
    // density, so the way back up was governed by a ceiling that crept at a tenth of the range a
    // second: fifteen seconds of watching the swarm refill, every time.
    const control = createDensityControl();
    settle(control, phone(0.6), 20);
    const settled = control.density;

    steerDensity(control, 1 / 1.5, 1.5);
    steerDensity(control, 1 / 2, 2);
    const shed = control.density;
    expect(shed).toBeLessThan(settled);

    settle(control, phone(0.6), 5);

    expect(control.density).toBeGreaterThan(settled * 0.95);
  });
});

describe('on a screen that can only present whole refreshes', () => {
  it('walks up to the cliff and stays there instead of falling off it', () => {
    const control = createDensityControl();
    const path = watch(control, SIXTY_HERTZ, 60);
    const late = path.filter((sample) => sample.at >= 30).map((sample) => sample.density);

    // It found something worth drawing...
    expect(Math.min(...late)).toBeGreaterThan(0.3);
    // ...and it is not breathing. The old loop swung twenty-five points here, for ever.
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.1);
  });

  it('settles just as still at a hundred and twenty', () => {
    // The same gains, the same file, a screen with twice the resolution in time. A controller whose
    // error is a frame rate cannot do this: the same reading means -0.5 on one screen and -2 on the
    // other, so gains that hold one tear the other apart.
    const control = createDensityControl();
    const path = watch(control, HUNDRED_AND_TWENTY_HERTZ, 60);
    const late = path.filter((sample) => sample.at >= 30).map((sample) => sample.density);

    expect(Math.min(...late)).toBeGreaterThan(0.3);
    expect(Math.max(...late) - Math.min(...late)).toBeLessThan(0.1);
  });

  it('rides out a stall without ever reaching the floor', () => {
    const control = createDensityControl();
    const path = watch(control, SIXTY_HERTZ, 60, { at: 20, lasting: 1.5 });
    const after = path.filter((sample) => sample.at >= 20).map((sample) => sample.density);

    expect(Math.min(...after)).toBeGreaterThan(0.3);
  });
});
