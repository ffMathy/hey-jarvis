import { describe, expect, it } from 'bun:test';
import { advanceTilt, createTiltState, EYE_DISTANCE_FADE_SECONDS, PHONE_EYE_SQUARES, tiltEyeSquares } from '../tilt';
import { createFlatCamera, type FlatScreen, placeFlatCamera } from './flat-camera';
import { FRONT_VIEW, type ViewBasis } from './fragment-3d';
import { ORTHOGRAPHIC_EYE_DISTANCE } from './fragment-glsl';
import { viewBasisTowards } from './view-basis';

/**
 * The camera a phone and a watch draw his body with, beside the flat picture of the rest of him,
 * multiplied out on the CPU: wherever the eye is, the drawing's square has to land on the pixels the
 * picture is drawn on, on a
 * screen that is not square with the square off its centre both ways, so that a sign, an offset or
 * a swapped span shows.
 */

/** Not square, and the drawing's square off its centre both ways. */
const SCREEN: FlatScreen = { width: 600, height: 900, squareX: 260, squareY: 400, squareSide: 540 };
/** His radius as a share of the square: about his resting share, swelled a little. */
const RADIUS_SHARE = 0.26;
/** Half the square's side in the drawing's unit. */
const HALF_SIDE = 0.5 / RADIUS_SHARE;

/** Turned 20° round him and tipped 10° above him, as a tilt turns the view. */
const TURNED_VIEW = viewBasisTowards(
  { x: 0, y: 0, z: 0 },
  {
    x: Math.sin((20 * Math.PI) / 180) * Math.cos((10 * Math.PI) / 180),
    y: Math.sin((10 * Math.PI) / 180),
    z: Math.cos((20 * Math.PI) / 180) * Math.cos((10 * Math.PI) / 180),
  },
  null,
);

/** `matrix` × `vector`, the matrix column-major as GLSL reads it. */
function times(matrix: Float32Array, vector: number[]): number[] {
  return [0, 1, 2, 3].map((row) =>
    [0, 1, 2, 3].reduce((sum, column) => sum + (matrix[column * 4 + row] ?? 0) * (vector[column] ?? 0), 0),
  );
}

/** A point in the body's frame, `right`, `up` and `front` along the view basis's axes. */
function inBody(basis: ViewBasis, right: number, up: number, front: number): number[] {
  const along = (axis: number) => right * basis.right[axis] + up * basis.up[axis] + front * basis.front[axis];
  return [along(0), along(1), along(2), 1];
}

/** Where a point in the body's frame lands: in clip space, and in the canvas's pixels from its top left. */
function landing(basis: ViewBasis, eyeSquares: number, point: number[]) {
  const camera = placeFlatCamera(createFlatCamera(), SCREEN, RADIUS_SHARE, basis, eyeSquares);
  const clip = times(camera.projection, times(camera.modelView, point));
  const [x = 0, y = 0, z = 0, w = 0] = clip;
  return {
    camera,
    w,
    x: ((x / w + 1) / 2) * SCREEN.width,
    y: ((1 - y / w) / 2) * SCREEN.height,
    depth: z / w,
  };
}

