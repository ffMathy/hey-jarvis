import { DoubleSide, GLSL3, type InstancedBufferGeometry, Mesh, RawShaderMaterial, type Texture, Vector4 } from 'three';
import { FRAGMENT_GLSL, type FragmentUniforms, GLYPH_GLSL, glslColour, glslFloat } from './fragment-glsl';
import { LAYER_BLENDING, setLayerFade } from './layer-blending';
import { createRowGeometry, type RowAttributes } from './row-geometry';
import { SPARKLE_REPEAT } from './sparkle-texture';
import { ALPHA_FROM_LIGHT } from './view-plane-quad';

/**
 * The body's strokes, each where its fragment really is in the room.
 *
 * The tiers' paints are the drawing's, from `hologram/src/hologram-drawing.ts`: the colours from
 * `createHologramResources` (bodyDimStroke, bodyMidStroke, bodyBrightStroke, bodyHotStroke, about
 * line 1675) and the widths and alphas `drawBody` and `drawBodyHighlights` set inline (about lines
 * 2569–2602). Widths are full widths in the drawing's unit; the shaders use halves.
 */
export const STROKE_PAINTS = {
  dim: { colour: 0xcc6e2c, width: 0.014, alpha: 0.62 },
  mid: { colour: 0xf87026, width: 0.0155, alpha: 0.85 },
  /** Its alpha is 1 − 0.25 × agitation. */
  bright: { colour: 0xff7e28, width: 0.0165, alpha: 1 },
  /** Round-capped, on the bright strokes only; its alpha is 0.8 × (1 − 0.95 × agitation). */
  hot: { colour: 0xff8e3c, width: 0.007, alpha: 0.8 },
};

/**
 * The narrowest a stroke is drawn, in pixels. A thinner one is drawn this wide and dimmed by as
 * much, so it carries the same light rather than breaking up into dots between pixels — the hot
 * cores are 0.007R, a pixel and a half at conversational distance on a Quest 3.
 */
export const THINNEST_STROKE_PIXELS = 1.2;

const VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
// The height of the viewport being drawn, in pixels, and how many metres the drawing's unit is.
uniform float viewportHeight;
uniform float unitMetres;

in vec2 corner;

${FRAGMENT_GLSL}
${GLYPH_GLSL}

// Where this corner is in the glyph's own frame — along it, across it — in the drawing's unit.
out vec2 local;
// Where it is in the view plane before the inner layer's turn, which is where the sparkle is read.
out vec2 sparklePoint;
// The glyph, its half-length, its normal's length and its tier.
flat out vec4 glyphShape;

const float WIDEST_HALF_STROKE = ${glslFloat(STROKE_PAINTS.bright.width / 2)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};

