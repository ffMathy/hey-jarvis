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
import { MAX_SATELLITES, type SatelliteSpot } from '../satellites/agent-work';
import { STROKE_PAINTS, THINNEST_STROKE_PIXELS } from './body-strokes';
import { CORONA_RENDER_ORDER } from './corona';
import { glslColour, glslFloat } from './fragment-glsl';
import { HALO_PAINTS } from './halo-union';
import type { Vector3Like } from './view-basis';
import { ALPHA_FROM_LIGHT } from './view-plane-quad';

/**
 * The satellites round Jarvis, one for each of his agents a request is using
 * (`satellites/agent-work.ts` says where each is and how lit): a small glyph per agent — a sun for
 * the weather, a page for the calendar, a hexagon for the house — in his stroke colours, a hot dot at
 * its middle, a little of his halo round it, a ring flaring out from it on every tool it calls, and a
 * slow pulse while it waits on sir.
 *
 * Drawn as his coronas are (`corona.ts`): one instanced draw of quads turned to the centre eye in the
 * vertex shader, Screen in colour and alpha, raw encoded sRGB, alpha ALPHA_FROM_LIGHT × max(light),
 * no depth, and never smaller than MIN_APPARENT_RADIUS_DEGREES so one across the room still reads.
 * They are drawn after him and his coronas, and before the text panels.
 */

/** A glyph's radius, in metres: about a thumbnail, a fifth of his at rest. */
export const SATELLITE_RADIUS_METRES = 0.032;

/** The least angle a glyph's radius subtends at the eye. */
export const MIN_APPARENT_RADIUS_DEGREES = 0.55;

/** After his coronas, before the text panels at 10. */
export const SATELLITE_RENDER_ORDER = CORONA_RENDER_ORDER + 1;

/** How long the pulse of one waiting on sir takes. */
export const ASKING_PULSE_SECONDS = 1.6;

/** How far out the quad reaches, in glyph radii: room for the flare's ring. */
const QUAD_REACH = 1.9;

/** A glyph's radius at `distance` metres from the eye. */
export function satelliteRadiusAt(distance: number): number {
  return Math.max(SATELLITE_RADIUS_METRES, distance * Math.tan((MIN_APPARENT_RADIUS_DEGREES * Math.PI) / 180));
}

const VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 eye;

in vec2 corner;
in vec3 centre;
in float level;
in float flare;
in float glyph;
in float asking;

out vec2 local;
flat out float fade;
flat out float flareOut;
flat out float glyphOut;
flat out float askingOut;

const float RADIUS = ${glslFloat(SATELLITE_RADIUS_METRES)};
const float MIN_TANGENT = ${glslFloat(Math.tan((MIN_APPARENT_RADIUS_DEGREES * Math.PI) / 180))};
const float QUAD_REACH = ${glslFloat(QUAD_REACH)};

void main() {
  vec3 toEye = eye - centre;
  float distance = length(toEye);
  vec3 front = distance > 1e-5 ? toEye / distance : vec3(0.0, 0.0, 1.0);
  vec3 up = vec3(0.0, 1.0, 0.0) - front * front.y;
  up = length(up) > 1e-3 ? normalize(up) : normalize(cross(front, vec3(1.0, 0.0, 0.0)));
  vec3 right = cross(up, front);
  float radius = max(RADIUS, distance * MIN_TANGENT);
  // Out from 6 radii, gone inside 3: a satellite at the end of the nose is in the way, not news.
  float near = clamp((distance / radius - 3.0) / 3.0, 0.0, 1.0);
  fade = level * near * near * (3.0 - 2.0 * near);
  flareOut = flare;
  glyphOut = glyph;
  askingOut = asking;
  local = corner * QUAD_REACH;
  vec3 world = centre + (right * local.x + up * local.y) * radius;
  gl_Position = fade > 0.0 ? projectionMatrix * modelViewMatrix * vec4(world, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float time;
uniform float alphaFromLight;

in vec2 local;
flat in float fade;
flat in float flareOut;
flat in float glyphOut;
flat in float askingOut;

out vec4 colour;

const vec3 HALO = ${glslColour(HALO_PAINTS.colour)};
const vec3 DIM = ${glslColour(STROKE_PAINTS.dim.colour)};
const vec3 BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)};
const vec3 HOT = ${glslColour(STROKE_PAINTS.hot.colour)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};
const float ASKING_PULSE_SECONDS = ${glslFloat(ASKING_PULSE_SECONDS)};
const float TAU = 6.283185307179586;

