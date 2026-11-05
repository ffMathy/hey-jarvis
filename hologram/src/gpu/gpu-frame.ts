import type { SatelliteOrbit } from '../agent-work';
import { COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT, FRAMEBUFFER, type HologramGl, STENCIL_BUFFER_BIT } from './gl-objects';
import { drawGpuBodyHalos, drawGpuBodyOnCanvas, type GpuBody, type GpuBodyFrame } from './gpu-body';
import { drawGpuPicture, drawGpuPictureCascade, type GpuPicture, writeGpuPictureCascade } from './gpu-picture';

/**
 * A whole frame of him on a phone's or a watch's canvas: the body's halos into its own target, then
 * the canvas cleared — colour, depth and stencil — and the picture of everything but his body drawn into
 * it (`gpu-picture.ts`), with his body Screened over that (`gpu-body.ts`), as one picture, and the
 * cage's cascades over both (`drawGpuPictureCascade`).
 *
 * The halos first, so a GPU that renders in tiles finishes their target before it starts on the
 * canvas, rather than breaking off the canvas to draw them; and before them, where the cage's
 * cascades are (`cage-cascade.ts`), which the picture draws.
 */
export function drawGpuFrame(
  gl: HologramGl,
  body: GpuBody,
  picture: GpuPicture,
  frame: GpuBodyFrame,
  satellites: readonly SatelliteOrbit[],
) {
  'worklet';
  writeGpuPictureCascade(picture, frame.state);
  drawGpuBodyHalos(gl, body, frame);
  gl.bindFramebuffer(FRAMEBUFFER, null);
  gl.viewport(0, 0, frame.camera.width, frame.camera.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1);
  gl.clearStencil(0);
  gl.depthMask(true);
  gl.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT);
  const pictureFrame = { state: frame.state, pixels: frame.camera.width, satellites };
  drawGpuPicture(gl, picture, pictureFrame);
  drawGpuBodyOnCanvas(gl, body, frame);
  drawGpuPictureCascade(gl, picture, pictureFrame);
}