/** The square's centre and its corners, in half sides along right and up. */
const SQUARE_POINTS: Array<[right: number, up: number]> = [
  [0, 0],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

const VIEWS: Array<[name: string, basis: ViewBasis]> = [
  ['straight on', FRONT_VIEW],
  ['turned', TURNED_VIEW],
];
const EYES: Array<[name: string, eyeSquares: number]> = [
  ['from infinitely far', Number.POSITIVE_INFINITY],
  ['from the phone’s eye', PHONE_EYE_SQUARES],
];

describe('the flat camera', () => {
  for (const [viewName, basis] of VIEWS) {
    for (const [eyeName, eyeSquares] of EYES) {
      it(`lays the drawing's square on the picture's, ${viewName}, ${eyeName}`, () => {
        for (const [right, up] of SQUARE_POINTS) {
          const landed = landing(basis, eyeSquares, inBody(basis, right * HALF_SIDE, up * HALF_SIDE, 0));
          expect(landed.x).toBeCloseTo(SCREEN.squareX + (right * SCREEN.squareSide) / 2, 3);
          // Pixels count down from the top; his up is up the screen.
          expect(landed.y).toBeCloseTo(SCREEN.squareY - (up * SCREEN.squareSide) / 2, 3);
        }
      });

      it(`works a pixel out as the stroke shader does, ${viewName}, ${eyeName}`, () => {
        const { camera, w } = landing(basis, eyeSquares, inBody(basis, 0, 0, 0));
        // The shader's pixel, in the drawing's unit: 2|w| / (projection[1][1] × viewportHeight).
        const pixel = (2 * Math.abs(w)) / ((camera.projection[5] ?? 0) * SCREEN.height);
        expect(pixel).toBeCloseTo(1 / (RADIUS_SHARE * SCREEN.squareSide), 9);
      });

      it(`keeps all of him inside the depth range, ${viewName}, ${eyeName}`, () => {
        // Past the 1.86 radii anything of him reaches.
        for (const front of [-2, 2]) {
          for (const [right, up] of [
            [0, 0],
            [1, 1],
          ]) {
            const { depth } = landing(basis, eyeSquares, inBody(basis, right, up, front));
            expect(depth).toBeGreaterThan(-1);
            expect(depth).toBeLessThan(1);
          }
        }
      });
    }

    it(`puts the eye where it is asked to, in front of him, ${viewName}`, () => {
      const corner = (front: number, eyeSquares: number) =>
        landing(basis, eyeSquares, inBody(basis, HALF_SIDE, HALF_SIDE, front));
      const flat = corner(0, PHONE_EYE_SQUARES);
      const distance = flat.camera.eyeDistance;
      expect(distance).toBe(PHONE_EYE_SQUARES / RADIUS_SHARE);
      // A point one unit nearer the eye than the corner is drawn further out by the eye's perspective.
      const nearer = corner(1, PHONE_EYE_SQUARES);
      const scale = distance / (distance - 1);
      expect(nearer.x - SCREEN.squareX).toBeCloseTo((flat.x - SCREEN.squareX) * scale, 3);
      expect(nearer.y - SCREEN.squareY).toBeCloseTo((flat.y - SCREEN.squareY) * scale, 3);
      // And exactly onto the corner from infinitely far.
      const orthographic = corner(1, Number.POSITIVE_INFINITY);
      expect(orthographic.camera.eyeDistance).toBe(Number.POSITIVE_INFINITY);
      expect(orthographic.x).toBeCloseTo(flat.x, 3);
      expect(orthographic.y).toBeCloseTo(flat.y, 3);
    });
  }

  it('draws flat for an eye too far off for float32 depth to hold, or for one that is no distance at all', () => {
    for (const eyeSquares of [ORTHOGRAPHIC_EYE_DISTANCE * RADIUS_SHARE, 1e9, Number.NaN, -PHONE_EYE_SQUARES, 0]) {
      const camera = placeFlatCamera(createFlatCamera(), SCREEN, RADIUS_SHARE, FRONT_VIEW, eyeSquares);
      expect(camera.eyeDistance).toBe(Number.POSITIVE_INFINITY);
      expect(camera.projection[11]).toBe(0);
      expect(camera.projection[15]).toBe(1);
      expect([...camera.projection, ...camera.modelView].every(Number.isFinite)).toBe(true);
    }
  });

  it('never holds a standoff float32 depth cannot, as the tilt’s eye fades out on a phone’s vsync', () => {
    // The usual 60 Hz period, truncated to whole nanoseconds: the fade out ends on a remainder of a
    // perspective too small to see and large enough to put the eye a hundred thousand radii off.
    const frameSeconds = 16_666_666e-9;
    const state = createTiltState();
    const gravity = [0, -9.81 * Math.cos(0.5), -9.81 * Math.sin(0.5)];
    let tiny = false;
    const step = (reading: boolean) => {
      const [x = 0, y = 0, z = 0] = reading ? gravity : [0, 0, 0];
      advanceTilt(state, frameSeconds, x, y, z, 0);
      tiny ||= state.perspective > 0 && state.perspective < 1e-5;
      const camera = placeFlatCamera(createFlatCamera(), SCREEN, RADIUS_SHARE, FRONT_VIEW, tiltEyeSquares(state));
      expect(camera.eyeDistance === Number.POSITIVE_INFINITY || camera.eyeDistance < ORTHOGRAPHIC_EYE_DISTANCE).toBe(
        true,
      );
    };
    for (let frame = 0; frame < 60; frame++) step(true);
    for (let frame = 0; frame * frameSeconds < 2 * EYE_DISTANCE_FADE_SECONDS; frame++) step(false);
    expect(tiny).toBe(true);
    expect(tiltEyeSquares(state)).toBe(Number.POSITIVE_INFINITY);
  });
});