// A glyph's stroke: its half-width, in glyph radii.
const float STROKE_HALF = 0.075;

float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

// A line halfWidth either side of offset 0, never thinner than THINNEST_PIXELS, dimmed when widened.
float line(float offset, float halfWidth, float pixel) {
  float drawn = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  return coverage(abs(offset) - drawn, pixel) * halfWidth / drawn;
}

vec3 screen(vec3 below, vec3 above) {
  return below + above - below * above;
}

float segment(vec2 point, vec2 from, vec2 to) {
  vec2 along = to - from;
  float share = clamp(dot(point - from, along) / dot(along, along), 0.0, 1.0);
  return length(point - from - along * share);
}

float box(vec2 point, vec2 halfSize) {
  vec2 outside = abs(point) - halfSize;
  return length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0);
}

float hexagon(vec2 point, float size) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  point = abs(point);
  point -= 2.0 * min(dot(k.xy, point), 0.0) * k.xy;
  point -= vec2(clamp(point.x, -k.z * size, k.z * size), size);
  return length(point) * sign(point.y);
}

float triangle(vec2 point, float size) {
  const float k = 1.7320508;
  point.y += size * 0.3;
  point.x = abs(point.x) - size;
  point.y = point.y + size / k;
  if (point.x + k * point.y > 0.0) point = vec2(point.x - k * point.y, -k * point.x - point.y) / 2.0;
  point.x -= clamp(point.x, -2.0 * size, 0.0);
  return -length(point) * sign(point.y);
}

// How far from the glyph's strokes this point is, for each agent's glyph.
float glyphDistance(vec2 point, int glyph) {
  if (glyph == 0) {
    // The weather: a sun, a ring with eight rays.
    float ring = abs(length(point) - 0.42);
    float angle = atan(point.y, point.x);
    float ray = mod(angle + TAU / 16.0, TAU / 8.0) - TAU / 16.0;
    vec2 polar = vec2(length(point), ray * length(point));
    float rays = segment(polar, vec2(0.66, 0.0), vec2(0.92, 0.0));
    return min(ring, rays);
  }
  if (glyph == 1) {
    // The calendar: a page with its binding along the top.
    float page = abs(box(point, vec2(0.62, 0.55)));
    float binding = segment(point, vec2(-0.62, 0.25), vec2(0.62, 0.25));
    return min(page, binding);
  }
  if (glyph == 2) {
    // Email: an envelope, its flap folded down to the middle.
    float envelope = abs(box(point, vec2(0.7, 0.48)));
    float flap = min(segment(point, vec2(-0.7, 0.48), vec2(0.0, 0.0)), segment(point, vec2(0.7, 0.48), vec2(0.0, 0.0)));
    return min(envelope, flap);
  }
  if (glyph == 3) return abs(hexagon(point, 0.62)); // The house.
  if (glyph == 4) return abs(triangle(point, 0.62)); // Shopping.
  if (glyph == 5) {
    // To-do: a tick.
    return min(segment(point, vec2(-0.6, 0.0), vec2(-0.15, -0.45)), segment(point, vec2(-0.15, -0.45), vec2(0.65, 0.5)));
  }
  if (glyph == 6) {
    // Coding: angle brackets.
    vec2 mirrored = vec2(abs(point.x), point.y);
    return min(segment(mirrored, vec2(0.25, 0.55), vec2(0.72, 0.0)), segment(mirrored, vec2(0.72, 0.0), vec2(0.25, -0.55)));
  }
  // Web research, and any agent not listed: a lens with its handle.
  return min(abs(length(point - vec2(-0.12, 0.12)) - 0.42), segment(point, vec2(0.18, -0.18), vec2(0.66, -0.66)));
}

