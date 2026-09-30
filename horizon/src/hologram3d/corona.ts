import { PULSE_SECONDS, ROLL_DEGREES_PER_SECOND, SCAN_HALF_WIDTH, SCAN_SECONDS } from 'hologram';
import {
  AddEquation,
  BufferAttribute,
  CustomBlending,
  DynamicDrawUsage,
  GLSL3,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  RawShaderMaterial,
  Vector3,
} from 'three';
import { STROKE_PAINTS, THINNEST_STROKE_PIXELS } from './body-strokes';
import { glslColour, glslFloat } from './fragment-glsl';
import { HALO_PAINTS } from './halo-union';
import type { Vector3Like } from './view-basis';
import { ALPHA_FROM_LIGHT } from './view-plane-quad';

/**
 * Jarvis's light around an entity he is working on: a corona at a lamp, an inbox, a calendar sir
 * has placed in the room.
 *
 * It is his, not a marker's, so it is made of his parts and keeps his time: the halo's orange
 * (`HALO_PAINTS`), a thin rim in his brightest stroke's colour with a ring of ticks outside it rolling
 * the way his outer rim does, and his thinking scan — a level band sweeping up through the disc once
 * every SCAN_SECONDS, lighting the rim where it passes, and a ring blooming out from the middle for
 * PULSE_SECONDS as each pass finishes. Everything but that scan is quiet, as he is while he thinks.
 * The middle is left clear, so the real lamp is seen through it.
 *
 * One instanced draw of view-facing quads, one per corona, each turned to the centre eye in its
 * vertex shader so both eyes see the same ring. Blended as his layers are — Screen in colour, raw
 * encoded sRGB, alpha ALPHA_FROM_LIGHT × max(light) so it hides as much of the room as it lights —
 * but each corona fades by itself, multiplied into its light: the constant-colour fade his layers use
 * is one per material, and coronas rarely overlap, so the little brightening where two Screen over
 * each other does not matter. No depth test and no depth write: nothing in the room is drawn with
 * depth, and one behind a sofa should show through it rather than vanish.
 *
 * Never smaller than MIN_APPARENT_RADIUS_DEGREES across, so a lamp at the far end of a room still
 * reads, and its rim never thinner than his strokes' thinnest pixels. It fades out as the head comes
 * within 2.5 of its radii, as he does.
 */

/** The rim's radius, in metres: about a hand's width, round a lamp or a lampshade. */
export const CORONA_RADIUS_METRES = 0.13;

/** The least angle its rim's radius subtends at the eye, so far coronas still read. */
export const MIN_APPARENT_RADIUS_DEGREES = 1.5;

/**
 * How much faster its ticks roll than his rim: his turns once in 33 s, which on something a
 * hand's width across looks like standing still.
 */
export const CORONA_ROLL_SPEEDUP = 4;

/** The most coronas drawn at once; beyond that, the dimmest are left out. */
export const MAX_CORONAS = 32;

/** Drawn after him and before the text panels, which are at 10 and must never be covered. */
export const CORONA_RENDER_ORDER = 5;

/** How far out from the middle the quad reaches, in rim radii: room for the halo and the bloom. */
const QUAD_REACH = 1.7;

/** How far the scan band travels, in rim radii: from below the disc to above it, as his does. */
const SCAN_TRAVEL = 1.15;

/** Where the finishing bloom's ring starts, and how far out it goes, in rim radii: to past the rim. */
const BLOOM_START = 0.15;
const BLOOM_TRAVEL = 1.2;

/** The rim's radius at `distance` metres from the eye. */
export function coronaRadiusAt(distance: number): number {
  return Math.max(CORONA_RADIUS_METRES, distance * Math.tan((MIN_APPARENT_RADIUS_DEGREES * Math.PI) / 180));
}

/** Where the scan band is at `time`, in rim radii from the middle, up positive. */
export function scanHeightAt(time: number): number {
  const into = time - Math.floor(time / SCAN_SECONDS) * SCAN_SECONDS;
  return -SCAN_TRAVEL + (2 * SCAN_TRAVEL * into) / SCAN_SECONDS;
}

