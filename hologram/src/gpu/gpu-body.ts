import { type HologramFrameState, type HologramScene, SPARKLE_TEXTURE_TEXELS } from '../hologram-drawing';
import { buildHologramRows } from './body-rows';
import { STROKE_FRAGMENT_SHADER, STROKE_VERTEX_SHADER } from './body-strokes';
import type { ViewBasis } from './fragment-3d';
import { createFragmentUniforms, type FragmentUniforms, writeFragmentUniforms } from './fragment-glsl';
import {
  ARRAY_BUFFER,
  arrayBuffer,
  BLEND,
  CLAMP_TO_EDGE,
  COLOR_ATTACHMENT0,
  COLOR_BUFFER_BIT,
  CONSTANT_ALPHA,
  CONSTANT_COLOR,
  CULL_FACE,
  carried,
  DEPTH_TEST,
  DITHER,
  ELEMENT_ARRAY_BUFFER,
  FRAMEBUFFER,
  FRAMEBUFFER_COMPLETE,
  FUNC_ADD,
  type HologramGl,
  type LinkedProgram,
  link,
  MAX,
  ONE,
  ONE_MINUS_SRC_ALPHA,
  ONE_MINUS_SRC_COLOR,
  REPEAT,
  RGBA,
  RGBA8,
  SCISSOR_TEST,
  STENCIL_TEST,
  TEXTURE_2D,
  TEXTURE0,
  TRIANGLES,
  texture,
  UNSIGNED_BYTE,
  UNSIGNED_INT,
  UNSIGNED_SHORT,
  vertexArray,
} from './gl-objects';
import { HALO_LIGHT_FRAGMENT_SHADER, HALO_LIGHT_VERTEX_SHADER, haloShares } from './halo-light';
import {
  HALO_TEXELS,
  HALO_UNION_FRAGMENT_SHADER,
  HALO_UNION_VERTEX_SHADER,
  type HaloUnionPlacement,
  haloUnionPlacement,
} from './halo-union';
import { buildRowVertices, quadsKept } from './row-vertices';

export type { HologramGl } from './gl-objects';

import { sceneSparklePixels } from './sparkle';

/**
 * Jarvis's body on the GPU with nothing but WebGL 2 — no three.js — for a phone or a watch: the
 * headset's three passes, drawn the way the headset's three.js draws them, over the picture of the
 * rest of him on the same canvas (`gpu-picture.ts`, `drawGpuFrame`).
 *
 * Per frame:
 * 1. The halo union (`halo-union.ts`) into its RGBA8 target, two squares of `haloTexels` side by
 *    side (1024×512 at the headset's HALO_TEXELS), MAX-blended, cleared first.
 * 2. Onto the canvas, cleared to transparent black: the strokes (`body-strokes.ts`), then the halos'
 *    light (`halo-light.ts`) over the drawing's square — the order three.js draws the headset's
 *    strokes and view-plane quad in (both sort to the same depth, and the strokes were made first).
 *    Both are Screen-blended and faded as one layer by the blend's constant colour, exactly as
 *    `vr/src/hologram3d/layer-blending.ts` lays the headset's parts over each other: colour
 *    `fade × part + behind × (1 − part)`, alpha `fade × alpha + behind × (1 − alpha)`.
 *
 * What it adds is premultiplied light — the halos and the strokes Screened together and faded by
 * `fade` — with alpha `alphaFromLight` of the brightest channel, over whatever the canvas holds.
 *
 * Everything here takes the context as an argument, typed as the calls it makes (`HologramGl`): a
 * browser's `WebGL2RenderingContext` and expo-gl's
 * `ExpoWebGLRenderingContext` (which extends it) both fit, and the GL enums are numbers here rather
 * than read off the context. `createGpuBody` runs on the JS thread and `drawGpuBody` is a worklet, so
 * on a phone the body crosses from the one runtime to the other: it is plain data so that it can
 * (see `GpuBody`), and the drawing then runs wherever the context lives, the UI thread with expo-gl's
 * worklet support or the JS thread.
 */

