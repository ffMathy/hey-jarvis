import { describe, expect, it } from 'bun:test';
import { type AgentActivity, FOLD_SECONDS, NO_WORK, recordActivity, stepWork } from 'hologram';
import { ORBIT_RADII, satelliteSpots } from './satellite-spots';

const CENTRE = { x: 0.4, y: 1.4, z: -1.5 };
const RADIUS = 0.22;

function distanceFromCentre(position: { x: number; y: number; z: number }): number {
  return Math.hypot(position.x - CENTRE.x, position.y - CENTRE.y, position.z - CENTRE.z);
}

const WORKING: AgentActivity = { delegationId: 'a', agentId: 'weather', state: 'working' };

describe('the satellites in the room', () => {
  it(`circle him at ${ORBIT_RADII} of his radii, round where he stands`, () => {
    const state = stepWork(recordActivity(NO_WORK, WORKING, 0), 0);

    for (const time of [0, 1.3, 4.9]) {
      const [spot] = satelliteSpots(state, time, CENTRE, RADIUS);
      expect(distanceFromCentre(spot?.position ?? CENTRE)).toBeCloseTo(ORBIT_RADII * RADIUS, 9);
    }
  });

  it('fold into his centre as they answer', () => {
    const answered = stepWork(
      recordActivity(stepWork(recordActivity(NO_WORK, WORKING, 0), 0), { ...WORKING, state: 'answered' }, 1),
      1,
    );
    const [spot] = satelliteSpots(answered, 1 + FOLD_SECONDS * 0.999, CENTRE, RADIUS);

    expect(distanceFromCentre(spot?.position ?? { x: 9, y: 9, z: 9 })).toBeLessThan(0.001);
  });

  it('carry the glyph, the level, the flare and whether it asks, as the drawing wants them', () => {
    const state = stepWork(recordActivity(NO_WORK, { ...WORKING, state: 'tool', glyph: 'M 0 -0.7 L 0.7 0 Z' }, 0), 0);
    const [spot] = satelliteSpots(state, 0, CENTRE, RADIUS);

    expect(spot).toMatchObject({ glyph: 'M 0 -0.7 L 0.7 0 Z', flare: 1, asking: false, level: 0 });
    expect(Object.keys(spot ?? {}).sort()).toEqual(['asking', 'flare', 'glyph', 'level', 'position']);
  });
});
