import { type HologramFrameState, type HologramScene, SPARKLE_TEXTURE_TEXELS } from '../hologram-drawing';
import { buildHologramRows } from './body-rows';
import { STROKE_FRAGMENT_SHADER, STROKE_VERTEX_SHADER } from './body-strokes';
import type { ViewBasis } from './fragment-3d';
import { createFragmentUniforms, type FragmentUniforms, writeFragmentUniforms } from './fragment-glsl';
import { HALO_LIGHT_FRAGMENT_SHADER, HALO_LIGHT_VERTEX_SHADER, haloShares } from './halo-light';
import {
  HALO_TEXELS,
  HALO_UNION_FRAGMENT_SHADER,
  HALO_UNION_VERTEX_SHADER,
  type HaloUnionPlacement,
  haloUnionPlacement,
} from './halo-union';
import { buildRowVertices } from './row-vertices';
import { sceneSparklePixels } from './sparkle';

/**
 * Jarvis's body on the GPU with nothing but WebGL 2 — no three.js — for a phone or a watch: the
 * headset's three passes, drawn the way the headset's three.js draws them, onto a canvas of its
 * own that the app lays over Skia's picture of the rest of him.
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
 * What it leaves is premultiplied light over transparent black — the halos and the strokes Screened
 * together and faded by `fade` — with alpha `alphaFromLight` of the brightest channel, for the app
 * to composite over Skia's picture.
 *
 * Everything here takes the context as an argument, typed as the calls it makes (`HologramGl`), as
 * the drawing takes Skia: a browser's `WebGL2RenderingContext` and expo-gl's
 * `ExpoWebGLRenderingContext` (which extends it) both fit, and the GL enums are numbers here rather
 * than read off the context. `drawGpuBody` is a worklet over plain data, so it can run wherever the
 * context lives: the UI thread with expo-gl's worklet support, or the JS thread.
 */

/** The WebGL 2 calls the raw renderer makes, and nothing else: widen this to make another. */
export type HologramGl = Pick<
  WebGL2RenderingContext,
  | 'activeTexture'
  | 'attachShader'
  | 'bindBuffer'
  | 'bindFramebuffer'
  | 'bindTexture'
  | 'bindVertexArray'
  | 'blendColor'
  | 'blendEquationSeparate'
  | 'blendFuncSeparate'
  | 'bufferData'
  | 'checkFramebufferStatus'
  | 'clear'
  | 'clearColor'
  | 'compileShader'
  | 'createBuffer'
  | 'createFramebuffer'
  | 'createProgram'
  | 'createShader'
  | 'createTexture'
  | 'createVertexArray'
  | 'deleteBuffer'
  | 'deleteFramebuffer'
  | 'deleteProgram'
  | 'deleteShader'
  | 'deleteTexture'
  | 'deleteVertexArray'
  | 'disable'
  | 'drawElements'
  | 'enable'
  | 'enableVertexAttribArray'
  | 'framebufferTexture2D'
  | 'getAttribLocation'
  | 'getProgramInfoLog'
  | 'getProgramParameter'
  | 'getShaderInfoLog'
  | 'getShaderParameter'
  | 'getUniformLocation'
  | 'linkProgram'
  | 'shaderSource'
  | 'texImage2D'
  | 'texParameteri'
  | 'uniform1f'
  | 'uniform1i'
  | 'uniform2f'
  | 'uniform3f'
  | 'uniform4f'
  | 'uniformMatrix4fv'
  | 'useProgram'
  | 'vertexAttribPointer'
  | 'viewport'
>;

