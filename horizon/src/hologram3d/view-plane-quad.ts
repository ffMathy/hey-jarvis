import { SPHERE_FRACTION } from 'hologram';
import {
  AddEquation,
  CustomBlending,
  GLSL3,
  LinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  PlaneGeometry,
  RawShaderMaterial,
  Texture,
  type Vector3,
} from 'three';
import { HOLOGRAM_RADIUS_METRES } from './dimensions';

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

void main() {
  // An ImageBitmap is uploaded top row first whatever UNPACK_FLIP_Y says, so the top of the
  // picture is at v = 0 while the top of the quad is at v = 1.
  pictureCoordinate = vec2(uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D picture;
uniform float alphaFromLight;

in vec2 pictureCoordinate;

out vec4 colour;

void main() {
  // Raw encoded sRGB, exactly as Skia wrote it: the projection layer is treated as sRGB and
  // premultiplied, so blending these values matches what the phone's Screen blend does.
  vec3 light = texture(picture, pictureCoordinate).rgb;
  colour = vec4(light, alphaFromLight * max(light.r, max(light.g, light.b)));
}
`;

/** The flat hologram in the room: a square that always turns to face the viewer. */
export interface ViewPlaneQuad {
  mesh: Mesh<PlaneGeometry, RawShaderMaterial>;
  /** Shows `picture` from the next render on, and closes the one it replaces. */
  showPicture(picture: ImageBitmap): void;
  /** Turns the square so its face points at `eye`, keeping it upright. */
  faceViewer(eye: Vector3): void;
  dispose(): void;
}

/**
 * A `side`-metre square that shows the phone's drawing as light over the room.
 *
 * Blended as Screen, like every layer of the phone's drawing: result = picture + room ×
 * (1 − picture), per channel, which in GL is ONE, ONE_MINUS_SRC_COLOR. Alpha is Screened the
 * same way (ONE, ONE_MINUS_SRC_ALPHA) so the layer's alpha stays a union rather than a sum.
 * Raw shaders, so three adds no colour management between Skia's bytes and the display, and no
 * depth write, so nothing drawn after him is hidden by the black around him.
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
      alphaFromLight: { value: ALPHA_FROM_LIGHT },
    },
    transparent: true,
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
