import type { SatelliteOrbit } from '../agent-work';
import { COLOR_BUFFER_BIT, DEPTH_BUFFER_BIT, FRAMEBUFFER, type HologramGl, STENCIL_BUFFER_BIT } from './gl-objects';
import { drawGpuBodyHalos, drawGpuBodyOnCanvas, type GpuBody, type GpuBodyFrame } from './gpu-body';
import { drawGpuPicture, type GpuPicture } from './gpu-picture';

/**
 * A whole frame of him on a phone's or a watch's canvas: the body's halos into its own target, then
 * the canvas cleared — colour, depth and stencil — and the picture of everything but his body drawn into
 * it (`gpu-picture.ts`), with his body Screened over that (`gpu-body.ts`), as one picture.
 *
 * The halos first, so a GPU that renders in tiles finishes their target before it starts on the
 * canvas, rather than breaking off the canvas to draw them.
 */
export function drawGpuFrame(
  gl: HologramGl,
  body: GpuBody,
  picture: GpuPicture,
  frame: GpuBodyFrame,
  satellites: readonly SatelliteOrbit[],
) {
  'worklet';
  drawGpuBodyHalos(gl, body, frame);
  gl.bindFramebuffer(FRAMEBUFFER, null);
  gl.viewport(0, 0, frame.camera.width, frame.camera.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clearDepth(1);
  gl.clearStencil(0);
  gl.depthMask(true);
  gl.clear(COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT | STENCIL_BUFFER_BIT);
  drawGpuPicture(gl, picture, { state: frame.state, pixels: frame.camera.width, satellites });
  drawGpuBodyOnCanvas(gl, body, frame);
}
