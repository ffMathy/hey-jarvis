import {
  analyseFrame,
  BODY_STRIDE,
  createHologramScene,
  type HologramFrame,
  SCENE_SEED,
  STREAM_STRIDE,
} from 'hologram';
import {
  buildHologramRows,
  createFragmentUniforms,
  FRAGMENT_GLSL,
  type PlacedFragment,
  placeBodyFragment,
  placeStreamFragment,
  ROW_ATTRIBUTES,
  type Vector3Tuple,
  type ViewBasis,
  writeFragmentUniforms,
} from 'hologram/gpu';
import {
  BufferGeometry,
  FloatType,
  GLSL3,
  NearestFilter,
  OrthographicCamera,
  Points,
  RawShaderMaterial,
  RGBAFormat,
  Scene,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { createRowGeometry } from '../hologram3d/row-geometry';
import type { PortCheck } from './preview-hook';

/** Texels across the readback: every row gets one. */
const READBACK_WIDTH = 128;

const VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform float channel;
uniform float readbackWidth;
uniform float readbackHeight;

${FRAGMENT_GLSL}

flat out vec4 reading;

void main() {
  Fragment fragment = readFragment();
  if (channel < 0.5) {
    reading = vec4(fragment.centre, fragment.visible ? 1.0 + fragment.tier + 3.0 * fragment.group : 0.0);
  } else {
    reading = vec4(fragment.axis, fragment.visible ? fragment.glyph : -1.0);
  }
  // One texel per row, which all four of its corners land on with the same reading: each carries
  // the whole row.
  float row = float(gl_VertexID / 4);
  vec2 texel = vec2(mod(row, readbackWidth), floor(row / readbackWidth)) + 0.5;
  gl_Position = vec4(texel / vec2(readbackWidth, readbackHeight) * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
flat in vec4 reading;
out vec4 colour;
void main() {
  colour = reading;
}
`;

function distance(first: Vector3Tuple, second: ArrayLike<number>, offset: number) {
  return Math.hypot(first[0] - second[offset], first[1] - second[offset + 1], first[2] - second[offset + 2]);
}

/** What the CPU reference makes of every row, in the rows' order: the body's, then the stream's. */
function referenceRows(
  scene: ReturnType<typeof createHologramScene>,
  frame: HologramFrame,
  basis: ViewBasis,
  eyeDistance: number,
) {
  const state = analyseFrame(frame, 1, scene);
  const placed: (PlacedFragment | null)[] = [];
  for (let offset = 0; offset < scene.body.length; offset += BODY_STRIDE) {
    placed.push(placeBodyFragment(scene.body, offset, state, basis, eyeDistance));
  }
  for (let offset = 0; offset < scene.stream.length; offset += STREAM_STRIDE) {
    placed.push(placeStreamFragment(scene.stream, offset, state, basis, eyeDistance));
  }
  return { state, placed };
}

/**
 * Holds the GPU port to the CPU reference: runs `hologram/gpu`'s `fragment-glsl.ts` for every row,
 * reads what it placed back out of a float target, and compares it with what its `fragment-3d.ts`
 * places for the same frame and view. The browser tests call it through the preview's hook;
 * nothing in the app does.
 */
export function checkPort(
  renderer: WebGLRenderer,
  frame: HologramFrame,
  basis: ViewBasis,
  eyeDistance: number,
): PortCheck {
  const scene = createHologramScene(SCENE_SEED);
  const rows = buildHologramRows(scene);
  const height = Math.ceil(rows.count / READBACK_WIDTH);
  const target = new WebGLRenderTarget(READBACK_WIDTH, height, {
    type: FloatType,
    format: RGBAFormat,
    depthBuffer: false,
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  const uniforms = createFragmentUniforms();
  const { state, placed } = referenceRows(scene, frame, basis, eyeDistance);
  writeFragmentUniforms(uniforms, state, basis, 1, eyeDistance);
  const channel = { value: 0 };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      ...uniforms,
      channel,
      readbackWidth: { value: READBACK_WIDTH },
      readbackHeight: { value: height },
    },
    depthTest: false,
    depthWrite: false,
  });
  // The very attributes the strokes and the halo union read, every corner of every row a point.
  const rowGeometry = createRowGeometry(rows);
  const geometry = new BufferGeometry();
  for (const [name] of ROW_ATTRIBUTES) geometry.setAttribute(name, rowGeometry.getAttribute(name));
  geometry.setDrawRange(0, rows.count * 4);
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const readbackScene = new Scene();
  readbackScene.add(points);
  const camera = new OrthographicCamera();
  const readings: Float32Array[] = [];
  const previous = renderer.getRenderTarget();
  for (const which of [0, 1]) {
    channel.value = which;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(readbackScene, camera);
    const pixels = new Float32Array(READBACK_WIDTH * height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, READBACK_WIDTH, height, pixels);
    readings.push(pixels);
  }
  renderer.setRenderTarget(previous);
  target.dispose();
  material.dispose();
  // Lets go of the attributes' buffers; the row geometry they came from was never drawn itself.
  geometry.dispose();
  return compare(placed, readings[0], readings[1]);
}

function compare(placed: (PlacedFragment | null)[], centres: Float32Array, axes: Float32Array): PortCheck {
  const check: PortCheck = {
    rows: placed.length,
    drawnOnCpu: 0,
    drawnOnGpu: 0,
    drawnOnOne: 0,
    tierDiffers: 0,
    largestCentreError: 0,
    largestAxisError: 0,
  };
  placed.forEach((fragment, row) => {
    const offset = row * 4;
    const gpuDrawn = centres[offset + 3] > 0.5;
    if (fragment !== null) check.drawnOnCpu++;
    if (gpuDrawn) check.drawnOnGpu++;
    if ((fragment !== null) !== gpuDrawn) {
      check.drawnOnOne++;
      return;
    }
    if (fragment === null) return;
    if (Math.round(centres[offset + 3] - 1) !== fragment.tier + 3 * fragment.group) check.tierDiffers++;
    check.largestCentreError = Math.max(check.largestCentreError, distance(fragment.centre, centres, offset));
    check.largestAxisError = Math.max(check.largestAxisError, distance(fragment.axis, axes, offset));
  });
  return check;
}