/** The view-plane square's corners, and its two triangles: three's PlaneGeometry(1, 1), corner for corner. */
const SQUARE_CORNERS = new Float32Array([-1, 1, 1, 1, -1, -1, 1, -1]);
const SQUARE_TRIANGLES = new Uint16Array([0, 2, 1, 2, 3, 1]);

/**
 * Where the eye is and how it projects, for one frame. Every length is in the drawing's unit — the
 * sphere's radius as drawn this frame — and every matrix is column-major, as GLSL reads it.
 */
export interface GpuBodyCamera {
  /** The plane through his centre that faces the eye, in the body's own frame: FRONT_VIEW straight on. */
  basis: ViewBasis;
  /** How far the eye is from his centre; Infinity for the phone's own flat projection. */
  eyeDistance: number;
  /** The body's frame to the eye's. */
  modelView: Float32Array;
  /** The eye's frame to clip space. */
  projection: Float32Array;
  /** How long the drawing's unit is in the units `modelView` ends in: 1 when it ends in the drawing's unit. */
  unitLength: number;
  /** The canvas's drawing buffer, in pixels. */
  width: number;
  height: number;
}

/** What one frame of the body needs beyond the camera. */
export interface GpuBodyFrame {
  /** `analyseFrame(frame, 1)`: at size 1, so `state.radius` is his radius as a share of the drawing's square. */
  state: HologramFrameState;
  /** The share of the rows to draw (`densityKey` order), 0–1: the GPU's own, not the frame's. */
  density: number;
  /**
   * How much of him shows, 0–1, as the blend's constant colour. 1 on a phone or a watch: the view
   * fades the whole canvas by `arrivalOf`, and a body faded here as well would show at the arrival
   * squared beside a picture at the arrival. Less than 1 only where nothing outside fades the body: the headset fades its
   * passes by the same constant (arrival × closeRangeFade), and vr's `gpu-body-check.ts` hands that
   * value in.
   */
  fade: number;
  /** What alpha the light writes, as a share of its brightest channel (see `gpu-body.ts`'s header). */
  alphaFromLight: number;
  camera: GpuBodyCamera;
}

/**
 * What `createGpuBody` makes, as plain data, so that a worklet can carry it from the JS thread to the
 * UI thread.
 *
 * On a phone or a watch, expo-gl makes every GL object as an instance of a class of its own
 * (`WebGLProgram` and the rest, each with an `id`), and the worklets runtime copies nothing between
 * runtimes but plain objects, arrays and typed arrays: it throws on the rest. expo-gl reads nothing
 * of a GL object but its `id`, so the body keeps a plain `{ id }` in place of each. A browser's GL
 * objects have no `id` and are kept as they are; nothing copies them there.
 */
export interface GpuBody {
  /** Texels across each half of the halo target. */
  haloTexels: number;
  rowCount: number;
  indexCount: number;
  indexType: number;
  /** Each quad's density key in the index's order, ascending, so a frame draws only the quads its share keeps. */
  quadKeys: Float32Array;
  /** Written every frame, so a frame allocates as little as it can. */
  fragmentUniforms: FragmentUniforms;
  haloPlacement: HaloUnionPlacement;
  shares: [number, number, number];
  haloUnion: LinkedProgram;
  strokes: LinkedProgram;
  haloLight: LinkedProgram;
  /** Each program's vertex array: the halo union's and the strokes' over the same row buffers. */
  haloUnionArray: WebGLVertexArrayObject;
  strokeArray: WebGLVertexArrayObject;
  squareArray: WebGLVertexArrayObject;
  sparkle: WebGLTexture;
  haloTexture: WebGLTexture;
  haloFramebuffer: WebGLFramebuffer;
}

/** The names of the fragment uniforms, in the order they are written. */
const FRAGMENT_UNIFORM_NAMES = Object.keys(createFragmentUniforms());

const HALO_UNION_UNIFORMS = [...FRAGMENT_UNIFORM_NAMES, 'texelUnits', 'radiusFraction'];
const STROKE_UNIFORMS = [
  ...FRAGMENT_UNIFORM_NAMES,
  'modelViewMatrix',
  'projectionMatrix',
  'viewportHeight',
  'unitMetres',
  'sparkle',
  'alphaFromLight',
];
const HALO_LIGHT_UNIFORMS = [
  'modelViewMatrix',
  'projectionMatrix',
  'viewRight',
  'viewUp',
  'halfSide',
  'halo',
  'haloShares',
  'alphaFromLight',
];

