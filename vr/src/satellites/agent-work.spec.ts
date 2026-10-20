import { describe, expect, it } from 'bun:test';
import type { AgentActivity, AgentActivityState } from 'hologram';
import {
  type AgentWorkState,
  APPEAR_SECONDS,
  describeWork,
  FAILED_DRIFT,
  FLARE_SECONDS,
  FOLD_SECONDS,
  GLYPH_COUNT,
  glyphOf,
  MAX_SATELLITES,
  NO_WORK,
  ORBIT_RADII,
  PLANNED_BRIGHTNESS,
  pretendWork,
  recordActivity,
  releaseWork,
  SAMPLE_AGENTS,
  SAMPLE_TOOL_SECONDS,
  STALE_SECONDS,
  satelliteSpots,
  stepWork,
} from './agent-work';

const CENTRE = { x: 0, y: 1.4, z: -1.5 };
const RADIUS = 0.22;

function news(delegationId: string, agentId: string, state: AgentActivityState): AgentActivity {
  return { delegationId, agentId, state };
}

/** Takes in each message at its time, stepping the state as a frame would after each. */
function play(...events: [time: number, activity: AgentActivity][]): AgentWorkState {
  let state = NO_WORK;
  for (const [time, activity] of events) state = stepWork(recordActivity(state, activity, time), time);
  return state;
}

function distanceFromCentre(position: { x: number; y: number; z: number }): number {
  return Math.hypot(position.x - CENTRE.x, position.y - CENTRE.y, position.z - CENTRE.z);
}

describe('a request’s agents, as satellites', () => {
  it('come out one per delegation, in the order the plan named them', () => {
    const state = play(
      [0, news('plan-0-weather', 'weather', 'planned')],
      [0, news('plan-1-calendar', 'calendar', 'planned')],
    );

    expect(describeWork(state)).toEqual([
      { agentId: 'weather', status: 'planned' },
      { agentId: 'calendar', status: 'planned' },
    ]);
  });

  it('are dim while only planned, and lit once their agent is working', () => {
    const planned = stepWork(play([0, news('plan-0-weather', 'weather', 'planned')]), APPEAR_SECONDS);
    const working = stepWork(recordActivity(planned, news('plan-0-weather', 'weather', 'working'), 1), 1);

    expect(satelliteSpots(planned, 1, CENTRE, RADIUS)[0]?.level).toBeCloseTo(PLANNED_BRIGHTNESS, 6);
    expect(satelliteSpots(working, 1, CENTRE, RADIUS)[0]?.level).toBeCloseTo(1, 6);
  });

  it(`flare on every tool their agent calls, dying away over ${FLARE_SECONDS} s`, () => {
    const state = play(
      [0, news('plan-0-weather', 'weather', 'working')],
      [2, news('plan-0-weather', 'weather', 'tool')],
    );

    expect(satelliteSpots(state, 2, CENTRE, RADIUS)[0]?.flare).toBe(1);
    expect(satelliteSpots(state, 2 + FLARE_SECONDS / 2, CENTRE, RADIUS)[0]?.flare).toBeCloseTo(0.25, 6);
    expect(satelliteSpots(state, 2 + FLARE_SECONDS, CENTRE, RADIUS)[0]?.flare).toBe(0);
    expect(describeWork(state)).toEqual([{ agentId: 'weather', status: 'working' }]);
  });

  it(`circle him at ${ORBIT_RADII} of his radii, spread evenly round the ring`, () => {
    let state = play(
      [0, news('a', 'weather', 'working')],
      [0, news('b', 'calendar', 'working')],
      [0, news('c', 'email', 'working')],
    );
    for (let time = 0; time <= 10; time += 0.1) state = stepWork(state, time);
    const spots = satelliteSpots(state, 10, CENTRE, RADIUS);

    for (const spot of spots) expect(distanceFromCentre(spot.position)).toBeCloseTo(ORBIT_RADII * RADIUS, 6);
    const gaps = spots.map((spot, index) => {
      const next = spots[(index + 1) % spots.length];
      return next === undefined
        ? 0
        : Math.hypot(
            next.position.x - spot.position.x,
            next.position.z - spot.position.z,
            next.position.y - spot.position.y,
          );
    });
    expect(gaps[0]).toBeGreaterThan(RADIUS);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0] ?? 0, 2);
  });

  it(`fold back into him over ${FOLD_SECONDS} s when they answer, and are then forgotten`, () => {
    const state = play([0, news('a', 'weather', 'working')], [1, news('a', 'weather', 'answered')]);

    expect(distanceFromCentre(satelliteSpots(state, 1, CENTRE, RADIUS)[0]?.position ?? CENTRE)).toBeCloseTo(
      ORBIT_RADII * RADIUS,
      6,
    );
    expect(
      distanceFromCentre(satelliteSpots(state, 1 + FOLD_SECONDS * 0.999, CENTRE, RADIUS)[0]?.position ?? CENTRE),
    ).toBeLessThan(0.01);
    expect(describeWork(stepWork(state, 1 + FOLD_SECONDS + 0.01))).toEqual([]);
  });

  it('drift out and go out when they fail, rather than reaching him', () => {
    const state = play([0, news('a', 'weather', 'working')], [1, news('a', 'weather', 'failed')]);
    const late = satelliteSpots(state, 1 + FOLD_SECONDS * 0.999, CENTRE, RADIUS)[0];

    expect(distanceFromCentre(late?.position ?? CENTRE)).toBeCloseTo(ORBIT_RADII * RADIUS * (1 + FAILED_DRIFT), 2);
    expect(late?.level).toBeLessThan(0.01);
  });

  it('pulse while waiting on sir, and stay out however long he takes', () => {
    const state = stepWork(play([0, news('a', 'coding', 'asking')]), STALE_SECONDS * 3);

    expect(satelliteSpots(state, STALE_SECONDS * 3, CENTRE, RADIUS)[0]?.asking).toBe(true);
    expect(describeWork(state)).toEqual([{ agentId: 'coding', status: 'asking' }]);
  });

  it(`go out as failed after ${STALE_SECONDS} s with no news, so a lost message leaves none circling`, () => {
    const state = stepWork(play([0, news('a', 'weather', 'working')]), STALE_SECONDS + 0.1);

    expect(describeWork(state)).toEqual([{ agentId: 'weather', status: 'failed' }]);
  });

  it('all fold in when the conversation ends', () => {
    const state = stepWork(
      releaseWork(play([0, news('a', 'weather', 'working')], [0, news('b', 'coding', 'asking')]), 1),
      1,
    );

    expect(describeWork(state)).toEqual([
      { agentId: 'weather', status: 'answered' },
      { agentId: 'coding', status: 'answered' },
    ]);
    expect(describeWork(stepWork(state, 1 + FOLD_SECONDS + 0.01))).toEqual([]);
  });

  it('take no news of one that has ended, but start over when a new request plans it', () => {
    const ended = play([0, news('a', 'weather', 'working')], [1, news('a', 'weather', 'answered')]);

    expect(recordActivity(ended, news('a', 'weather', 'tool'), 1.1)).toBe(ended);
    expect(describeWork(recordActivity(ended, news('a', 'weather', 'planned'), 1.2))).toEqual([
      { agentId: 'weather', status: 'planned' },
    ]);
  });

  it('never come out for a delegation first heard of as done', () => {
    expect(recordActivity(NO_WORK, news('a', 'weather', 'answered'), 0)).toBe(NO_WORK);
    expect(recordActivity(NO_WORK, news('a', 'weather', 'failed'), 0)).toBe(NO_WORK);
  });

  it(`number at most ${MAX_SATELLITES}`, () => {
    let state = NO_WORK;
    for (let index = 0; index < MAX_SATELLITES + 3; index++)
      state = recordActivity(state, news(`d${index}`, 'weather', 'working'), 0);

    expect(describeWork(state)).toHaveLength(MAX_SATELLITES);
  });

  it('come out over a moment rather than appearing at once', () => {
    const state = play([0, news('a', 'weather', 'working')]);

    expect(satelliteSpots(state, 0, CENTRE, RADIUS)[0]?.level).toBe(0);
    expect(satelliteSpots(stepWork(state, APPEAR_SECONDS), APPEAR_SECONDS, CENTRE, RADIUS)[0]?.level).toBeCloseTo(1, 6);
  });
});

