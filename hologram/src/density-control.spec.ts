import { describe, expect, it } from 'bun:test';
import {
  createDensityControl,
  type DensityControl,
  FEWEST_PARTICLES,
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
 * Frame rate is capped at sixty as the view caps it, which is the thing that makes the target sit
 * under sixty in the first place.
 */
function phone(affordable: number) {
  return (density: number) => Math.min(60, (TARGET_FRAMES_PER_SECOND * affordable) / Math.max(density, 0.01));
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

    // ...and when it lets go again, they come back — but not all at once, because a swarm that
    // doubles in a heartbeat is more noticeable than one that was never there.
    const oneStep = control.density;
    settle(control, phone(1.4), 0.5);
    expect(control.density - oneStep).toBeLessThan(0.1);
  });

  it('never strips him back past what still looks like Jarvis', () => {
    const control = createDensityControl();
    // A phone that cannot manage the target at any density at all.
    settle(control, () => 4, 60);

    expect(control.density).toBe(FEWEST_PARTICLES);
  });

  it('does nothing until something has actually been measured', () => {
    const control = createDensityControl();
    steerDensity(control, 0, 0.5);

    expect(control.density).toBe(1);
    expect(control.carried).toBe(0);
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
