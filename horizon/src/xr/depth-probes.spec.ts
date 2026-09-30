import { describe, expect, it } from 'bun:test';
import { FAN_DIRECTIONS, probeFromHit } from './depth-probes';

describe('FAN_DIRECTIONS', () => {
  it('is five unit rays, all ahead and a little down', () => {
    expect(FAN_DIRECTIONS).toHaveLength(5);
    for (const direction of FAN_DIRECTIONS) {
      expect(Math.hypot(direction.x, direction.y, direction.z)).toBeCloseTo(1, 12);
      expect(direction.z).toBeLessThan(0);
      expect(direction.y).toBeLessThan(0);
    }
  });

  it('spreads across the cone placement looks in, symmetrically', () => {
    const angles = FAN_DIRECTIONS.map((direction) => (Math.atan2(-direction.x, -direction.z) * 180) / Math.PI);
    expect(angles.map((angle) => Math.round(angle))).toEqual([0, -15, 15, -30, 30]);
  });
});

describe('probeFromHit', () => {
  it('is the distance and unit direction from the head to the hit', () => {
    const probe = probeFromHit({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1.6, z: -2 });
    expect(probe).toEqual({ direction: { x: 0, y: 0, z: -1 }, distance: 2 });
  });

  it('works off the axes too', () => {
    const probe = probeFromHit({ x: 1, y: 1, z: 1 }, { x: 4, y: 5, z: 1 });
    expect(probe?.distance).toBeCloseTo(5, 12);
    expect(probe?.direction.x).toBeCloseTo(0.6, 12);
    expect(probe?.direction.y).toBeCloseTo(0.8, 12);
  });

  it('has nothing to say about a hit at the head itself', () => {
    expect(probeFromHit({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 1.6, z: 0 })).toBeUndefined();
  });
});