// The GL enums the renderer uses, as the numbers the WebGL 2 and OpenGL ES 3 specifications give.
const VERTEX_SHADER = 0x8b31;
const FRAGMENT_SHADER = 0x8b30;
const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;
const ARRAY_BUFFER = 0x8892;
const ELEMENT_ARRAY_BUFFER = 0x8893;
const STATIC_DRAW = 0x88e4;
const FLOAT = 0x1406;
const UNSIGNED_BYTE = 0x1401;
const UNSIGNED_SHORT = 0x1403;
const UNSIGNED_INT = 0x1405;
const TRIANGLES = 0x0004;
const TEXTURE_2D = 0x0de1;
const TEXTURE0 = 0x84c0;
const RGBA = 0x1908;
const RGBA8 = 0x8058;
const TEXTURE_MAG_FILTER = 0x2800;
const TEXTURE_MIN_FILTER = 0x2801;
const TEXTURE_WRAP_S = 0x2802;
const TEXTURE_WRAP_T = 0x2803;
const LINEAR = 0x2601;
const REPEAT = 0x2901;
const CLAMP_TO_EDGE = 0x812f;
const FRAMEBUFFER = 0x8d40;
const COLOR_ATTACHMENT0 = 0x8ce0;
const FRAMEBUFFER_COMPLETE = 0x8cd5;
const COLOR_BUFFER_BIT = 0x4000;
const BLEND = 0x0be2;
const CULL_FACE = 0x0b44;
const DEPTH_TEST = 0x0b71;
const STENCIL_TEST = 0x0b90;
const SCISSOR_TEST = 0x0c11;
const DITHER = 0x0bd0;
const FUNC_ADD = 0x8006;
const MAX = 0x8008;
const ONE = 1;
const ONE_MINUS_SRC_COLOR = 0x0301;
const ONE_MINUS_SRC_ALPHA = 0x0303;
const CONSTANT_COLOR = 0x8001;
const CONSTANT_ALPHA = 0x8003;

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
  /** `analyseFrame(frame, 1, scene)`: at size 1, so `state.radius` is his radius as a share of the drawing's square. */
  state: HologramFrameState;
  /** The share of the rows to draw (`densityKey` order), 0–1: the GPU's own, not the frame's. */
  density: number;
  /** How much of him shows, 0–1: `state.arrival` on a phone, as the drawing's arrival layer fades him. */
  fade: number;
  /** What alpha the light writes, as a share of its brightest channel (see `gpu-body.ts`'s header). */
  alphaFromLight: number;
  camera: GpuBodyCamera;
}

interface LinkedProgram {
  program: WebGLProgram;
  /** Every uniform the program reads, by name; null for one the compiler dropped. */
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/** What `createGpuBody` makes: plain data, so a worklet can carry it. */
export interface GpuBody {
  /** Texels across each half of the halo target. */
  haloTexels: number;
  rowCount: number;
  indexCount: number;
  indexType: number;
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
  buffers: WebGLBuffer[];
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

function compile(gl: HologramGl, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('The GPU body could not make a shader.');
  // GLSL ES 3.00, as three's RawShaderMaterial with GLSL3 compiles the headset's.
  gl.shaderSource(shader, `#version 300 es\n${source}`);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`The GPU body's shader did not compile: ${log}`);
  }
  return shader;
}

function link(gl: HologramGl, vertexSource: string, fragmentSource: string, uniformNames: string[]): LinkedProgram {
  const program = gl.createProgram();
  if (program === null) throw new Error('The GPU body could not make a program.');
  const vertex = compile(gl, VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`The GPU body's program did not link: ${log}`);
  }
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);
  return { program, uniforms };
}

function arrayBuffer(gl: HologramGl, buffers: WebGLBuffer[], target: number, data: ArrayBufferView): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error('The GPU body could not make a buffer.');
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, STATIC_DRAW);
  buffers.push(buffer);
  return buffer;
}

/** A vertex array for `program` over the named buffers, each of its size in floats a vertex, and the index. */
function vertexArray(
  gl: HologramGl,
  program: WebGLProgram,
  attributes: [string, WebGLBuffer, number][],
  index: WebGLBuffer,
): WebGLVertexArrayObject {
  const array = gl.createVertexArray();
  if (array === null) throw new Error('The GPU body could not make a vertex array.');
  gl.bindVertexArray(array);
  for (const [name, buffer, size] of attributes) {
    const location = gl.getAttribLocation(program, name);
    // A program that does not read an attribute is not given it.
    if (location < 0) continue;
    gl.bindBuffer(ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, FLOAT, false, 0, 0);
  }
  gl.bindBuffer(ELEMENT_ARRAY_BUFFER, index);
  gl.bindVertexArray(null);
  return array;
}

function texture(gl: HologramGl, wrap: number): WebGLTexture {
  const made = gl.createTexture();
  if (made === null) throw new Error('The GPU body could not make a texture.');
  gl.bindTexture(TEXTURE_2D, made);
  gl.texParameteri(TEXTURE_2D, TEXTURE_MIN_FILTER, LINEAR);
  gl.texParameteri(TEXTURE_2D, TEXTURE_MAG_FILTER, LINEAR);
  gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_S, wrap);
  gl.texParameteri(TEXTURE_2D, TEXTURE_WRAP_T, wrap);
  return made;
}

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
 * 3.00, a shader that will not compile, a target it cannot render into — and the app then draws the
 * body in Skia as it always has, and lets the context go with whatever was made before the refusal.
 */