void main() {
  float radius = length(local);
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float pulse = askingOut > 0.5 ? mix(0.55, 1.0, 0.5 + 0.5 * cos(TAU * time / ASKING_PULSE_SECONDS)) : 1.0;

  // A little of his halo round it, brighter as it flares.
  vec3 light = HALO * (0.22 * exp(-radius * radius * 1.6) * (1.0 + 1.5 * flareOut));

  // The glyph, lit up by a flare.
  float stroke = line(glyphDistance(local, int(glyphOut + 0.5)), STROKE_HALF, pixel);
  light = screen(light, mix(BRIGHT, HOT, flareOut) * stroke * pulse);

  // A hot dot at its middle, as at his.
  light = screen(light, HOT * coverage(radius - 0.1, pixel) * mix(0.6, 1.0, flareOut));

  // The flare: a ring going out from the glyph as a tool is called, fading as it goes.
  if (flareOut > 0.0) {
    float ringRadius = mix(1.75, 0.8, flareOut);
    light = screen(light, HOT * line(radius - ringRadius, 0.035, pixel) * flareOut);
  }

  light *= fade;
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest < 1.0 / 512.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;

export interface Satellites {
  /** Added to the scene as it is, untransformed: the positions are in the scene's own space. */
  readonly object: Mesh<InstancedBufferGeometry, RawShaderMaterial>;
  /** The satellites to draw from the next render on: the first MAX_SATELLITES. */
  set(spots: readonly SatelliteSpot[]): void;
  /** Once per frame before rendering: moves the pulse on and turns every glyph to face `centreEye`. */
  update(deltaSeconds: number, centreEye: Vector3Like): void;
  dispose(): void;
}

/** The satellites, as one instanced draw of up to MAX_SATELLITES view-facing quads. */
export function createSatellites(): Satellites {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('corner', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const centres = new InstancedBufferAttribute(new Float32Array(MAX_SATELLITES * 3), 3);
  const levels = new InstancedBufferAttribute(new Float32Array(MAX_SATELLITES), 1);
  const flares = new InstancedBufferAttribute(new Float32Array(MAX_SATELLITES), 1);
  const glyphs = new InstancedBufferAttribute(new Float32Array(MAX_SATELLITES), 1);
  const asking = new InstancedBufferAttribute(new Float32Array(MAX_SATELLITES), 1);
  for (const [name, attribute] of Object.entries({
    centre: centres,
    level: levels,
    flare: flares,
    glyph: glyphs,
    asking,
  })) {
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  geometry.instanceCount = 0;

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
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcColorFactor,
    blendEquationAlpha: AddEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = SATELLITE_RENDER_ORDER;
  mesh.visible = false;

  return {
    object: mesh,
    set(spots) {
      const count = Math.min(spots.length, MAX_SATELLITES);
      for (let index = 0; index < count; index++) {
        const spot = spots[index];
        if (spot === undefined) continue;
        centres.setXYZ(index, spot.position.x, spot.position.y, spot.position.z);
        levels.setX(index, Math.min(1, Math.max(0, spot.level)));
        flares.setX(index, Math.min(1, Math.max(0, spot.flare)));
        glyphs.setX(index, spot.glyph);
        asking.setX(index, spot.asking ? 1 : 0);
      }
      for (const attribute of [centres, levels, flares, glyphs, asking]) attribute.needsUpdate = true;
      geometry.instanceCount = count;
      mesh.visible = count > 0;
    },
    update(deltaSeconds, centreEye) {
      uniforms.time.value += deltaSeconds;
      uniforms.eye.value.set(centreEye.x, centreEye.y, centreEye.z);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
