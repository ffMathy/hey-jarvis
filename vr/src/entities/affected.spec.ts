import { describe, expect, it } from 'bun:test';
import {
  type AffectedState,
  affectedIds,
  CORONA_FADE_IN_SECONDS,
  CORONA_FADE_OUT_SECONDS,
  coronaLevels,
  HELD_WHILE_THINKING_SECONDS,
  lightAffected,
  MIN_SHOWN_SECONDS,
  NOTHING_AFFECTED,
  releaseAffected,
  stepAffected,
} from './affected';

/** Steps `state` from `from` to `to` in frames of `frame` seconds, with `thinking` throughout. */
function run(state: AffectedState, from: number, to: number, thinking: boolean, frame = 1 / 72): AffectedState {
  let current = state;
  const frames = Math.round((to - from) / frame);
  for (let index = 1; index <= frames; index++) current = stepAffected(current, from + index * frame, thinking);
  return current;
}

function levelOf(state: AffectedState, id: string): number {
  return coronaLevels(state).find((corona) => corona.id === id)?.level ?? 0;
}

describe('the corona lifetime', () => {
  it('fades in quickly after a mark', () => {
    let state = stepAffected(NOTHING_AFFECTED, 10, false);
    state = lightAffected(state, ['light.kitchen'], 10);
    expect(levelOf(state, 'light.kitchen')).toBe(0);
    state = run(state, 10, 10 + CORONA_FADE_IN_SECONDS / 2, false);
    expect(levelOf(state, 'light.kitchen')).toBeCloseTo(0.5, 1);
    state = run(state, 10 + CORONA_FADE_IN_SECONDS / 2, 10 + CORONA_FADE_IN_SECONDS + 0.05, false);
    expect(levelOf(state, 'light.kitchen')).toBe(1);
  });

  it(`shows a mark for ${MIN_SHOWN_SECONDS} s with no thinking, then fades out over his leave time`, () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, false);
    state = lightAffected(state, ['light.kitchen'], 0);
    state = run(state, 0, MIN_SHOWN_SECONDS - 0.05, false);
    expect(levelOf(state, 'light.kitchen')).toBe(1);
    state = run(state, MIN_SHOWN_SECONDS - 0.05, MIN_SHOWN_SECONDS + CORONA_FADE_OUT_SECONDS / 2, false, 0.05);
    expect(levelOf(state, 'light.kitchen')).toBeGreaterThan(0.3);
    expect(levelOf(state, 'light.kitchen')).toBeLessThan(0.7);
    state = run(state, MIN_SHOWN_SECONDS + CORONA_FADE_OUT_SECONDS / 2, MIN_SHOWN_SECONDS + 1, false, 0.05);
    expect(coronaLevels(state)).toEqual([]);
    expect(affectedIds(state)).toEqual([]);
  });

  it('holds it while he is thinking, and lets it go when the thought settles', () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, true);
    state = lightAffected(state, ['inbox:work'], 0);
    state = run(state, 0, 12, true, 0.1);
    expect(levelOf(state, 'inbox:work')).toBe(1);
    state = run(state, 12, 12 + CORONA_FADE_OUT_SECONDS + 0.1, false, 0.05);
    expect(coronaLevels(state)).toEqual([]);
  });

  it(`lets it go ${HELD_WHILE_THINKING_SECONDS} s after its last mark even if the thinking never settles`, () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, true);
    state = lightAffected(state, ['calendar:home'], 0);
    state = run(state, 0, HELD_WHILE_THINKING_SECONDS - 0.1, true, 0.1);
    expect(levelOf(state, 'calendar:home')).toBe(1);
    state = run(state, HELD_WHILE_THINKING_SECONDS - 0.1, HELD_WHILE_THINKING_SECONDS + 1, true, 0.05);
    expect(coronaLevels(state)).toEqual([]);
  });

  it('a new mark restarts the time it is held for', () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, true);
    state = lightAffected(state, ['calendar:home'], 0);
    state = run(state, 0, 20, true, 0.1);
    state = lightAffected(state, ['calendar:home'], 20);
    state = run(state, 20, 40, true, 0.1);
    expect(levelOf(state, 'calendar:home')).toBe(1);
  });

  it('lights again from wherever it had faded to when marked mid-fade', () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, false);
    state = lightAffected(state, ['light.kitchen'], 0);
    state = run(state, 0, MIN_SHOWN_SECONDS + CORONA_FADE_OUT_SECONDS / 2, false, 0.05);
    const faded = levelOf(state, 'light.kitchen');
    expect(faded).toBeGreaterThan(0);
    expect(faded).toBeLessThan(1);
    const at = MIN_SHOWN_SECONDS + CORONA_FADE_OUT_SECONDS / 2;
    state = lightAffected(state, ['light.kitchen'], at);
    state = stepAffected(state, at + 0.05, false);
    expect(levelOf(state, 'light.kitchen')).toBeGreaterThan(faded);
  });

  it('fades every corona out when the conversation ends, thinking or not, until marked again', () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, true);
    state = lightAffected(state, ['light.kitchen', 'inbox:work'], 0);
    state = run(state, 0, 1, true);
    state = releaseAffected(state);
    state = run(state, 1, 1 + CORONA_FADE_OUT_SECONDS + 0.1, true, 0.05);
    expect(coronaLevels(state)).toEqual([]);
    state = lightAffected(state, ['light.kitchen'], 2);
    state = run(state, 2, 3, true);
    expect(levelOf(state, 'light.kitchen')).toBe(1);
  });

  it('keeps each entity apart, lists the brightest first, and lists what is lit for the debug hook', () => {
    let state = stepAffected(NOTHING_AFFECTED, 0, false);
    state = lightAffected(state, ['light.kitchen'], 0);
    state = run(state, 0, 0.1, false, 0.05);
    state = lightAffected(state, ['inbox:work'], 0.1);
    state = run(state, 0.1, 0.15, false, 0.05);
    expect(coronaLevels(state).map((corona) => corona.id)).toEqual(['light.kitchen', 'inbox:work']);
    expect(affectedIds(state)).toEqual(['inbox:work', 'light.kitchen']);
  });

  it('changes nothing for an empty mark or a release with nothing lit', () => {
    expect(lightAffected(NOTHING_AFFECTED, [], 0)).toBe(NOTHING_AFFECTED);
    expect(releaseAffected(NOTHING_AFFECTED)).toBe(NOTHING_AFFECTED);
  });

  it('never moves a level backwards in time', () => {
    let state = stepAffected(NOTHING_AFFECTED, 5, false);
    state = lightAffected(state, ['light.kitchen'], 5);
    state = stepAffected(state, 4, false);
    expect(levelOf(state, 'light.kitchen')).toBe(0);
    expect(affectedIds(state)).toEqual(['light.kitchen']);
  });
});