describe('the glyph each agent is drawn with', () => {
  it('is its own for the agents it knows, and different for each', () => {
    const known = [
      'weather',
      'calendar',
      'email',
      'internetOfThings',
      'shoppingList',
      'todoList',
      'coding',
      'webResearch',
    ];

    expect(new Set(known.map(glyphOf)).size).toBe(known.length);
  });

  it('is a steady one of the glyphs for an agent it does not know, whatever its id', () => {
    for (const agentId of ['cooking', 'commute', 'constructor', '__proto__', 'x'.repeat(200)]) {
      const glyph = glyphOf(agentId);
      expect(glyph).toBe(glyphOf(agentId));
      expect(Number.isInteger(glyph) && glyph >= 0 && glyph < GLYPH_COUNT).toBe(true);
    }
  });
});

describe('sample mode’s pretend work', () => {
  it('has its agents at work while it thinks, one calling a tool each beat in turn', () => {
    let state = NO_WORK;
    const flared: string[] = [];
    for (let time = 0; time < SAMPLE_TOOL_SECONDS * SAMPLE_AGENTS.length; time += 0.05) {
      state = stepWork(pretendWork(state, true, time), time);
      const spots = satelliteSpots(state, time, CENTRE, RADIUS);
      spots.forEach((spot, index) => {
        const agent = describeWork(state)[index]?.agentId;
        if (spot.flare === 1 && agent !== undefined && flared.at(-1) !== agent) flared.push(agent);
      });
    }

    expect(describeWork(state).map(({ agentId }) => agentId)).toEqual([...SAMPLE_AGENTS]);
    expect(flared).toEqual([...SAMPLE_AGENTS]);
  });

  it('has them answer once it stops', () => {
    const thinking = pretendWork(NO_WORK, true, 0);

    expect(describeWork(pretendWork(thinking, false, 1)).map(({ status }) => status)).toEqual([
      'answered',
      'answered',
      'answered',
    ]);
    expect(pretendWork(NO_WORK, false, 0)).toBe(NO_WORK);
  });
});
