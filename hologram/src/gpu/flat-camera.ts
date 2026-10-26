import { FRONT_VIEW, type ViewBasis } from './fragment-3d';
import { ORTHOGRAPHIC_EYE_DISTANCE } from './fragment-glsl';
import type { GpuBodyCamera } from './gpu-body';

/**
 * The camera for a phone's or a watch's screen: an eye looking at his centre along the view basis's
 * front, from `eyeSquares` of the drawing's square away (Infinity for the phone's own flat look),
 * projecting the plane through his centre so that the drawing's square lands exactly where the flat
 * picture of the rest of him (`gpu-picture.ts`) is drawn on the canvas.
 *
 * That last part is what lets the body and the picture be one: the halo light's square stands in
 * that plane, so it covers the picture's square to the pixel whatever the view, and the strokes on
 * that plane land where the picture's would. Off it, the eye's perspective moves them, which is the
 * point of the tilt.
 *
 * The eye's distance is held in squares rather than in his radius, so that as he swells with his
 * voice he grows towards the eye, as he does in a room, rather than the eye backing off with him.
 */

/** Where the drawing's square is on the canvas. */
export interface FlatScreen {
  /** The canvas's drawing buffer, in pixels. */
  width: number;
  height: number;
  /** Where the centre of the drawing's square is on it, in pixels from the top left. */
  squareX: number;
  squareY: number;
  /** How many of the buffer's pixels the drawing's square is across. */
  squareSide: number;
}

/** The plane-through-his-centre's depth range kept either side, in the drawing's unit: past all he ever reaches. */
const DEPTH_REACH = 8;
/** How far off the orthographic eye is put, in the drawing's unit: anywhere in front of all of him. */
const ORTHOGRAPHIC_STANDOFF = 10;

/** A camera for `placeFlatCamera` to fill every frame, so a frame allocates no matrices. */
export function createFlatCamera(): GpuBodyCamera {
  return {
    basis: FRONT_VIEW,
    eyeDistance: Number.POSITIVE_INFINITY,
    modelView: new Float32Array(16),
    projection: new Float32Array(16),
    unitLength: 1,
    width: 1,
    height: 1,
  };
}

/**
 * Fills `camera` for this frame. `radiusShare` is his radius as a share of the square
 * (`analyseFrame(frame, 1, scene).radius`), `basis` the view plane in the body's frame
 * (`inFrame(viewBasisTowards(...), bodyFrame(front))`, or FRONT_VIEW straight on), and `eyeSquares`
 * how far the eye is in square sides — on a phone the tilt's `tiltEyeSquares`, already in them.
 * Infinity draws him with the phone's flat projection, and so does an eye ORTHOGRAPHIC_EYE_DISTANCE
 * of his radii away or further.
 */
export function placeFlatCamera(
  camera: GpuBodyCamera,
  screen: FlatScreen,
  radiusShare: number,
  basis: ViewBasis,
  eyeSquares: number,
): GpuBodyCamera {
  'worklet';
  const { right, up, front } = basis;
  const eyeAway = eyeSquares / radiusShare;
  // Further off than this, the depth range cancels away to nothing in float32 and he is clipped,
  // while the eye is as good as infinitely far anyway; the tilt's eye passes through here on every
  // fade back out. Written so that a NaN, or an eye behind him, lands on the flat projection too.
  const perspective = eyeAway > 0 && eyeAway < ORTHOGRAPHIC_EYE_DISTANCE;
  const eye = perspective ? eyeAway : Number.POSITIVE_INFINITY;
  const standoff = perspective ? eye : ORTHOGRAPHIC_STANDOFF;
  // The body's frame to the eye's: x along right, y along up, the eye down -z at `standoff`.
  const view = camera.modelView;
  view[0] = right[0];
  view[1] = up[0];
  view[2] = front[0];
  view[3] = 0;
  view[4] = right[1];
  view[5] = up[1];
  view[6] = front[1];
  view[7] = 0;
  view[8] = right[2];
  view[9] = up[2];
  view[10] = front[2];
  view[11] = 0;
  view[12] = 0;
  view[13] = 0;
  view[14] = -standoff;
  view[15] = 1;

  // Where the square's centre is in clip space, and how much of it the square spans.
  const offsetX = (2 * screen.squareX) / screen.width - 1;
  const offsetY = 1 - (2 * screen.squareY) / screen.height;
  const spanX = screen.squareSide / screen.width;
  const spanY = screen.squareSide / screen.height;
  const near = perspective ? Math.max(standoff - DEPTH_REACH, 0.05 * standoff) : 0.1;
  const far = standoff + DEPTH_REACH;
  const projection = camera.projection;
  projection.fill(0);
  // Half the square's side in the drawing's unit is 0.5 / radiusShare, and it lands on half the
  // square's span: at his centre's depth, through the eye's perspective, or everywhere without it.
  if (perspective) {
    // x_ndc = focal × x / −z + offset.
    projection[0] = 2 * radiusShare * spanX * standoff;
    projection[5] = 2 * radiusShare * spanY * standoff;
    projection[8] = -offsetX;
    projection[9] = -offsetY;
    projection[10] = -(far + near) / (far - near);
    projection[11] = -1;
    projection[14] = (-2 * far * near) / (far - near);
  } else {
    projection[0] = 2 * radiusShare * spanX;
    projection[5] = 2 * radiusShare * spanY;
    projection[10] = -2 / (far - near);
    projection[12] = offsetX;
    projection[13] = offsetY;
    projection[14] = -(far + near) / (far - near);
    projection[15] = 1;
  }
  camera.basis = basis;
  camera.eyeDistance = eye;
  camera.unitLength = 1;
  camera.width = screen.width;
  camera.height = screen.height;
  return camera;
}
