import { describe, expect, it } from 'bun:test';
import type { AgentActivity, AgentActivityState } from './agent-activity';
import {
  type AgentWorkState,
  APPEAR_SECONDS,
  describeWork,
  FAILED_DRIFT,
  FLARE_SECONDS,
  FOLD_SECONDS,
  MAX_SATELLITES,
  NO_WORK,
  ORBIT_SECONDS,
  ORBIT_TILT_RADIANS,
  orbitPoint,
  PLAIN_RING_GLYPH,
  PLANNED_BRIGHTNESS,
  pretendWork,
  recordActivity,
  releaseWork,
  SAMPLE_AGENTS,
  SAMPLE_TOOL_SECONDS,
  STALE_SECONDS,
  satelliteOrbits,
  stepWork,
} from './agent-work';

const CENTRE = { x: 0, y: 0, z: 0 };

function news(delegationId: string, agentId: string, state: AgentActivityState): AgentActivity {
  return { delegationId, agentId, state };
}

/** Takes in each message at its time, stepping the state as a frame would after each. */
function play(...events: [time: number, activity: AgentActivity][]): AgentWorkState {
  let state = NO_WORK;
  for (const [time, activity] of events) state = stepWork(recordActivity(state, activity, time), time);
  return state;
}

/** Each satellite at `time`, with where it is on an orbit of radius 1 round {@link CENTRE}. */
function spotsAt(state: AgentWorkState, time: number) {
  return satelliteOrbits(state, time).map((orbit) => {
    const { across, up, towards } = orbitPoint(orbit, time);
    return { ...orbit, position: { x: across, y: up, z: towards } };
  });
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

    expect(spotsAt(planned, 1)[0]?.level).toBeCloseTo(PLANNED_BRIGHTNESS, 6);
    expect(spotsAt(working, 1)[0]?.level).toBeCloseTo(1, 6);
  });

  it(`flare on every tool their agent calls, dying away over ${FLARE_SECONDS} s`, () => {
    const state = play(
      [0, news('plan-0-weather', 'weather', 'working')],
      [2, news('plan-0-weather', 'weather', 'tool')],
    );

    expect(spotsAt(state, 2)[0]?.flare).toBe(1);
    expect(spotsAt(state, 2 + FLARE_SECONDS / 2)[0]?.flare).toBeCloseTo(0.25, 6);
    expect(spotsAt(state, 2 + FLARE_SECONDS)[0]?.flare).toBe(0);
    expect(describeWork(state)).toEqual([{ agentId: 'weather', status: 'working' }]);
  });

  it('circle him on the orbit, spread evenly round the ring', () => {
    let state = play(
      [0, news('a', 'weather', 'working')],
      [0, news('b', 'calendar', 'working')],
      [0, news('c', 'email', 'working')],
    );
    for (let time = 0; time <= 10; time += 0.1) state = stepWork(state, time);
    const spots = spotsAt(state, 10);

    for (const spot of spots) expect(distanceFromCentre(spot.position)).toBeCloseTo(1, 6);
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
    expect(gaps[0]).toBeGreaterThan(1);
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0] ?? 0, 2);
  });

  it(`fold back into him over ${FOLD_SECONDS} s when they answer, and are then forgotten`, () => {
    const state = play([0, news('a', 'weather', 'working')], [1, news('a', 'weather', 'answered')]);

    expect(distanceFromCentre(spotsAt(state, 1)[0]?.position ?? CENTRE)).toBeCloseTo(1, 6);
    expect(distanceFromCentre(spotsAt(state, 1 + FOLD_SECONDS * 0.999)[0]?.position ?? CENTRE)).toBeLessThan(0.01);
    expect(describeWork(stepWork(state, 1 + FOLD_SECONDS + 0.01))).toEqual([]);
  });

  it('drift out and go out when they fail, rather than reaching him', () => {
    const state = play([0, news('a', 'weather', 'working')], [1, news('a', 'weather', 'failed')]);
    const late = spotsAt(state, 1 + FOLD_SECONDS * 0.999)[0];

    expect(distanceFromCentre(late?.position ?? CENTRE)).toBeCloseTo(1 + FAILED_DRIFT, 2);
    expect(late?.level).toBeLessThan(0.01);
  });

  it('pulse while waiting on sir, and stay out however long he takes', () => {
    const state = stepWork(play([0, news('a', 'coding', 'asking')]), STALE_SECONDS * 3);

    expect(spotsAt(state, STALE_SECONDS * 3)[0]?.asking).toBe(true);
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

    expect(spotsAt(state, 0)[0]?.level).toBe(0);
    expect(spotsAt(stepWork(state, APPEAR_SECONDS), APPEAR_SECONDS)[0]?.level).toBeCloseTo(1, 6);
  });
});

