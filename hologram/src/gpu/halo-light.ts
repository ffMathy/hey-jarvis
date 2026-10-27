import { glslColour } from './glsl';
import { HALO_PAINTS } from './halo-union';

/**
 * The halos' light: how the halo union's glow (`halo-union.ts`) becomes light, Screened.
 *
 * Each tier's halos are one layer of glow in HALO_PAINTS.colour at the tier's strength times the
 * voice's glow, Screened over what is there; Screen leaves `1 − paint` of the light behind, so a
 * tier whose glow at a pixel is `c` leaves `1 − colour × share × c` of it. The two groups' tiers are
 * separate layers, so all six are Screened over each other, and the light they make together is
 * one minus what all six leave.
 *
 * Shared by both renderers that show it: the headset's view-plane quad, which Screens it over the
 * picture of the rest of him, and the raw renderer (`gpu-body.ts`), which Screens it over the same
 * picture on a phone's or a watch's canvas.
 */

/**
 * GLSL for a fragment shader: the `halo` coverage and the tiers' `haloShares` (see haloShares), and
 * `haloGlow(coordinate)`, the light at `coordinate` of the drawing's square — 0 to 1 across, and
 * 0 to 1 up, which is how the union's target is laid out.
 */
export const HALO_LIGHT_GLSL = /* glsl */ `
uniform sampler2D halo;
// The halo tiers' strengths (dim, mid, bright) times the voice's glow; all 0 with no halo pass.
uniform vec3 haloShares;

const vec3 HALO = ${glslColour(HALO_PAINTS.colour)};

// What is left of the light behind once one tier's halo is Screened over it.
vec3 through(float covered, float share) {
  return vec3(1.0) - HALO * (share * covered);
}

// The halo union's two groups, each tier Screened over the rest.
vec3 haloGlow(vec2 coordinate) {
  vec3 pinned = texture(halo, vec2(coordinate.x * 0.5, coordinate.y)).rgb;
  vec3 turning = texture(halo, vec2(0.5 + coordinate.x * 0.5, coordinate.y)).rgb;
  vec3 left = through(pinned.r, haloShares.x) * through(pinned.g, haloShares.y) * through(pinned.b, haloShares.z)
    * through(turning.r, haloShares.x) * through(turning.g, haloShares.y) * through(turning.b, haloShares.z);
  return vec3(1.0) - left;
}
`;

/** The tiers' strengths this frame: `glowGain` is the frame's (`HologramFrameState.glowGain`). */
export function haloShares(glowGain: number, into: [number, number, number]): [number, number, number] {
  'worklet';
  into[0] = HALO_PAINTS.dim.strength * glowGain;
  into[1] = HALO_PAINTS.mid.strength * glowGain;
  into[2] = HALO_PAINTS.bright.strength * glowGain;
  return into;
}

/**
 * The raw renderer's halo light: the drawing's square, standing in the plane through his centre that
 * faces the eye — where the headset's view-plane quad stands — lit by `haloGlow` alone, as light
 * over transparent black. `halfSide` is half the square's side in the drawing's unit
 * (0.5 / his radius as a share of it); `viewRight` and `viewUp` are the fragment uniforms'.
 */
export const HALO_LIGHT_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 viewRight;
uniform vec3 viewUp;
uniform float halfSide;

in vec2 corner;

out vec2 haloCoordinate;

void main() {
  haloCoordinate = corner * 0.5 + 0.5;
  vec3 position = (corner.x * viewRight + corner.y * viewUp) * halfSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const HALO_LIGHT_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float alphaFromLight;

in vec2 haloCoordinate;

out vec4 colour;

${HALO_LIGHT_GLSL}

void main() {
  vec3 glow = haloGlow(haloCoordinate);
  colour = vec4(glow, alphaFromLight * max(glow.r, max(glow.g, glow.b)));
}
`;