void main() {
  Fragment fragment = readFragment();
  if (!fragment.visible) {
    // Past the far plane, so nothing of it is drawn.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float halfLength = length(fragment.axis);
  vec3 along = halfLength > 1e-7 ? fragment.axis / halfLength : viewRight;
  // Square to the stroke in the view plane, on the side the drawing's glyphs put their ticks.
  vec3 across = normalize(cross(along, viewFront));
  float normalLength = length(fragment.normal);
  vec2 reach = glyphReach(fragment.glyph, halfLength, normalLength);

  // How big a pixel is where the fragment is, in the drawing's unit, so the quad is wide enough for
  // the stroke however far away it is, with room for its antialiased edge.
  vec4 clipCentre = projectionMatrix * modelViewMatrix * vec4(fragment.centre, 1.0);
  float pixel = 2.0 * abs(clipCentre.w) / (projectionMatrix[1][1] * viewportHeight * unitMetres);
  float margin = max(WIDEST_HALF_STROKE, 0.5 * THINNEST_PIXELS * pixel) + 1.5 * pixel;
  local = corner * (reach + margin);

  float planeLength = length(fragment.planeAxis);
  vec2 planeAlong = planeLength > 1e-7 ? fragment.planeAxis / planeLength : vec2(1.0, 0.0);
  sparklePoint = fragment.plane + planeAlong * local.x + vec2(-planeAlong.y, planeAlong.x) * local.y;
  glyphShape = vec4(fragment.glyph, halfLength, normalLength, fragment.tier);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(fragment.centre + along * local.x + across * local.y, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform sampler2D sparkle;
uniform float agitation;
// How much of the room behind his light hides; the fades are the blend's (see layer-blending.ts).
uniform float alphaFromLight;

in vec2 local;
in vec2 sparklePoint;
flat in vec4 glyphShape;

out vec4 colour;

${GLYPH_GLSL}

const vec3 DIM = ${glslColour(STROKE_PAINTS.dim.colour)};
const vec3 MID = ${glslColour(STROKE_PAINTS.mid.colour)};
const vec3 BRIGHT = ${glslColour(STROKE_PAINTS.bright.colour)};
const vec3 HOT = ${glslColour(STROKE_PAINTS.hot.colour)};
const float THINNEST_PIXELS = ${glslFloat(THINNEST_STROKE_PIXELS)};
const float SPARKLE_REPEAT = ${glslFloat(SPARKLE_REPEAT)};

// Coverage of a shape at this distance from its edge, antialiased over one pixel.
float coverage(float edgeDistance, float pixel) {
  return clamp(0.5 - edgeDistance / pixel, 0.0, 1.0);
}

void main() {
  float glyph = glyphShape.x;
  float halfLength = glyphShape.y;
  float normalLength = glyphShape.z;
  float tier = glyphShape.w;
  float pixel = max(length(fwidth(local)) * 0.70710678, 1e-6);
  float sparkleLevel = texture(sparkle, sparklePoint / SPARKLE_REPEAT).r;

  vec3 paint = DIM;
  float halfWidth = ${glslFloat(STROKE_PAINTS.dim.width / 2)};
  float strength = ${glslFloat(STROKE_PAINTS.dim.alpha)};
  if (tier > 1.5) {
    paint = BRIGHT * sparkleLevel;
    halfWidth = ${glslFloat(STROKE_PAINTS.bright.width / 2)};
    strength = 1.0 - 0.25 * agitation;
  } else if (tier > 0.5) {
    paint = MID * sparkleLevel;
    halfWidth = ${glslFloat(STROKE_PAINTS.mid.width / 2)};
    strength = ${glslFloat(STROKE_PAINTS.mid.alpha)};
  }
  float drawnHalf = max(halfWidth, 0.5 * THINNEST_PIXELS * pixel);
  strength *= halfWidth / drawnHalf;
  vec3 light = paint * strength * coverage(glyphStrokeDistance(local, glyph, halfLength, normalLength, drawnHalf), pixel);

  if (tier > 1.5) {
    float hotHalf = ${glslFloat(STROKE_PAINTS.hot.width / 2)};
    float drawnHot = max(hotHalf, 0.5 * THINNEST_PIXELS * pixel);
    float hotStrength = ${glslFloat(STROKE_PAINTS.hot.alpha)} * (1.0 - 0.95 * agitation) * hotHalf / drawnHot;
    float hotDistance = glyphLineDistance(local, glyph, halfLength, normalLength) - drawnHot;
    vec3 hot = HOT * sparkleLevel * hotStrength * coverage(hotDistance, pixel);
    // Screen, as the phone lays the hot core over the bright stroke.
    light = light + hot - light * hot;
  }
  float brightest = max(light.r, max(light.g, light.b));
  if (brightest <= 0.0) discard;
  colour = vec4(light, alphaFromLight * brightest);
}
`;

/** The uniforms the strokes read beyond the fragment arithmetic's. */
export interface StrokeUniforms {
  viewportHeight: { value: number };
  unitMetres: { value: number };
  sparkle: { value: Texture };
  alphaFromLight: { value: number };
}

export interface BodyStrokes {
  mesh: Mesh<InstancedBufferGeometry, RawShaderMaterial>;
  uniforms: StrokeUniforms;
  dispose(): void;
}

/**
 * The strokes as one instanced draw, Screen-blended over the room and faded as one layer with the
 * rest of him (see `layer-blending.ts`), writing alpha as a share of the light (see
 * ALPHA_FROM_LIGHT), with no depth written.
 *
 * Unlike the phone, strokes of one tier that cross add up rather than forming a union — the phone
 * strokes each tier as one path. They are thin and seldom cross, which is why the halos, which
 * overlap everywhere, get a union pass of their own and these do not.
 */
export function createBodyStrokes(
  attributes: RowAttributes,
  fragmentUniforms: FragmentUniforms,
  sparkle: Texture,
): BodyStrokes {
  const uniforms: StrokeUniforms = {
    viewportHeight: { value: 1 },
    unitMetres: { value: 1 },
    sparkle: { value: sparkle },
    alphaFromLight: { value: ALPHA_FROM_LIGHT },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: { ...fragmentUniforms, ...uniforms },
    // Either way round: a glyph's quad is laid along the stroke and its normal, which winds it
    // clockwise as often as not.
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    ...LAYER_BLENDING,
  });
  setLayerFade(material, 1);
  const mesh = new Mesh(createRowGeometry(attributes), material);
  // The quad's corners are only moved into place by the shader, so three's bounds say nothing.
  mesh.frustumCulled = false;
  const viewport = new Vector4();
  mesh.onBeforeRender = (renderer) => {
    // Once per eye in a headset, each with its own viewport.
    uniforms.viewportHeight.value = Math.max(1, renderer.getCurrentViewport(viewport).w);
  };
  return {
    mesh,
    uniforms,
    dispose() {
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