describe('where a satellite is on the orbit', () => {
  it(`goes round once every ${ORBIT_SECONDS} s, wherever it starts`, () => {
    const start = orbitPoint({ turn: 0.2, reach: 1 }, 3);
    const later = orbitPoint({ turn: 0.2, reach: 1 }, 3 + ORBIT_SECONDS);

    expect(later.across).toBeCloseTo(start.across, 9);
    expect(later.up).toBeCloseTo(start.up, 9);
    expect(later.towards).toBeCloseTo(start.towards, 9);
  });

  it('passes below his centre in front of him and above it behind, as a ring seen from a little above', () => {
    const front = orbitPoint({ turn: 0.25, reach: 1 }, 0);
    const back = orbitPoint({ turn: 0.75, reach: 1 }, 0);

    expect(front.towards).toBeCloseTo(Math.cos(ORBIT_TILT_RADIANS), 9);
    expect(front.up).toBeCloseTo(-Math.sin(ORBIT_TILT_RADIANS), 9);
    expect(back.up).toBeCloseTo(Math.sin(ORBIT_TILT_RADIANS), 9);
  });

  it('is as far out as its reach', () => {
    const { across, up, towards } = orbitPoint({ turn: 0.13, reach: 0.4 }, 1.7);

    expect(Math.hypot(across, up, towards)).toBeCloseTo(0.4, 9);
  });
});

describe('the glyph each satellite is drawn with', () => {
  it('is the one its agent’s message brought', () => {
    const state = play([0, { ...news('a', 'weather', 'working'), glyph: 'M 0 -0.7 L 0.7 0 Z' }]);

    expect(satelliteOrbits(state, 0)[0]?.glyph).toBe('M 0 -0.7 L 0.7 0 Z');
  });

  it('is a plain ring until a message brings one, and kept when a later one brings none', () => {
    const bare = play([0, news('a', 'mystery', 'planned')]);
    const drawn = stepWork(recordActivity(bare, { ...news('a', 'mystery', 'working'), glyph: 'M 0 0 L 1 0' }, 1), 1);
    const later = stepWork(recordActivity(drawn, news('a', 'mystery', 'tool'), 2), 2);

    expect(satelliteOrbits(bare, 0)[0]?.glyph).toBe(PLAIN_RING_GLYPH);
    expect(satelliteOrbits(drawn, 1)[0]?.glyph).toBe('M 0 0 L 1 0');
    expect(satelliteOrbits(later, 2)[0]?.glyph).toBe('M 0 0 L 1 0');
  });
});

describe('sample mode’s pretend work', () => {
  it('has its agents at work while it thinks, one calling a tool each beat in turn', () => {
    let state = NO_WORK;
    const flared: string[] = [];
    for (let time = 0; time < SAMPLE_TOOL_SECONDS * SAMPLE_AGENTS.length; time += 0.05) {
      state = stepWork(pretendWork(state, true, time), time);
      const spots = spotsAt(state, time);
      spots.forEach((spot, index) => {
        const agent = describeWork(state)[index]?.agentId;
        if (spot.flare === 1 && agent !== undefined && flared.at(-1) !== agent) flared.push(agent);
      });
    }

    expect(describeWork(state).map(({ agentId }) => agentId)).toEqual(SAMPLE_AGENTS.map(({ agentId }) => agentId));
    expect(flared).toEqual(SAMPLE_AGENTS.map(({ agentId }) => agentId));
    expect(satelliteOrbits(state, 0).map(({ glyph }) => glyph)).toEqual(SAMPLE_AGENTS.map(({ glyph }) => glyph));
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