export interface GpuBodyOptions {
  /**
   * Texels across each half of the halo target: HALO_TEXELS (512, the headset's) unless the halos
   * are drawn smaller than that on screen, where fewer cost less fill for the same look.
   */
  haloTexels?: number;
}

/**
 * Compiles the three passes and uploads the scene's rows, the sparkle and the halo target, on
 * whichever thread holds `gl`. Throws when the GPU refuses any of it — a context without GLSL ES
 * 3.00, a shader that will not compile, a target it cannot render into — and the app then draws
 * nothing of him, and lets the context go with whatever was made before the refusal.
 */
export function createGpuBody(gl: HologramGl, scene: HologramScene, options: GpuBodyOptions = {}): GpuBody {
  const haloTexels = options.haloTexels ?? HALO_TEXELS;
  const rows = buildHologramRows(scene);
  const vertices = buildRowVertices(rows);
  const haloUnion = link(gl, HALO_UNION_VERTEX_SHADER, HALO_UNION_FRAGMENT_SHADER, HALO_UNION_UNIFORMS);
  const strokes = link(gl, STROKE_VERTEX_SHADER, STROKE_FRAGMENT_SHADER, STROKE_UNIFORMS);
  const haloLight = link(gl, HALO_LIGHT_VERTEX_SHADER, HALO_LIGHT_FRAGMENT_SHADER, HALO_LIGHT_UNIFORMS);

  const rowAttributes: [string, WebGLBuffer, number][] = vertices.attributes.map(({ name, size, values }) => [
    name,
    arrayBuffer(gl, ARRAY_BUFFER, values),
    size,
  ]);
  rowAttributes.push(['corner', arrayBuffer(gl, ARRAY_BUFFER, vertices.corner), 2]);
  const rowIndex = arrayBuffer(gl, ELEMENT_ARRAY_BUFFER, vertices.index);
  // One vertex array per program over the same buffers: the linker numbers each program's attributes.
  const haloUnionArray = vertexArray(gl, haloUnion.program, rowAttributes, rowIndex);
  const strokeArray = vertexArray(gl, strokes.program, rowAttributes, rowIndex);
  const squareCorners = arrayBuffer(gl, ARRAY_BUFFER, SQUARE_CORNERS);
  const squareIndex = arrayBuffer(gl, ELEMENT_ARRAY_BUFFER, SQUARE_TRIANGLES);
  const squareArray = vertexArray(gl, haloLight.program, [['corner', squareCorners, 2]], squareIndex);

  // Repeated both ways, linear, no mipmaps: the drawing's image shader (see sparkle.ts).
  const sparkle = texture(gl, REPEAT);
  gl.texImage2D(
    TEXTURE_2D,
    0,
    RGBA8,
    SPARKLE_TEXTURE_TEXELS,
    SPARKLE_TEXTURE_TEXELS,
    0,
    RGBA,
    UNSIGNED_BYTE,
    sceneSparklePixels(scene),
  );
  // Bytes, as three's render target is: R, G, B = how much the dim, mid and bright halos cover.
  const haloTexture = texture(gl, CLAMP_TO_EDGE);
  gl.texImage2D(TEXTURE_2D, 0, RGBA8, haloTexels * 2, haloTexels, 0, RGBA, UNSIGNED_BYTE, null);
  gl.bindTexture(TEXTURE_2D, null);
  const haloFramebuffer = gl.createFramebuffer();
  if (haloFramebuffer === null) throw new Error('The GPU body could not make a framebuffer.');
  gl.bindFramebuffer(FRAMEBUFFER, haloFramebuffer);
  gl.framebufferTexture2D(FRAMEBUFFER, COLOR_ATTACHMENT0, TEXTURE_2D, haloTexture, 0);
  const complete = gl.checkFramebufferStatus(FRAMEBUFFER) === FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(FRAMEBUFFER, null);
  if (!complete) throw new Error('The GPU body could not render into its halo target.');

  return {
    haloTexels,
    rowCount: rows.count,
    indexCount: vertices.index.length,
    indexType: vertices.index instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT,
    quadKeys: vertices.keys,
    fragmentUniforms: createFragmentUniforms(),
    haloPlacement: { texelUnits: 0, radiusFraction: 0 },
    shares: [0, 0, 0],
    haloUnion,
    strokes,
    haloLight,
    haloUnionArray: carried(haloUnionArray),
    strokeArray: carried(strokeArray),
    squareArray: carried(squareArray),
    sparkle: carried(sparkle),
    haloTexture: carried(haloTexture),
    haloFramebuffer: carried(haloFramebuffer),
  };
}

