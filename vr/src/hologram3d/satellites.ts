import { ASKING_PULSE_SECONDS, MAX_SATELLITES } from 'hologram';
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
import type { SatelliteSpot } from '../satellites/satellite-spots';
import { STROKE_PAINTS, THINNEST_STROKE_PIXELS } from './body-strokes';
import { CORONA_RENDER_ORDER } from './corona';
import { glslColour, glslFloat } from './fragment-glsl';
import { createGlyphAtlas, GLYPH_ATLAS_REACH, type GlyphAtlas } from './glyph-atlas';
import { HALO_PAINTS } from './halo-union';
import type { Vector3Like } from './view-basis';
import { ALPHA_FROM_LIGHT } from './view-plane-quad';

/**
 * The satellites round Jarvis, one for each of his agents a request is using
 * (`satellites/satellite-spots.ts` says where each is and how lit, from `hologram`'s
 * `agent-work.ts`): a small glyph per agent — the SVG path its vertical on the server declares, drawn
 * into a texture (`glyph-atlas.ts`) and tinted here in his stroke colours — a hot dot at its middle, a
 * little of his halo round it, a ring flaring out from it on every tool it calls, and a slow pulse
 * while it waits on sir.
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
// The glyphs, one slot each, side by side: see glyph-atlas.ts.
uniform sampler2D glyphs;

in vec2 local;
flat in float fade;
flat in float flareOut;
flat in float glyphOut;
flat in float askingOut;

out vec4 colour;

const vec3 HALO = ${glslColour(HALO_PAINTS.colour)};
const vec3 BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)};
const vec3 HOT = ${glslColour(STROKE_PAINTS.hot.colour)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};
const float ASKING_PULSE_SECONDS = ${glslFloat(ASKING_PULSE_SECONDS)};
const float TAU = 6.283185307179586;

const float GLYPH_SLOTS = ${glslFloat(MAX_SATELLITES)};
const float GLYPH_ATLAS_REACH = ${glslFloat(GLYPH_ATLAS_REACH)};

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

// How much of the glyph in an atlas slot covers this point, in glyph radii from its middle, y up.
float glyphCoverage(vec2 point, float slot) {
  vec2 inSlot = 0.5 + point / (2.0 * GLYPH_ATLAS_REACH);
  if (any(lessThan(inSlot, vec2(0.0))) || any(greaterThan(inSlot, vec2(1.0)))) return 0.0;
  return texture(glyphs, vec2((slot + inSlot.x) / GLYPH_SLOTS, inSlot.y)).a;
}

void main() {
  float radius = length(local);
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float pulse = askingOut > 0.5 ? mix(0.55, 1.0, 0.5 + 0.5 * cos(TAU * time / ASKING_PULSE_SECONDS)) : 1.0;

  // A little of his halo round it, brighter as it flares.
  vec3 light = HALO * (0.22 * exp(-radius * radius * 1.6) * (1.0 + 1.5 * flareOut));

  // The glyph, lit up by a flare.
  float stroke = glyphCoverage(local, floor(glyphOut + 0.5));
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
export function createSatellites(atlas: GlyphAtlas = createGlyphAtlas()): Satellites {
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
    glyphs: { value: atlas.texture },
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
      const slots = atlas.slotsFor(spots.slice(0, count).map((spot) => spot.glyph));
      for (let index = 0; index < count; index++) {
        const spot = spots[index];
        if (spot === undefined) continue;
        centres.setXYZ(index, spot.position.x, spot.position.y, spot.position.z);
        levels.setX(index, Math.min(1, Math.max(0, spot.level)));
        flares.setX(index, Math.min(1, Math.max(0, spot.flare)));
        glyphs.setX(index, slots[index] ?? 0);
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
      atlas.dispose();
    },
  };
}