export function createGpuBody(gl: HologramGl, scene: HologramScene, options: GpuBodyOptions = {}): GpuBody {
  const haloTexels = options.haloTexels ?? HALO_TEXELS;
  const rows = buildHologramRows(scene);
  const vertices = buildRowVertices(rows);
  const buffers: WebGLBuffer[] = [];
  const haloUnion = link(gl, HALO_UNION_VERTEX_SHADER, HALO_UNION_FRAGMENT_SHADER, HALO_UNION_UNIFORMS);
  const strokes = link(gl, STROKE_VERTEX_SHADER, STROKE_FRAGMENT_SHADER, STROKE_UNIFORMS);
  const haloLight = link(gl, HALO_LIGHT_VERTEX_SHADER, HALO_LIGHT_FRAGMENT_SHADER, HALO_LIGHT_UNIFORMS);

  const rowAttributes: [string, WebGLBuffer, number][] = vertices.attributes.map(({ name, size, values }) => [
    name,
    arrayBuffer(gl, buffers, ARRAY_BUFFER, values),
    size,
  ]);
  rowAttributes.push(['corner', arrayBuffer(gl, buffers, ARRAY_BUFFER, vertices.corner), 2]);
  const rowIndex = arrayBuffer(gl, buffers, ELEMENT_ARRAY_BUFFER, vertices.index);
  // One vertex array per program over the same buffers: the linker numbers each program's attributes.
  const haloUnionArray = vertexArray(gl, haloUnion.program, rowAttributes, rowIndex);
  const strokeArray = vertexArray(gl, strokes.program, rowAttributes, rowIndex);
  const squareCorners = arrayBuffer(gl, buffers, ARRAY_BUFFER, SQUARE_CORNERS);
  const squareIndex = arrayBuffer(gl, buffers, ELEMENT_ARRAY_BUFFER, SQUARE_TRIANGLES);
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
    fragmentUniforms: createFragmentUniforms(),
    haloPlacement: { texelUnits: 0, radiusFraction: 0 },
    shares: [0, 0, 0],
    haloUnion,
    strokes,
    haloLight,
    haloUnionArray,
    strokeArray,
    squareArray,
    buffers,
    sparkle,
    haloTexture,
    haloFramebuffer,
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
function drawHaloUnion(gl: HologramGl, body: GpuBody, radiusShare: number) {
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
  gl.drawElements(TRIANGLES, body.indexCount, body.indexType, 0);
}

/** The strokes, onto the canvas, where each fragment is. */
function drawStrokes(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame) {
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
  gl.drawElements(TRIANGLES, body.indexCount, body.indexType, 0);
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

/**
 * Draws one frame of the body onto the canvas's own framebuffer, cleared first, and leaves it there
 * for the caller to present (expo-gl's `endFrameEXP`; a browser presents on its own). Nothing but
 * the clear while he is faded out.
 */
export function drawGpuBody(gl: HologramGl, body: GpuBody, frame: GpuBodyFrame) {
  'worklet';
  const { state, camera } = frame;
  gl.disable(DEPTH_TEST);
  gl.disable(CULL_FACE);
  gl.disable(STENCIL_TEST);
  gl.disable(SCISSOR_TEST);
  gl.disable(DITHER);
  gl.bindFramebuffer(FRAMEBUFFER, null);
  gl.viewport(0, 0, camera.width, camera.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(COLOR_BUFFER_BIT);
  if (frame.fade > 0 && state.arrival > 0) {
    writeFragmentUniforms(body.fragmentUniforms, state, camera.basis, frame.density, camera.eyeDistance);
    drawHaloUnion(gl, body, state.radius);
    // Onto the canvas, Screened and faded as one layer: the strokes, then the halos' light.
    gl.bindFramebuffer(FRAMEBUFFER, null);
    gl.viewport(0, 0, camera.width, camera.height);
    gl.blendEquationSeparate(FUNC_ADD, FUNC_ADD);
    gl.blendFuncSeparate(CONSTANT_COLOR, ONE_MINUS_SRC_COLOR, CONSTANT_ALPHA, ONE_MINUS_SRC_ALPHA);
    gl.blendColor(frame.fade, frame.fade, frame.fade, frame.fade);
    drawStrokes(gl, body, frame);
    drawHaloLight(gl, body, frame);
    gl.bindVertexArray(null);
    gl.bindTexture(TEXTURE_2D, null);
    gl.disable(BLEND);
  }
}

/** Lets go of everything `createGpuBody` made. */
export function disposeGpuBody(gl: HologramGl, body: GpuBody) {
  for (const buffer of body.buffers) gl.deleteBuffer(buffer);
  gl.deleteVertexArray(body.haloUnionArray);
  gl.deleteVertexArray(body.strokeArray);
  gl.deleteVertexArray(body.squareArray);
  gl.deleteProgram(body.haloUnion.program);
  gl.deleteProgram(body.strokes.program);
  gl.deleteProgram(body.haloLight.program);
  gl.deleteTexture(body.sparkle);
  gl.deleteTexture(body.haloTexture);
  gl.deleteFramebuffer(body.haloFramebuffer);
}
