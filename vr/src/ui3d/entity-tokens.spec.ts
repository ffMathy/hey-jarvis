import { describe, expect, it } from 'bun:test';
import { Color, InstancedMesh, Matrix4, Vector3 } from 'three';
import type { Vector3Like } from '../xr/ray';
import { createEntityTokens, MARKER_MIN_DEGREES, MAX_TOKENS, markerScaleAt, type TokenSpot } from './entity-tokens';
import { UI_COLOURS } from './ui-colours';

describe('markerScaleAt', () => {
  it('is a small dot near to', () => {
    expect(markerScaleAt(0.5)).toBe(0.5);
  });

  it('never shrinks below its least angle, so a far thing still has one', () => {
    const far = markerScaleAt(6);
    expect(far).toBeGreaterThan(0.5);
    expect(markerScaleAt(12)).toBeCloseTo(far * 2, 6);
    // Its radius at 6 m subtends the least angle.
    const radius = far * 0.7 * 0.02;
    expect((Math.atan(radius / 6) * 180) / Math.PI).toBeCloseTo(MARKER_MIN_DEGREES, 4);
  });
});

/** The orbs' and the rings' instanced meshes, as the tokens hand them to the scene. */
function meshesOf(objects: readonly unknown[]): { orbs: InstancedMesh; rings: InstancedMesh } {
  const [orbs, rings] = objects;
  if (!(orbs instanceof InstancedMesh) || !(rings instanceof InstancedMesh)) {
    throw new Error('Expected the orbs and the rings as instanced meshes.');
  }
  return { orbs, rings };
}

/**
 * Where instance `index` of `mesh` is, and how much it is scaled: read off the matrix's columns,
 * since `Matrix4.decompose` reports a scale of 1 for a matrix scaled to nothing.
 */
function instanceOf(mesh: InstancedMesh, index: number): { position: Vector3; scale: number } {
  const matrix = new Matrix4();
  mesh.getMatrixAt(index, matrix);
  return {
    position: new Vector3().setFromMatrixPosition(matrix),
    scale: new Vector3().setFromMatrixColumn(matrix, 0).length(),
  };
}

function colourOf(mesh: InstancedMesh, index: number): string {
  const colour = new Color();
  mesh.getColorAt(index, colour);
  return colour.getHexString();
}

describe('the tokens', () => {
  const eye: Vector3Like = { x: 0, y: 1.6, z: 0 };

  it('draws each look at its own size, with a marker’s ring scaled away', () => {
    const tokens = createEntityTokens();
    const { orbs, rings } = meshesOf(tokens.objects);
    const spots: TokenSpot[] = [
      { position: { x: 0, y: 1.6, z: -1 }, look: 'placed' },
      { position: { x: 0.3, y: 1.4, z: -0.5 }, look: 'carried' },
      { position: { x: 0, y: 1.6, z: -6 }, look: 'marker' },
      { position: { x: 0, y: 1.6, z: -0.5 }, look: 'marker' },
      { position: { x: -1, y: 1, z: -2 }, look: 'lost' },
    ];
    tokens.set(spots, eye);

    expect(orbs.count).toBe(spots.length);
    expect(rings.count).toBe(spots.length);
    spots.forEach((spot, index) => {
      const orb = instanceOf(orbs, index);
      expect(orb.position.x).toBeCloseTo(spot.position.x, 6);
      expect(orb.position.y).toBeCloseTo(spot.position.y, 6);
      expect(orb.position.z).toBeCloseTo(spot.position.z, 6);
    });

    expect(instanceOf(orbs, 0).scale).toBeCloseTo(1, 6);
    expect(instanceOf(rings, 0).scale).toBeCloseTo(1, 6);
    // A carried token is the one sir is looking at, so it is drawn bigger, ring and all.
    expect(instanceOf(orbs, 1).scale).toBeCloseTo(1.35, 6);
    expect(instanceOf(rings, 1).scale).toBeCloseTo(1.35, 6);
    // A marker is the orb alone, never smaller than its least angle.
    expect(instanceOf(orbs, 2).scale).toBeCloseTo(markerScaleAt(6), 6);
    expect(instanceOf(rings, 2).scale).toBe(0);
    expect(instanceOf(orbs, 3).scale).toBeCloseTo(markerScaleAt(0.5), 6);
    expect(instanceOf(rings, 3).scale).toBe(0);

    expect(colourOf(rings, 0)).toBe(new Color(UI_COLOURS.text).getHexString());
    expect(colourOf(rings, 1)).toBe(new Color(UI_COLOURS.accent).getHexString());
    expect(colourOf(rings, 4)).toBe(new Color(UI_COLOURS.danger).getHexString());
    tokens.dispose();
  });

  it(`draws no more than ${MAX_TOKENS}, and only as many as it was last given`, () => {
    const tokens = createEntityTokens();
    const { orbs, rings } = meshesOf(tokens.objects);
    const many: TokenSpot[] = Array.from({ length: MAX_TOKENS + 4 }, (_, index) => ({
      position: { x: index * 0.1, y: 1, z: -1 },
      look: 'waiting',
    }));
    tokens.set(many, eye);
    expect(orbs.count).toBe(MAX_TOKENS);
    expect(rings.count).toBe(MAX_TOKENS);
    tokens.set(many.slice(0, 2), eye);
    expect(orbs.count).toBe(2);
    expect(rings.count).toBe(2);
    tokens.dispose();
  });
});