/** How far the finishing bloom has got at `time`, 0–1, or undefined outside it. */
export function pulseAt(time: number): number | undefined {
  const into = time - Math.floor(time / SCAN_SECONDS) * SCAN_SECONDS;
  const start = SCAN_SECONDS - PULSE_SECONDS;
  return into >= start ? (into - start) / PULSE_SECONDS : undefined;
}

/** How far out the finishing bloom's ring is at `time`, in rim radii, or undefined outside it. */
export function bloomRadiusAt(time: number): number | undefined {
  const bloom = pulseAt(time);
  return bloom === undefined ? undefined : BLOOM_START + BLOOM_TRAVEL * bloom;
}

const VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The centre eye, in the same space as the centres: both eyes turn each quad the same way.
uniform vec3 eye;

in vec2 corner;
in vec3 centre;
in float level;

// Where this corner is, in rim radii from the middle.
out vec2 local;
flat out float fade;

const float RADIUS = ${glslFloat(CORONA_RADIUS_METRES)};
const float MIN_TANGENT = ${glslFloat(Math.tan((MIN_APPARENT_RADIUS_DEGREES * Math.PI) / 180))};
const float QUAD_REACH = ${glslFloat(QUAD_REACH)};

void main() {
  vec3 toEye = eye - centre;
  float distance = length(toEye);
  vec3 front = distance > 1e-5 ? toEye / distance : vec3(0.0, 0.0, 1.0);
  // The world's up made square to the view, so the scan stays level; straight above or below, where
  // nothing of it is left, the reference space's x stands in.
  vec3 up = vec3(0.0, 1.0, 0.0) - front * front.y;
  up = length(up) > 1e-3 ? normalize(up) : normalize(cross(front, vec3(1.0, 0.0, 0.0)));
  vec3 right = cross(up, front);
  float radius = max(RADIUS, distance * MIN_TANGENT);
  // Out from 2.5 radii, gone inside 1.5, as he is (closeRangeFade in view-basis.ts).
  float near = clamp(distance / radius - 1.5, 0.0, 1.0);
  fade = level * near * near * (3.0 - 2.0 * near);
  local = corner * QUAD_REACH;
  vec3 world = centre + (right * local.x + up * local.y) * radius;
  // One faded to nothing goes past the far plane, so none of it is drawn.
  gl_Position = fade > 0.0 ? projectionMatrix * modelViewMatrix * vec4(world, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float time;
uniform float alphaFromLight;

in vec2 local;
flat in float fade;

out vec4 colour;

const vec3 HALO = ${glslColour(HALO_PAINTS.colour)};
const vec3 DIM = ${glslColour(STROKE_PAINTS.dim.colour)};
const vec3 BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)};
const vec3 HOT = ${glslColour(STROKE_PAINTS.hot.colour)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};
const float SCAN_SECONDS = ${glslFloat(SCAN_SECONDS)};
const float PULSE_SECONDS = ${glslFloat(PULSE_SECONDS)};
const float SCAN_HALF_WIDTH = ${glslFloat(SCAN_HALF_WIDTH)};
const float SCAN_TRAVEL = ${glslFloat(SCAN_TRAVEL)};
const float BLOOM_START = ${glslFloat(BLOOM_START)};
const float BLOOM_TRAVEL = ${glslFloat(BLOOM_TRAVEL)};
const float ROLL_RADIANS_PER_SECOND = ${glslFloat((ROLL_DEGREES_PER_SECOND * CORONA_ROLL_SPEEDUP * Math.PI) / 180)};
const float TAU = 6.283185307179586;

// The rim: its half-width, and how lit it is where the scan is nowhere near.
const float RIM_HALF = 0.02;
const float RIM_FLOOR = 0.5;
// The chips outside it, as on his outer rim: how many places for one, and how far out, in rim radii.
const float CHIPS = 28.0;
const float CHIP_MIDDLE = 1.14;
// The scan band's dashes: how long a place for one is, in rim radii, and how thick a dash is (half).
const float DASH_CELL = 0.14;
const float DASH_HALF_WIDTH = 0.012;
// The halo round the rim: how far it spreads and how strong it is at the rim.
const float HALO_SPREAD = 0.3;
const float HALO_STRENGTH = 0.36;

