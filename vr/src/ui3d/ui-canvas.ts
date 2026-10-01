import {
  AddEquation,
  CanvasTexture,
  CustomBlending,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  type Texture,
} from 'three';

/**
 * Pictures drawn with a 2D canvas for the room — text panels, the drawer, the keyboard and wrist
 * buttons — and how they are put on a plane so their edges and their words stay smooth.
 *
 * Three things, each of which on its own left them jagged:
 *
 * - **Mipmaps, trilinear, anisotropic.** A panel is seen from anywhere between a hand's length and
 *   across the room, and the drawer is tilted back like a lectern. Sampled from its full-size
 *   canvas alone, a panel smaller on the display than its canvas skips texels, so strokes of a
 *   letter break up and shimmer as the head moves; mipmaps give every size a picture already
 *   averaged down to it, and anisotropic filtering keeps a tilted board sharp along its length
 *   instead of blurring it to the size of its foreshortened side.
 * - **A transparent margin round everything drawn.** A panel's rounded outline, and the border
 *   along it, are drawn a few pixels in from the canvas's edge, so what ends the panel is its
 *   picture's alpha, which filtering smooths, rather than the edge of its plane, which only the
 *   renderer's multisampling does. The margin is wide enough for the smaller mipmap levels to
 *   still have transparent texels round the outline.
 * - **Premultiplied alpha.** A canvas keeps its pixels premultiplied, and a transparent pixel has no
 *   colour left to keep. Unpremultiplied and filtered, an edge texel is averaged with the black of
 *   its transparent neighbour and the outline gets a dark fringe; uploaded premultiplied and
 *   blended as such, an edge texel is only less covered, never darker.
 *
 * The bytes are the canvas's own, encoded sRGB, with no colour management between them and the
 * display — as the hologram's layers are (`hologram3d/layer-blending.ts`), and as the page's own
 * colours (`ui-colours.ts`) are meant.
 */

/**
 * Canvas pixels per metre of what is drawn.
 *
 * A Quest 3 shows about 25 pixels per degree; a metre-wide panel a metre away spans some 53°, so
 * about 1300 display pixels. A little over that leaves room for the panel being nearer than a
 * metre, and for the texture filtering to have something to average. Text read from further away
 * than that is drawn from the mipmaps, a little further than the display alone would ask for (see
 * {@link TEXT_LOD_BIAS}).
 */
export const PIXELS_PER_METRE = 1500;

/**
 * Transparent pixels left round everything drawn into a canvas for the room.
 *
 * Eight at full size is still one at the fourth mipmap level, an eighth of the size, which is as
 * small as anything readable is ever shown.
 */
export const CANVAS_MARGIN_PIXELS = 8;

/**
 * How much sharper than the display alone would ask for the mipmaps are read, as a level of
 * detail: half a level.
 *
 * Trilinear filtering starts blending in the next, half-size level as soon as a canvas is shown
 * even a little smaller than it is drawn, which softens letters that are still perfectly legible.
 * Half a level keeps each canvas at its full size until it is shown at about 70 % of it — about
 * where sampling it alone would start to skip texels — and blends from there, so text is as sharp
 * as the full-size canvas wherever that is still safe, and averaged down only where it has to be.
 */
export const TEXT_LOD_BIAS = -0.5;

/** The canvas's 2D context, which every browser with WebXR has. */
export function drawingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser cannot draw text for the room.');
  return context;
}

/** Traces a rounded rectangle, by hand: `roundRect` is newer than some 2D contexts. */
export function roundedRectangle(
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) {
  const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(left + corner, top);
  context.arcTo(left + width, top, left + width, top + height, corner);
  context.arcTo(left + width, top + height, left, top + height, corner);
  context.arcTo(left, top + height, left, top, corner);
  context.arcTo(left, top, left + width, top, corner);
  context.closePath();
}

/** `pixels` of canvas, in metres of what it is drawn on. */
export function canvasMetres(pixels: number): number {
  return pixels / PIXELS_PER_METRE;
}

/** How many canvas pixels it takes to draw `metres` of it, whole. */
export function canvasPixels(metres: number): number {
  return Math.round(metres * PIXELS_PER_METRE);
}

/** How big a canvas has to be to hold a picture `content` pixels across and its margin either side. */
export function withMargin(content: number): number {
  return content + 2 * CANVAS_MARGIN_PIXELS;
}

/**
 * Sets `texture` up to be drawn as a canvas for the room: premultiplied, raw sRGB, mipmapped and
 * filtered trilinearly, with `anisotropy` — the renderer's most, `capabilities.getMaxAnisotropy()`,
 * which is 1 where the extension is missing.
 */
export function configureCanvasTexture<Picture extends Texture>(texture: Picture, anisotropy: number): Picture {
  texture.premultiplyAlpha = true;
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = Math.max(1, Math.floor(anisotropy));
  return texture;
}

/** A texture of `canvas` for the room, set up as {@link configureCanvasTexture} says. */
export function createCanvasTexture(canvas: HTMLCanvasElement, anisotropy: number): CanvasTexture {
  return configureCanvasTexture(new CanvasTexture(canvas), anisotropy);
}

/** Over whatever is behind, as a premultiplied picture is: its colour, plus what it leaves uncovered. */
export const PREMULTIPLIED_OVER = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: OneFactor,
  blendDst: OneMinusSrcAlphaFactor,
  blendEquationAlpha: AddEquation,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
} as const;

const VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 uv;

out vec2 canvasCoordinate;

void main() {
  canvasCoordinate = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform sampler2D picture;

in vec2 canvasCoordinate;

out vec4 colour;

void main() {
  // Premultiplied, raw sRGB bytes, handed on as they are: the blend is premultiplied too.
  colour = texture(picture, canvasCoordinate, ${TEXT_LOD_BIAS.toFixed(2)});
}
`;

/** The uniforms a canvas material reads; `picture` is replaced when a canvas changes size. */
export interface CanvasUniforms {
  [name: string]: { value: unknown };
  picture: { value: Texture | null };
}

/**
 * The material for a plane showing a canvas: the picture as it is, over whatever is behind it,
 * without depth — a panel is drawn after everything else and hidden by nothing — and read from its
 * mipmaps at {@link TEXT_LOD_BIAS}.
 */
export function createCanvasMaterial(texture: Texture | null): RawShaderMaterial & { uniforms: CanvasUniforms } {
  const uniforms: CanvasUniforms = { picture: { value: texture } };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    ...PREMULTIPLIED_OVER,
  });
  return Object.assign(material, { uniforms });
}
