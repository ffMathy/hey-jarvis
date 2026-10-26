import { HALO_LIGHT_GLSL, haloShares } from 'hologram/gpu';
import { GLSL3, Mesh, PlaneGeometry, RawShaderMaterial, type Texture, Vector3 } from 'three';
import { LAYER_BLENDING, setLayerFade } from './layer-blending';

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

// Both the picture and the halo union were drawn into targets, bottom row first, so each is the
// right way up in the quad's own coordinates.
out vec2 targetCoordinate;

void main() {
  targetCoordinate = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D picture;
uniform float alphaFromLight;

in vec2 targetCoordinate;

out vec4 colour;

${HALO_LIGHT_GLSL}

void main() {
  // Raw encoded sRGB, exactly as the picture wrote it, premultiplied light over transparent black:
  // the projection layer is treated as sRGB and premultiplied, so blending these values matches
  // what the phone's Screen blend does.
  vec3 light = texture(picture, targetCoordinate).rgb;
  vec3 glow = haloGlow(targetCoordinate);
  light = light + glow - light * glow;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;

/** The phone's picture of him in the room: a square that always turns to face the viewer. */
export interface ViewPlaneQuad {
  /** Hidden until he is first drawn; the hologram shows and hides it with the rest of him. */
  mesh: Mesh<PlaneGeometry, RawShaderMaterial>;
  /**
   * Lays the halo union's coverage (`halo-union.ts`) under the picture, each tier at its strength
   * times `glowGain`; `null` for none.
   */
  showHalo(coverage: Texture | null, glowGain: number): void;
  /** Fades everything the quad shows by `fade`, 1 by default: the picture is drawn unfaded. */
  setFade(fade: number): void;
  /** Lets go of the quad's own material and geometry; the picture is its target's. */
  dispose(): void;
}

/**
 * A `side`-metre square that shows `picture` (`picture-target.ts`) as light over the room.
 *
 * Blended as Screen, like every layer of the phone's drawing, and faded as one layer with the
 * rest of him: see `layer-blending.ts`. Alpha is Screened the same way, so the layer's alpha stays
 * a union rather than a sum. Raw shaders, so three adds no colour management between the picture's
 * bytes and the display, and no depth write, so nothing drawn after him is hidden by the black around him.
 */
export function createViewPlaneQuad(side: number, picture: Texture): ViewPlaneQuad {
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      picture: { value: picture },
      // Until there is a halo pass, three binds an empty texture here and the shares make it nothing.
      halo: { value: null },
      haloShares: { value: new Vector3() },
      alphaFromLight: { value: ALPHA_FROM_LIGHT },
    },
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    ...LAYER_BLENDING,
  });
  setLayerFade(material, 1);

  // The whole square, although the phone's drawing lights nothing past about 1.86R of his centre
  // and the square reaches 1.85R along its middles and 2.6R into its corners. The halos are
  // Screened in here too, drawn where the centre eye sees each fragment, and perspective carries
  // the near ones further: while he talked they reached 1.92R at 1.6 m, 2.15R at 0.6 m and the
  // corners at 0.4 m, so a quad cut to a fixed circle would clip them. Cutting the corners without
  // changing a pixel would take a polygon resized every frame for how near the eye is, for about an
  // eighth of this quad's fill at 1.6 m and next to nothing inside half a metre.
  const mesh = new Mesh(new PlaneGeometry(side, side), material);
  // Nothing to show until the first picture has been drawn.
  mesh.visible = false;
  const shares: [number, number, number] = [0, 0, 0];

  return {
    mesh,
    showHalo(coverage, glowGain) {
      const { uniforms } = material;
      uniforms.halo.value = coverage;
      uniforms.haloShares.value.fromArray(haloShares(coverage === null ? 0 : glowGain, shares));
    },
    setFade(fade) {
      setLayerFade(material, fade);
    },
    dispose() {
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