// Coverage of a shape at this distance from its edge, antialiased over one pixel.
float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

// A line halfWidth either side of where offset is 0, never drawn thinner than THINNEST_PIXELS and
// dimmed by as much when widened, so a far corona's rim carries the same light rather than breaking up.
float line(float offset, float halfWidth, float pixel) {
  float drawn = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  return coverage(abs(offset) - drawn, pixel) * halfWidth / drawn;
}

vec3 screen(vec3 below, vec3 above) {
  return below + above - below * above;
}

// A steady pseudo-random number in [0, 1) for a whole number: the same one on every frame.
float hash(float seed) {
  return fract(sin(seed * 12.9898) * 43758.5453);
}

// The chips on the outer ring, rolling clockwise as his outer rim does: uneven, with gaps, some short
// ticks and some blocks, like the fragments on his limb rather than a dial's even marks.
float chips(vec2 point, float radius, float pixel) {
  float turn = (atan(point.y, point.x) + time * ROLL_RADIANS_PER_SECOND) / TAU * CHIPS;
  // Wrapped, so the place on either side of atan's seam at ±π is the same place.
  float place = mod(floor(turn), CHIPS);
  float present = step(0.38, hash(place + 1.0));
  float halfArc = 0.5 * mix(0.1, 0.42, hash(place + 31.0)) * TAU * CHIP_MIDDLE / CHIPS;
  float halfLength = mix(0.022, 0.07, hash(place + 67.0));
  float middle = CHIP_MIDDLE + (hash(place + 97.0) - 0.5) * 0.04;
  float across = abs(fract(turn) - 0.5) * TAU * radius / CHIPS;
  return present * line(across, halfArc, pixel) * coverage(abs(radius - middle) - halfLength, pixel);
}

// The scan band's line across the disc, broken into dashes as his strokes are: a new pattern each
// pass, since each pass reads a new slice.
float dashes(vec2 point, float scan, float pass, float pixel) {
  float place = floor(point.x / DASH_CELL);
  float chance = hash(place + 211.0 + pass * 7.0);
  float halfLength = 0.5 * mix(0.35, 0.95, chance) * DASH_CELL;
  float along = abs(fract(point.x / DASH_CELL) - 0.5) * DASH_CELL;
  return step(0.18, chance) * coverage(along - halfLength, pixel) * line(point.y - scan, DASH_HALF_WIDTH, pixel);
}