/** Sets one uniform from a number or a vector of 2–4, as three's uniforms hold them. */
function setUniform(
  gl: HologramGl,
  location: WebGLUniformLocation | null | undefined,
  value: number | readonly number[],
) {
  'worklet';
  if (location === null || location === undefined) return;
  if (typeof value === 'number') gl.uniform1f(location, value);
  else if (value.length === 2) gl.uniform2f(location, value[0], value[1]);
  else if (value.length === 3) gl.uniform3f(location, value[0], value[1], value[2]);
  else if (value.length === 4) gl.uniform4f(location, value[0], value[1], value[2], value[3]);
}

function setFragmentUniforms(gl: HologramGl, program: LinkedProgram, uniforms: FragmentUniforms) {
  'worklet';
  for (let at = 0; at < FRAGMENT_UNIFORM_NAMES.length; at++) {
    const name = FRAGMENT_UNIFORM_NAMES[at];
    setUniform(gl, program.uniforms[name], uniforms[name].value);
  }
}

/** The halo union, into its target: each texel keeps the most any halo covers it by. */
function drawHaloUnion(gl: HologramGl, body: GpuBody, radiusShare: number, indexCount: number) {
  'worklet';
  const placement = haloUnionPlacement(radiusShare, body.haloPlacement, body.haloTexels);
  gl.bindFramebuffer(FRAMEBUFFER, body.haloFramebuffer);
  gl.viewport(0, 0, body.haloTexels * 2, body.haloTexels);
  gl.clear(COLOR_BUFFER_BIT);
  gl.enable(BLEND);
  gl.blendEquationSeparate(MAX, MAX);
  gl.blendFuncSeparate(ONE, ONE, ONE, ONE);
  const program = body.haloUnion;
  gl.useProgram(program.program);
  setFragmentUniforms(gl, program, body.fragmentUniforms);
  setUniform(gl, program.uniforms.texelUnits, placement.texelUnits);
  setUniform(gl, program.uniforms.radiusFraction, placement.radiusFraction);
  gl.bindVertexArray(body.haloUnionArray);
  gl.drawElements(TRIANGLES, indexCount, body.indexType, 0);
}

/** The strokes, onto the canvas, where each fragment is. */
function drawStrokes(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame, indexCount: number) {
  'worklet';
  const { camera } = frame;
  const program = body.strokes;
  gl.useProgram(program.program);
  setFragmentUniforms(gl, program, body.fragmentUniforms);
  gl.uniformMatrix4fv(program.uniforms.modelViewMatrix, false, camera.modelView);
  gl.uniformMatrix4fv(program.uniforms.projectionMatrix, false, camera.projection);
  setUniform(gl, program.uniforms.viewportHeight, Math.max(1, camera.height));
  setUniform(gl, program.uniforms.unitMetres, camera.unitLength);
  setUniform(gl, program.uniforms.alphaFromLight, frame.alphaFromLight);
  gl.activeTexture(TEXTURE0);
  gl.bindTexture(TEXTURE_2D, body.sparkle);
  gl.uniform1i(program.uniforms.sparkle, 0);
  gl.bindVertexArray(body.strokeArray);
  gl.drawElements(TRIANGLES, indexCount, body.indexType, 0);
}

