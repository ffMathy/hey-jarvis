import { type TiltState, tiltEyeSquares } from '../tilt';
import { FRONT_VIEW, type ViewBasis } from './fragment-3d';
import { type Vector3Like, viewBasisTowards } from './view-basis';

/**
 * Where the phone's tilt puts the eye, in the terms `placeFlatCamera` takes: the view plane round
 * him, and how far off the eye is in sides of the drawing's square.
 *
 * The tilt's front is in his frame as the screen holds it at rest — x right, y up the screen, z out
 * of it — and that is the body's own frame, so the eye's direction is the front as it stands: no
 * axis is turned or flipped between the two. Getting that wrong is a sign or a swapped pair that
 * turns him the wrong way and fails nothing, so it is done here, where `tilted-view.spec.ts` holds
 * it to the gestures through the camera, rather than in the view.
 */

/** Where the eye is: what the camera is placed by. */
export interface EyeView {
  basis: ViewBasis;
  /** In sides of the drawing's square; Infinity for the flat drawing's own view. */
  eyeSquares: number;
}

/** Straight on from infinitely far, as the flat drawing shows him: a desktop browser, a device not asked to tilt. */
export const STRAIGHT_ON: EyeView = { basis: FRONT_VIEW, eyeSquares: Number.POSITIVE_INFINITY };

/** His centre, which the eye looks at: the body's frame is centred on him. */
const CENTRE: Vector3Like = { x: 0, y: 0, z: 0 };

/**
 * The eye the tilt has stepped to, looking at his centre: the view plane towards its front, kept as
 * `previous` where there is none to work out, and its distance from `tiltEyeSquares`.
 */
export function tiltedView(state: TiltState, previous: ViewBasis | null): EyeView {
  'worklet';
  const eye = { x: state.front[0], y: state.front[1], z: state.front[2] };
  return { basis: viewBasisTowards(CENTRE, eye, previous), eyeSquares: tiltEyeSquares(state) };
}
