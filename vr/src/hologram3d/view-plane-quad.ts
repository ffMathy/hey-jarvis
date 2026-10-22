import { HALO_LIGHT_GLSL, haloShares } from 'hologram/gpu';
import { GLSL3, LinearFilter, Mesh, PlaneGeometry, RawShaderMaterial, Texture, Vector3 } from 'three';
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
// How far CanvasKit has already faded the picture (the phone's arrival layer), undone here so
// the whole quad is faded once, by the blend (see layer-blending.ts).
uniform float pictureFade;
uniform float alphaFromLight;

in vec2 pictureCoordinate;
in vec2 haloCoordinate;

out vec4 colour;

${HALO_LIGHT_GLSL}

void main() {
  // Raw encoded sRGB, exactly as Skia wrote it: the projection layer is treated as sRGB and
  // premultiplied, so blending these values matches what the phone's Screen blend does.
  vec3 light = min(vec3(1.0), texture(picture, pictureCoordinate).rgb / pictureFade);
  vec3 glow = haloGlow(haloCoordinate);
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
  let current: ImageBitmap | null = null;
  const shares: [number, number, number] = [0, 0, 0];

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
      uniforms.haloShares.value.fromArray(haloShares(coverage === null ? 0 : glowGain, shares));
    },
    setFade(fade, pictureFade) {
      setLayerFade(material, fade);
      // Never 0: a picture faded to nothing is not drawn at all (see jarvis-hologram-3d.ts).
      material.uniforms.pictureFade.value = Math.max(pictureFade, 1e-3);
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