/** The halos' light, onto the canvas, over the drawing's square in the plane through his centre. */
function drawHaloLight(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame) {
  'worklet';
  const { camera, state } = frame;
  const program = body.haloLight;
  gl.useProgram(program.program);
  gl.uniformMatrix4fv(program.uniforms.modelViewMatrix, false, camera.modelView);
  gl.uniformMatrix4fv(program.uniforms.projectionMatrix, false, camera.projection);
  setUniform(gl, program.uniforms.viewRight, body.fragmentUniforms.viewRight.value);
  setUniform(gl, program.uniforms.viewUp, body.fragmentUniforms.viewUp.value);
  setUniform(gl, program.uniforms.halfSide, 0.5 / state.radius);
  setUniform(gl, program.uniforms.haloShares, haloShares(state.glowGain, body.shares));
  setUniform(gl, program.uniforms.alphaFromLight, frame.alphaFromLight);
  gl.activeTexture(TEXTURE0);
  gl.bindTexture(TEXTURE_2D, body.haloTexture);
  gl.uniform1i(program.uniforms.halo, 0);
  gl.bindVertexArray(body.squareArray);
  gl.drawElements(TRIANGLES, SQUARE_TRIANGLES.length, UNSIGNED_SHORT, 0);
}

/** The state every pass assumes: no depth, culling, stencil, scissor or dither. */
function resetPassState(gl: HologramGl) {
  'worklet';
  gl.disable(DEPTH_TEST);
  gl.disable(CULL_FACE);
  gl.disable(STENCIL_TEST);
  gl.disable(SCISSOR_TEST);
  gl.disable(DITHER);
}

/** Whether anything of the body is drawn this frame: not while he is faded out. */
function bodyShows(frame: GpuBodyFrame) {
  'worklet';
  return frame.fade > 0 && frame.state.arrival > 0;
}

/**
 * The first of a frame's passes: the halo union, into the body's own target. A phone and a watch
 * draw it before anything goes onto the canvas — their canvas then carries the picture of the rest of
 * him as well (`gpu-picture.ts`) — so a GPU that renders in tiles finishes the target before the
 * canvas is begun rather than breaking off the canvas to draw it.
 */
export function drawGpuBodyHalos(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame) {
  'worklet';
  resetPassState(gl);
  if (!bodyShows(frame)) return;
  const { state, camera } = frame;
  writeFragmentUniforms(body.fragmentUniforms, state, camera.basis, frame.density, camera.eyeDistance);
  // Only the quads the share keeps, which are the index's first: the rest would be shaded only to be hidden.
  drawHaloUnion(gl, body, state.radius, quadsKept(body.quadKeys, frame.density) * 6);
}

/**
 * The rest of a frame of the body, after {@link drawGpuBodyHalos}: onto the canvas, Screened and
 * faded as one layer, the strokes, then the halos' light. Whatever is on the canvas already stays.
 */
export function drawGpuBodyOnCanvas(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame) {
  'worklet';
  if (!bodyShows(frame)) return;
  const { camera } = frame;
  gl.disable(STENCIL_TEST);
  gl.bindFramebuffer(FRAMEBUFFER, null);
  gl.viewport(0, 0, camera.width, camera.height);
  gl.enable(BLEND);
  gl.blendEquationSeparate(FUNC_ADD, FUNC_ADD);
  gl.blendFuncSeparate(CONSTANT_COLOR, ONE_MINUS_SRC_COLOR, CONSTANT_ALPHA, ONE_MINUS_SRC_ALPHA);
  gl.blendColor(frame.fade, frame.fade, frame.fade, frame.fade);
  drawStrokes(gl, body, frame, quadsKept(body.quadKeys, frame.density) * 6);
  drawHaloLight(gl, body, frame);
  gl.bindVertexArray(null);
  gl.bindTexture(TEXTURE_2D, null);
  gl.disable(BLEND);
}

/**
 * Draws one frame of the body onto the canvas's own framebuffer, cleared first, and leaves it there
 * for the caller to present (expo-gl's `endFrameEXP`; a browser presents on its own). Nothing but
 * the clear while he is faded out. The headset's check draws it so; a phone and a watch draw the
 * picture between its two halves.
 */
export function drawGpuBody(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame) {
  'worklet';
  resetPassState(gl);
  gl.bindFramebuffer(FRAMEBUFFER, null);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(COLOR_BUFFER_BIT);
  drawGpuBodyHalos(gl, body, frame);
  drawGpuBodyOnCanvas(gl, body, frame);
}
