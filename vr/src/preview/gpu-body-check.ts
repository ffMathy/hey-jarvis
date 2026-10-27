import { analyseFrame, createHologramScene, SCENE_SEED } from 'hologram';
import {
  createGpuBody,
  drawGpuBody,
  type GpuBody,
  type GpuBodyCamera,
  STROKE_VERTEX_SHADER,
  type Vector3Tuple,
} from 'hologram/gpu';
import {
  DataTexture,
  Mesh,
  type PerspectiveCamera,
  RawShaderMaterial,
  Scene,
  Vector2,
  type WebGLRenderer,
} from 'three';
import type { JarvisHologram3D } from '../hologram3d';
import type { GpuBodyCheck } from './preview-hook';

/**
 * The raw renderer — `hologram/gpu`'s `createGpuBody` and `drawGpuBody`, which the phone and the
 * watch draw his body with and which know nothing of three.js — on a WebGL 2 context of its own.
 */
export interface RawBody {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  body: GpuBody;
}

/**
 * Makes the raw renderer's context with the attributes three asked the stage's for — alpha,
 * premultiplied, multisampled — so both draw into the same kind of drawing buffer, and uploads his
 * body to it. Made once a page: the context lives as long as the page, as a phone's would.
 */
export function createRawBody(renderer: WebGLRenderer): RawBody {
  const attributes = renderer.getContext().getContextAttributes();
  if (attributes === null) throw new Error("The stage's WebGL context has been lost.");
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', attributes);
  if (gl === null) throw new Error('There is no WebGL 2 context for the raw renderer.');
  return { canvas, gl, body: createGpuBody(gl, createHologramScene(SCENE_SEED)) };
}

/** One of his parts, found by its material, which is narrowed to the raw shader every part of him is drawn with. */
function partOf(hologram: JarvisHologram3D, description: string, isIt: (material: RawShaderMaterial) => boolean) {
  for (const child of hologram.object.children) {
    if (!(child instanceof Mesh)) continue;
    const { material } = child;
    if (material instanceof RawShaderMaterial && isIt(material)) return { mesh: child, material };
  }
  throw new Error(`He has no ${description} to compare.`);
}

function isVector3(value: unknown): value is Vector3Tuple {
  return Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number');
}

/** A number the strokes were drawn with. */
function numberUniform(material: RawShaderMaterial, name: string): number {
  const value: unknown = material.uniforms[name]?.value;
  if (typeof value !== 'number') throw new Error(`The strokes' ${name} is not a number.`);
  return value;
}

/** A vector the strokes were drawn with. */
function vectorUniform(material: RawShaderMaterial, name: string): Vector3Tuple {
  const value: unknown = material.uniforms[name]?.value;
  if (!isVector3(value)) throw new Error(`The strokes' ${name} is not a vector of three.`);
  return value;
}

/** The drawing buffer of `gl`'s canvas, bottom row first. */
function readDrawingBuffer(gl: WebGLRenderingContext | WebGL2RenderingContext, width: number, height: number) {
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

function compare(drawnByThree: Uint8Array, drawnRaw: Uint8Array, width: number, height: number): GpuBodyCheck {
  const check: GpuBodyCheck = {
    width,
    height,
    litPixels: 0,
    differingBytes: 0,
    differingPixels: 0,
    largestDifference: 0,
  };
  for (let offset = 0; offset < drawnByThree.length; offset += 4) {
    if (drawnByThree[offset] + drawnByThree[offset + 1] + drawnByThree[offset + 2] > 0) check.litPixels++;
    let differs = false;
    for (let channel = offset; channel < offset + 4; channel++) {
      const difference = Math.abs(drawnByThree[channel] - drawnRaw[channel]);
      if (difference === 0) continue;
      differs = true;
      check.differingBytes++;
      check.largestDifference = Math.max(check.largestDifference, difference);
    }
    if (differs) check.differingPixels++;
  }
  return check;
}

/**
 * Holds the raw renderer to the headset's three.js passes: draws `hologram`, already updated for
 * `camera`, with his picture on its view-plane quad blacked out — which leaves three's
 * halo union, strokes and halos' light, the body the phone and the watch draw on the GPU — then
 * draws the same moment with `drawGpuBody` from the matrices and uniforms three drew the strokes
 * with, into a drawing buffer the same size, and compares the two byte for byte.
 *
 * The phone's own camera (`placeFlatCamera`) is not what is held here: it works its matrices out
 * from the screen rather than from three's, so they differ in their last bits, and pixels would
 * differ by a level for reasons that are not the renderer's. What is held is everything after the
 * camera — the rows, the shaders, the passes, their order, their targets and their blending. The
 * browser tests call it through the preview's hook; nothing in the app does.
 */
export function checkGpuBody(
  renderer: WebGLRenderer,
  raw: RawBody,
  hologram: JarvisHologram3D,
  camera: PerspectiveCamera,
): GpuBodyCheck {
  const frame = hologram.frame;
  if (frame === null) throw new Error('He has not been drawn yet.');
  const strokes = partOf(hologram, 'strokes', (material) => material.vertexShader === STROKE_VERTEX_SHADER);
  const quad = partOf(hologram, 'view-plane quad', (material) => material.uniforms.picture !== undefined);
  const size = renderer.getDrawingBufferSize(new Vector2());
  const black = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  black.needsUpdate = true;
  const picture = quad.material.uniforms.picture;
  const shown: unknown = picture.value;
  const scene = new Scene();
  scene.add(hologram.object);
  picture.value = black;
  try {
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
  } finally {
    picture.value = shown;
    scene.remove(hologram.object);
    black.dispose();
  }
  const drawnByThree = readDrawingBuffer(renderer.getContext(), size.x, size.y);

  const { material } = strokes;
  const rawCamera: GpuBodyCamera = {
    basis: {
      right: vectorUniform(material, 'viewRight'),
      up: vectorUniform(material, 'viewUp'),
      front: vectorUniform(material, 'viewFront'),
    },
    eyeDistance: numberUniform(material, 'eyeDistance'),
    // What three handed the strokes' shader for this camera: its inverse times where the strokes stand.
    modelView: new Float32Array(strokes.mesh.modelViewMatrix.elements),
    projection: new Float32Array(camera.projectionMatrix.elements),
    unitLength: numberUniform(material, 'unitMetres'),
    width: size.x,
    height: size.y,
  };
  if (raw.canvas.width !== size.x || raw.canvas.height !== size.y) {
    raw.canvas.width = size.x;
    raw.canvas.height = size.y;
  }
  drawGpuBody(raw.gl, raw.body, {
    state: analyseFrame(frame, 1),
    density: numberUniform(material, 'density'),
    // Both of three's parts are faded by the same constant colour (see layer-blending.ts).
    fade: material.blendColor.r,
    alphaFromLight: numberUniform(material, 'alphaFromLight'),
    camera: rawCamera,
  });
  return compare(drawnByThree, readDrawingBuffer(raw.gl, size.x, size.y), size.x, size.y);
}
