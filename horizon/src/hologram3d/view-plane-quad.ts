import { SPHERE_FRACTION } from 'hologram';
import { GLSL3, LinearFilter, Mesh, PlaneGeometry, RawShaderMaterial, Texture, Vector3 } from 'three';
import { HOLOGRAM_RADIUS_METRES } from './dimensions';
import { glslColour } from './fragment-glsl';
import { HALO_PAINTS } from './halo-union';
import { LAYER_BLENDING, setLayerFade } from './layer-blending';

/**
 * The side of the square the phone's drawing fills, about 3.7R.
 *
 * `drawHologram` puts a sphere of radius SPHERE_FRACTION × size in a size × size square, so the
 * square is R / SPHERE_FRACTION across. Taken from the drawing so the two cannot drift apart.
 */
export const VIEW_PLANE_SIDE_METRES = HOLOGRAM_RADIUS_METRES / SPHERE_FRACTION;

/**
 * How much of the room behind him his light hides, as a share of how bright it is.
 *
 * The phone draws him on black, where light and colour are the same thing. Passthrough is not
 * black: the compositor lays this layer over the camera view with source-over, so what the page
 * writes as alpha is how much of the room it blocks. Alpha of 0 would be pure added light — he
 * would wash out in a bright room; alpha of max(rgb) would be Screen against the room. Slightly
 * under that keeps the brightest strokes from punching opaque holes while the faint glow stays
 * glassy rather than smoky. To be tuned on a headset, in a bright room and a dim one.
 */
export const ALPHA_FROM_LIGHT = 0.85;

const VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;

out vec2 pictureCoordinate;
out vec2 haloCoordinate;

void main() {
  // An ImageBitmap is uploaded top row first whatever UNPACK_FLIP_Y says, so the top of the
  // picture is at v = 0 while the top of the quad is at v = 1. The halo target was rendered by
  // three, bottom row first, so it is the right way up as it is.
  pictureCoordinate = vec2(uv.x, 1.0 - uv.y);
  haloCoordinate = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D picture;
uniform sampler2D halo;
// The halo tiers' strengths (dim, mid, bright) times the voice's glow; all 0 with no halo pass.
uniform vec3 haloShares;
// How far CanvasKit has already faded the picture (the phone's arrival layer), undone here so
// the whole quad is faded once, by the blend (see layer-blending.ts).
uniform float pictureFade;
uniform float alphaFromLight;

in vec2 pictureCoordinate;
in vec2 haloCoordinate;

out vec4 colour;

const vec3 HALO = ${glslColour(HALO_PAINTS.colour)};

// What is left of the light behind once one tier's halo is Screened over it.
vec3 through(float covered, float share) {
  return vec3(1.0) - HALO * (share * covered);
}

void main() {
  // Raw encoded sRGB, exactly as Skia wrote it: the projection layer is treated as sRGB and
  // premultiplied, so blending these values matches what the phone's Screen blend does.
  vec3 light = min(vec3(1.0), texture(picture, pictureCoordinate).rgb / pictureFade);
  // The halo union's two groups, each tier Screened over the rest as the phone's paths are.
  vec3 pinned = texture(halo, vec2(haloCoordinate.x * 0.5, haloCoordinate.y)).rgb;
  vec3 turning = texture(halo, vec2(0.5 + haloCoordinate.x * 0.5, haloCoordinate.y)).rgb;
  vec3 left = through(pinned.r, haloShares.x) * through(pinned.g, haloShares.y) * through(pinned.b, haloShares.z)
    * through(turning.r, haloShares.x) * through(turning.g, haloShares.y) * through(turning.b, haloShares.z);
  vec3 glow = vec3(1.0) - left;
  light = light + glow - light * glow;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;

/** The flat hologram in the room: a square that always turns to face the viewer. */
export interface ViewPlaneQuad {
  mesh: Mesh<PlaneGeometry, RawShaderMaterial>;
  /** Shows `picture` from the next render on, and closes the one it replaces. */
  showPicture(picture: ImageBitmap): void;
  /**
   * Lays the halo union's coverage (`halo-union.ts`) under the picture, each tier at its strength
   * times `glowGain`; `null` for none.
   */
  showHalo(coverage: Texture | null, glowGain: number): void;
  /**
   * Fades everything the quad shows by `fade`, when the picture itself already carries
   * `pictureFade` of it — CanvasKit's arrival layer. Both 1 by default.
   */
  setFade(fade: number, pictureFade: number): void;
  /** Turns the square so its face points at `eye`, keeping it upright. */
  faceViewer(eye: Vector3): void;
  dispose(): void;
}

/**
 * A `side`-metre square that shows the phone's drawing as light over the room.
 *
 * Blended as Screen, like every layer of the phone's drawing, and faded as one layer with the
 * rest of him: see `layer-blending.ts`. Alpha is Screened the same way, so the layer's alpha stays
 * a union rather than a sum. Raw shaders, so three adds no colour management between Skia's bytes
 * and the display, and no depth write, so nothing drawn after him is hidden by the black around him.
 */
export function createViewPlaneQuad(side: number): ViewPlaneQuad {
  const texture = new Texture<ImageBitmap>();
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;

  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      picture: { value: texture },
      // Until there is a halo pass, three binds an empty texture here and the shares make it nothing.
      halo: { value: null },
      haloShares: { value: new Vector3() },
      pictureFade: { value: 1 },
      alphaFromLight: { value: ALPHA_FROM_LIGHT },
    },
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    ...LAYER_BLENDING,
  });
  setLayerFade(material, 1);

  const mesh = new Mesh(new PlaneGeometry(side, side), material);
  // Nothing to show until the first picture has been drawn.
  mesh.visible = false;
  let current: ImageBitmap | null = null;

  return {
    mesh,
    showPicture(picture) {
      // The one it replaces went to the GPU in the last render, so its pixels are no longer needed.
      current?.close();
      current = picture;
      texture.image = picture;
      texture.needsUpdate = true;
      mesh.visible = true;
    },
    showHalo(coverage, glowGain) {
      const { uniforms } = material;
      uniforms.halo.value = coverage;
      const shares = coverage === null ? 0 : glowGain;
      uniforms.haloShares.value.set(
        HALO_PAINTS.dim.strength * shares,
        HALO_PAINTS.mid.strength * shares,
        HALO_PAINTS.bright.strength * shares,
      );
    },
    setFade(fade, pictureFade) {
      setLayerFade(material, fade);
      // Never 0: a picture faded to nothing is not drawn at all (see jarvis-hologram-3d.ts).
      material.uniforms.pictureFade.value = Math.max(pictureFade, 1e-3);
    },
    faceViewer(eye) {
      // A plane faces +Z, and lookAt turns an object's +Z towards the target with the world's up kept up.
      mesh.lookAt(eye);
    },
    dispose() {
      current?.close();
      current = null;
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