void main() {
  float radius = length(local);
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float into = mod(time, SCAN_SECONDS);

  // The scan: a level band travelling up through the disc, as his thinking plane does.
  float scan = -SCAN_TRAVEL + 2.0 * SCAN_TRAVEL * into / SCAN_SECONDS;
  float nearness = clamp(1.0 - abs(local.y - scan) / SCAN_HALF_WIDTH, 0.0, 1.0);
  float lit = mix(RIM_FLOOR, 1.0, nearness * nearness);
  float inside = 1.0 - smoothstep(0.86, 0.98, radius);

  // The halo round the rim, brighter where the scan passes.
  // Squared by hand: GLSL leaves a negative number raised to a power undefined, and inside the rim
  // this is one.
  float fromRim = (radius - 1.0) / HALO_SPREAD;
  float haloShape = exp(-fromRim * fromRim);
  vec3 light = HALO * (HALO_STRENGTH * haloShape * mix(0.55, 1.0, nearness));

  // The rim, lit up where the scan crosses it.
  light = screen(light, BRIGHT * (line(radius - 1.0, RIM_HALF, pixel) * lit));

  // The chips, dim, and brighter where the scan passes them.
  light = screen(light, mix(DIM, BRIGHT, nearness) * (chips(local, radius, pixel) * mix(0.55, 1.0, nearness)));

  // The band itself across the disc: hot dashes with a glow either side, faded towards the rim.
  float band = dashes(local, scan, floor(time / SCAN_SECONDS), pixel);
  light = screen(light, HOT * (band * inside * 0.95));
  light = screen(light, HALO * (0.2 * nearness * nearness * inside));

  // The step finishing: a ring blooming out from the middle to past the rim, fading as it goes.
  float bloom = (into - (SCAN_SECONDS - PULSE_SECONDS)) / PULSE_SECONDS;
  if (bloom >= 0.0) {
    float bloomRadius = BLOOM_START + BLOOM_TRAVEL * bloom;
    float strength = 1.0 - bloom;
    light = screen(light, BRIGHT * (line(radius - bloomRadius, 0.016, pixel) * strength));
    float fromBloom = (radius - bloomRadius) / 0.12;
    light = screen(light, HALO * (0.3 * strength * exp(-fromBloom * fromBloom)));
  }

  light *= fade;
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest < 1.0 / 512.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;

/** One corona to draw: where, and how lit (0–1). */
export interface CoronaSpot {
  position: Vector3Like;
  level: number;
}

export interface Coronas {
  /** Added to the scene as it is, untransformed: the positions are in the scene's own space. */
  readonly object: Mesh<InstancedBufferGeometry, RawShaderMaterial>;
  /** The coronas to draw from the next render on: the first MAX_CORONAS, so brightest first. */
  set(spots: readonly CoronaSpot[]): void;
  /**
   * Once per frame before rendering: moves the rhythm on by `deltaSeconds` and turns every corona to
   * face `centreEye`, which comes from the frame's viewer pose (three's XR camera lags a frame).
   */
  update(deltaSeconds: number, centreEye: Vector3Like): void;
  /** Seconds on the rhythm's clock: set it to line the scan up with his, or to draw a still. */
  time: number;
  /** How much of the room its light hides, as a share of how bright it is; ALPHA_FROM_LIGHT by default. */
  alphaFactor: number;
  dispose(): void;
}

/** The coronas, as one instanced draw of up to MAX_CORONAS view-facing quads. */
export function createCoronas(): Coronas {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const centres = new InstancedBufferAttribute(new Float32Array(MAX_CORONAS * 3), 3);
  const levels = new InstancedBufferAttribute(new Float32Array(MAX_CORONAS), 1);
  centres.setUsage(DynamicDrawUsage);
  levels.setUsage(DynamicDrawUsage);
  geometry.setAttribute('centre', centres);
  geometry.setAttribute('level', levels);
  geometry.instanceCount = 0;

  // Kept by reference: three reads these very objects when it renders.
  const uniforms = {
    eye: { value: new Vector3() },
    time: { value: 0 },
    alphaFromLight: { value: ALPHA_FROM_LIGHT },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    premultipliedAlpha: true,
    // Screen, as every layer of his is: light + behind × (1 − light), and the same for alpha, so
    // what the coronas hide of the room is a union rather than a sum.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcColorFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });

  const mesh = new Mesh(geometry, material);
  // The quads are made in the vertex shader, wherever the centres are; the unit square three would
  // cull against says nothing about where they end up.
  mesh.frustumCulled = false;
  mesh.renderOrder = CORONA_RENDER_ORDER;
  mesh.visible = false;

  return {
    object: mesh,
    set(spots) {
      const count = Math.min(spots.length, MAX_CORONAS);
      for (let index = 0; index < count; index++) {
        const spot = spots[index];
        if (spot === undefined) continue;
        centres.setXYZ(index, spot.position.x, spot.position.y, spot.position.z);
        levels.setX(index, Math.min(1, Math.max(0, spot.level)));
      }
      centres.needsUpdate = true;
      levels.needsUpdate = true;
      geometry.instanceCount = count;
      mesh.visible = count > 0;
    },
    update(deltaSeconds, centreEye) {
      uniforms.time.value += deltaSeconds;
      uniforms.eye.value.set(centreEye.x, centreEye.y, centreEye.z);
    },
    get time() {
      return uniforms.time.value;
    },
    set time(seconds: number) {
      uniforms.time.value = seconds;
    },
    get alphaFactor() {
      return uniforms.alphaFromLight.value;
    },
    set alphaFactor(share: number) {
      uniforms.alphaFromLight.value = share;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
