import { PLAIN_RING_GLYPH, type SatelliteOrbit } from '../agent-work';
import {
  AURA_INNER,
  AURA_OUTER,
  CHIP_GONE_SECONDS,
  CORE_RING_RADIUS,
  CORE_X,
  CORE_Y,
  type HologramFrameState,
  type HologramPictureScene,
  SPARKLE_TEXTURE_TEXELS,
  SPHERE_FRACTION,
  staticPathsOf,
} from '../hologram-drawing';
import { GLYPH_STROKE_WIDTH, screenSatellite } from '../satellite-drawing';
import {
  ARRAY_BUFFER,
  arrayBuffer,
  BLEND,
  CLAMP_TO_EDGE,
  carried,
  DEPTH_BUFFER_BIT,
  DEPTH_TEST,
  DYNAMIC_DRAW,
  ELEMENT_ARRAY_BUFFER,
  EQUAL,
  FLOAT,
  FUNC_ADD,
  type HologramGl,
  KEEP,
  LESS,
  type LinkedProgram,
  link,
  NOTEQUAL,
  ONE,
  ONE_MINUS_SRC_ALPHA,
  ONE_MINUS_SRC_COLOR,
  REPEAT,
  REPLACE,
  RGBA,
  RGBA8,
  STENCIL_BUFFER_BIT,
  STENCIL_TEST,
  TEXTURE_2D,
  TEXTURE0,
  TRIANGLES,
  texture,
  UNSIGNED_BYTE,
  UNSIGNED_SHORT,
} from './gl-objects';
import { GRADIENT_ROWS, GRADIENT_TEXELS, PICTURE_FRAGMENT_SHADER, PICTURE_PAINTS, pathDepthOf } from './picture-glsl';
import { flattenGlyph, GLYPH_RUN_NUMBERS } from './picture-glyphs';
import { GRADIENTS, pictureGradientPixels } from './picture-gradients';
import {
  ARC_PIECES,
  arcLayer,
  type CHIP_PARTS,
  cageLayer,
  chipsLayer,
  discLayer,
  embersLayer,
  frayLayer,
  type PictureLayerSource,
  SEGMENTS_VERTEX_SHADER,
  type ShapeRange,
  type StaticPathName,
  staticSegmentsLayer,
} from './picture-layers';
import { sceneSparklePixels } from './sparkle';

/**
 * Everything of him but his body on the GPU, over a bare WebGL 2 context: the picture the body is
 * drawn over, after the film's J.A.R.V.I.S. as Vision Quest shows him close up, in Age of Ultron's
 * colours and with its ringed eye.
 *
 * Drawn layer by layer: the aura round him, the core — its glowing disc, the ringed eye and faint
 * bar across it and the white-hot ring round it — the cage of hairlines turning with his body, the
 * embers drifting off him, and while he talks the fray and the chips; the thinking pulse; and the satellites over him. Each layer is a few draws, each with
 * one paint and one width, from the layers in `picture-layers.ts`, whose vertex shaders work out
 * where everything is this frame. So a frame's JavaScript is a couple of dozen draws' uniforms, and
 * nothing it does grows with what is drawn.
 *
 * **Every paint is Screen**: premultiplied light, blended `ONE, ONE_MINUS_SRC_COLOR` (alpha `ONE,
 * ONE_MINUS_SRC_ALPHA`), which is Screen with the paint's coverage folded in exactly as Skia's
 * antialiasing folded it, when Skia drew this picture.
 *
 * **A path is one coverage, as Skia's is.** Skia strokes a path once, so where its runs overlap —
 * a polyline's joins, two edges of the cage crossing — the overlap is not lit twice. Here a path is
 * several shapes, so each path's draws take a stencil value of their own and paint only pixels that
 * path has not painted yet: the stencil test is `NOTEQUAL` its value, and a pixel painted is set to
 * it. The values count up from 1 each frame, the stencil cleared to 0 with the colour and again if a
 * frame ever ran past 255 paths, so the canvas needs a stencil buffer.
 *
 * **And where its shapes overlap, the one that lights a pixel most is the one painted.** The first
 * to reach a pixel would otherwise take it, and the faint antialiased edge of one stroke, reaching a
 * pixel before the stroke lying over it, left a dark seam inside the stroke. So each draw is made
 * twice (`drawShapes`): into the depth buffer alone, each fragment nearer the more it covers, and
 * then in colour where the depth is equal, which is the fragment that covered most; the stencil
 * still stops a tie painting twice. Each path draws in a band of depths nearer than every earlier
 * path's, so the depth buffer, cleared to 1 with the colour, needs clearing only with the stencil,
 * and the canvas needs a depth buffer as well. expo-gl's on Android asks for 16 bits, which leaves
 * each path's band 256 steps of coverage.
 *
 * Like the body (`gpu-body.ts`), it is made on the JS thread (`createGpuPicture`), as plain data a
 * worklet can carry, and drawn by a worklet (`drawGpuPicture`) on whichever thread holds the
 * context, into whatever framebuffer is bound: the caller binds, sizes and clears it — colour,
 * depth and stencil — and the body draws after it.
 */

/** A layer as it is drawn: its program, its vertex array, and how many shapes it has. */
interface PictureLayer {
  program: LinkedProgram;
  array: WebGLVertexArrayObject;
  shapes: number;
}

/** How many satellites have a glyph at once, and the most runs one glyph is drawn in. */
const GLYPH_SLOTS = 8;
const GLYPH_RUNS = 160;

/**
 * Age of Ultron's colours, which the user asked for over Vision Quest's paler gold ("too yellow — I
 * liked the old reddish tint"). Measured on its close-ups: a weighted hue of 26°, saturation 0.59,
 * R:G:B 1:0.69:0.43, its hottest pixels (253,223,193), its 90th percentile (224,170,107), its median
 * (160,98,54). Vision Quest's disc is paler (hue 33°, median (218,163,96)). White-hot here is an
 * orange-white, still the palest paint in him so the core's ring stays the hottest thing; then pale
 * orange and orange through the light, a deeper orange, and a red-orange glow round it.
 */
const WHITE_HOT = 0xffe2c4;
const PALE_ORANGE = 0xffbc80;
const ORANGE = 0xff9a46;
const DEEP_ORANGE = 0xec7432;
const GLOW = 0xd65a22;

/** What `createGpuPicture` makes, as plain data, so a worklet can carry it (see `GpuBody`). */
export interface GpuPicture {
  segments: PictureLayer;
  glyphs: PictureLayer;
  arc: PictureLayer;
  disc: PictureLayer;
  cage: PictureLayer;
  embers: PictureLayer;
  fray: PictureLayer;
  chips: PictureLayer;
  paths: Record<StaticPathName, ShapeRange>;
  chipParts: Record<(typeof CHIP_PARTS)[number], ShapeRange>;
  sparkle: WebGLTexture;
  gradients: WebGLTexture;
  /** The glyphs' runs, written as the satellites change, and the glyph each slot holds now. */
  glyphEnds: WebGLBuffer;
  glyphJoins: WebGLBuffer;
  glyphSlots: string[];
  glyphRuns: number[];
  /** Scratch for a frame: the transform's matrix, and the stencil value of the path being drawn. */
  matrix: Float32Array;
  stencil: number[];
}

/** The uniforms every layer reads. */
const SHARED_UNIFORMS = [
  'toSquare',
  'localPerPixel',
  'paintColour',
  'paintKind',
  'sparkle',
  'gradients',
  'gradient',
  'pathDepth',
];

/** Every shape's four corners, and the two triangles each is drawn as. */
function quadsOf(shapes: number) {
  if (shapes * 4 > 65535) throw new Error('A layer of the picture has more shapes than a 16-bit index can draw.');
  const corners = new Float32Array(shapes * 8);
  const index = new Uint16Array(shapes * 6);
  for (let shape = 0; shape < shapes; shape++) {
    corners.set([-1, -1, 1, -1, 1, 1, -1, 1], shape * 8);
    index.set(
      [0, 1, 2, 0, 2, 3].map((corner) => shape * 4 + corner),
      shape * 6,
    );
  }
  return { corners, index };
}

/** A per-shape attribute uploaded once a corner, so every corner of a shape carries its numbers. */
function spreadOverCorners(gl: HologramGl, shapes: number, size: number, values: number[]): WebGLBuffer {
  const spread = new Float32Array(shapes * 4 * size);
  for (let shape = 0; shape < shapes; shape++) {
    const row = values.slice(shape * size, (shape + 1) * size);
    for (let corner = 0; corner < 4; corner++) spread.set(row, (shape * 4 + corner) * size);
  }
  return arrayBuffer(gl, ARRAY_BUFFER, spread);
}

/**
 * A layer's quads: four corners a shape, each carrying the shape's numbers, and two triangles a
 * shape. `buffers` stands in for the source's attributes where a frame writes them itself.
 */
function layerOf(gl: HologramGl, source: PictureLayerSource, buffers?: [string, WebGLBuffer, number][]): PictureLayer {
  const program = link(gl, source.vertexShader, PICTURE_FRAGMENT_SHADER, [...SHARED_UNIFORMS, ...source.uniforms]);
  const { corners, index } = quadsOf(source.shapes);
  const attributes: [string, WebGLBuffer, number][] =
    buffers ??
    source.attributes.map(({ name, size, values }) => [name, spreadOverCorners(gl, source.shapes, size, values), size]);
  attributes.push(['corner', arrayBuffer(gl, ARRAY_BUFFER, corners), 2]);
  const made = gl.createVertexArray();
  if (made === null) throw new Error('The picture could not make a vertex array.');
  gl.bindVertexArray(made);
  for (const [name, buffer, size] of attributes) {
    const location = gl.getAttribLocation(program.program, name);
    if (location < 0) continue;
    gl.bindBuffer(ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, FLOAT, false, 0, 0);
  }
  gl.bindBuffer(ELEMENT_ARRAY_BUFFER, arrayBuffer(gl, ELEMENT_ARRAY_BUFFER, index));
  gl.bindVertexArray(null);
  return { program, array: carried(made), shapes: source.shapes };
}

/**
 * Compiles the picture's layers and uploads their tables, the sparkle and the gradients, on
 * whichever thread holds `gl`. Throws when the GPU refuses any of it, as `createGpuBody` does.
 */
export function createGpuPicture(gl: HologramGl, scene: HologramPictureScene): GpuPicture {
  const statics = staticSegmentsLayer(staticPathsOf());
  const chips = chipsLayer();

  // The glyphs draw with the static runs' shader, from buffers of their own that a frame rewrites.
  const glyphBuffer = (size: number) => {
    const made = arrayBuffer(gl, ARRAY_BUFFER, new Float32Array(GLYPH_SLOTS * GLYPH_RUNS * 4 * size));
    gl.bufferData(ARRAY_BUFFER, new Float32Array(GLYPH_SLOTS * GLYPH_RUNS * 4 * size), DYNAMIC_DRAW);
    return made;
  };
  const glyphEnds = glyphBuffer(4);
  const glyphJoins = glyphBuffer(1);
  const glyphSource: PictureLayerSource = {
    vertexShader: SEGMENTS_VERTEX_SHADER,
    uniforms: ['halfWidth'],
    attributes: [],
    shapes: GLYPH_SLOTS * GLYPH_RUNS,
  };

  const sparkle = texture(gl, REPEAT);
  gl.texImage2D(
    TEXTURE_2D,
    0,
    RGBA8,
    SPARKLE_TEXTURE_TEXELS,
    SPARKLE_TEXTURE_TEXELS,
    0,
    RGBA,
    UNSIGNED_BYTE,
    sceneSparklePixels(scene),
  );
  const gradients = texture(gl, CLAMP_TO_EDGE);
  gl.texImage2D(TEXTURE_2D, 0, RGBA8, GRADIENT_TEXELS, GRADIENT_ROWS, 0, RGBA, UNSIGNED_BYTE, pictureGradientPixels());
  gl.bindTexture(TEXTURE_2D, null);

  return {
    segments: layerOf(gl, statics.layer),
    glyphs: layerOf(gl, glyphSource, [
      ['ends', glyphEnds, 4],
      ['joins', glyphJoins, 1],
    ]),
    arc: layerOf(gl, arcLayer()),
    disc: layerOf(gl, discLayer()),
    cage: layerOf(gl, cageLayer(scene)),
    embers: layerOf(gl, embersLayer(scene)),
    fray: layerOf(gl, frayLayer(scene)),
    chips: layerOf(gl, chips.layer),
    paths: statics.ranges,
    chipParts: chips.ranges,
    sparkle: carried(sparkle),
    gradients: carried(gradients),
    glyphEnds: carried(glyphEnds),
    glyphJoins: carried(glyphJoins),
    glyphSlots: new Array(GLYPH_SLOTS).fill(''),
    glyphRuns: new Array(GLYPH_SLOTS).fill(0),
    matrix: new Float32Array(9),
    stencil: [0],
  };
}

/** What one frame of the picture needs. */
export interface GpuPictureFrame {
  /** `analyseFrame(frame, 1)`: at size 1, so `state.radius` is his radius as a share of the square. */
  state: HologramFrameState;
  /** The square's side in device pixels, which every stroke's antialiasing is measured in. */
  pixels: number;
  /** The satellites round him, drawn over him: none on a watch. */
  satellites: readonly SatelliteOrbit[];
}

function clamp01(value: number) {
  'worklet';
  return value > 0 ? (value > 1 ? 1 : value) : 0;
}

/** Starts a path: its draws paint only the pixels no earlier path of this frame's has. */
function beginPath(gl: HologramGl, picture: GpuPicture) {
  'worklet';
  let value = picture.stencil[0] + 1;
  if (value > 255) {
    gl.depthMask(true);
    gl.clear(STENCIL_BUFFER_BIT | DEPTH_BUFFER_BIT);
    value = 1;
  }
  picture.stencil[0] = value;
  gl.stencilFunc(NOTEQUAL, value, 0xff);
}

/**
 * Sets a layer up for a draw: its program, its shapes, and the draw's transform — the local frame
 * scaled by `scale` about `originX`, `originY` in the square's own frame (0 to 1, y down). Every
 * layer is drawn upright and unsquashed, so a scale and an origin are all a transform is; the
 * stroke widths are measured in device pixels of the square, `pixels` across.
 */
function useLayer(
  gl: HologramGl,
  picture: GpuPicture,
  layer: PictureLayer,
  scale: number,
  originX: number,
  originY: number,
  pixels: number,
) {
  'worklet';
  const uniforms = layer.program.uniforms;
  gl.useProgram(layer.program.program);
  gl.bindVertexArray(layer.array);
  const matrix = picture.matrix;
  matrix[0] = scale;
  matrix[1] = 0;
  matrix[2] = 0;
  matrix[3] = 0;
  matrix[4] = scale;
  matrix[5] = 0;
  matrix[6] = originX;
  matrix[7] = originY;
  matrix[8] = 1;
  if (uniforms.toSquare) gl.uniformMatrix3fv(uniforms.toSquare, false, matrix);
  if (uniforms.localPerPixel) gl.uniform1f(uniforms.localPerPixel, 1 / (scale * pixels));
  if (uniforms.sparkle) gl.uniform1i(uniforms.sparkle, 0);
  if (uniforms.gradients) gl.uniform1i(uniforms.gradients, 1);
}

/** A layer in the drawing's unit frame (R = 1, y down), its origin at his centre. */
function useLayerFlat(gl: HologramGl, picture: GpuPicture, layer: PictureLayer, frame: GpuPictureFrame) {
  'worklet';
  useLayer(gl, picture, layer, frame.state.radius, 0.5, 0.5, frame.pixels);
}

/**
 * A layer in the drawing's unit frame shrunk towards his centre by as much as the vortex has yet to
 * carry his shell of specks out of the core (`shellReach`), so that what is drawn round the shell is
 * carried out with it as he arrives, and is in the drawing's unit frame once he has.
 *
 * The cage's lines and the embers keep their width as they are carried out (their half widths are
 * divided by the reach), so their light grows with how far out they are rather than with the area
 * they span: grown in both, the cage's light rose so steeply at the end of the vortex that a frame
 * of it turned a tenth of the picture's light on at once.
 */
function useLayerRoundTheShell(gl: HologramGl, picture: GpuPicture, layer: PictureLayer, frame: GpuPictureFrame) {
  'worklet';
  useLayer(gl, picture, layer, frame.state.radius * frame.state.shellReach, 0.5, 0.5, frame.pixels);
}

/** A layer in the drawing's unit frame moved to the core, as `canvas.translate(CORE_X, CORE_Y)` moves it. */
function useLayerAtCore(gl: HologramGl, picture: GpuPicture, layer: PictureLayer, frame: GpuPictureFrame) {
  'worklet';
  const radius = frame.state.radius;
  useLayer(gl, picture, layer, radius, 0.5 + radius * CORE_X, 0.5 + radius * CORE_Y, frame.pixels);
}

/** A paint of one colour, `kind` solid or sparkle: `colour` its RGB as a number, `alpha` its alpha. */
function setPaint(gl: HologramGl, layer: PictureLayer, kind: number, colour: number, alpha: number) {
  'worklet';
  const uniforms = layer.program.uniforms;
  const red = ((colour >> 16) & 0xff) / 255;
  const green = ((colour >> 8) & 0xff) / 255;
  const blue = (colour & 0xff) / 255;
  if (uniforms.paintColour) gl.uniform4f(uniforms.paintColour, red * alpha, green * alpha, blue * alpha, alpha);
  if (uniforms.paintKind) gl.uniform1i(uniforms.paintKind, kind);
}

function setSolid(gl: HologramGl, layer: PictureLayer, colour: number, alpha: number) {
  'worklet';
  setPaint(gl, layer, PICTURE_PAINTS.solid, colour, alpha);
}

/**
 * A radial gradient's paint, measured from the draw's local origin: its colour comes from the
 * gradient's `row`, which reaches its end at `radius`, so the paint is the alpha alone.
 */
function setRadialPaint(gl: HologramGl, layer: PictureLayer, alpha: number, row: number, radius: number) {
  'worklet';
  const uniforms = layer.program.uniforms;
  if (uniforms.paintColour) gl.uniform4f(uniforms.paintColour, alpha, alpha, alpha, alpha);
  if (uniforms.paintKind) gl.uniform1i(uniforms.paintKind, PICTURE_PAINTS.radial);
  if (uniforms.gradient) gl.uniform2f(uniforms.gradient, row, radius);
}

function setUniform1(layer: PictureLayer, gl: HologramGl, name: string, value: number) {
  'worklet';
  const location = layer.program.uniforms[name];
  if (location) gl.uniform1f(location, value);
}

/**
 * Draws `count` of a layer's shapes from `first`, as part of the path begun last: twice, first
 * only into the depth buffer, so each pixel keeps the most any of the shapes covers it by, and then
 * the colour of just that fragment (see `PATH_DEPTH_SPAN`).
 */
function drawShapes(gl: HologramGl, picture: GpuPicture, layer: PictureLayer, first: number, count: number) {
  'worklet';
  if (count <= 0) return;
  const location = layer.program.uniforms.pathDepth;
  if (location) gl.uniform1f(location, pathDepthOf(picture.stencil[0]));
  gl.colorMask(false, false, false, false);
  gl.depthMask(true);
  gl.depthFunc(LESS);
  gl.stencilOp(KEEP, KEEP, KEEP);
  gl.drawElements(TRIANGLES, count * 6, UNSIGNED_SHORT, first * 12);
  gl.colorMask(true, true, true, true);
  gl.depthMask(false);
  gl.depthFunc(EQUAL);
  gl.stencilOp(KEEP, KEEP, REPLACE);
  gl.drawElements(TRIANGLES, count * 6, UNSIGNED_SHORT, first * 12);
}

/** One of the paths that never change, stroked: `halfWidth` either side, with round ends. */
function strokeStatic(
  gl: HologramGl,
  picture: GpuPicture,
  range: ShapeRange,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.segments;
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  beginPath(gl, picture);
  drawShapes(gl, picture, layer, range.first, range.count);
}

/**
 * A whole circle of the arc layer, as the path begun last, in whatever frame and paint the layer was
 * set up with: centred on that frame's origin, `radius` across, `halfWidth` either side, its
 * brighter and dimmer stretches `lumps` apart and rolled `lumpTurn` radians round (none at 0).
 */
function drawCircle(
  gl: HologramGl,
  picture: GpuPicture,
  radius: number,
  halfWidth: number,
  lumps: number,
  lumpTurn: number,
) {
  'worklet';
  const layer = picture.arc;
  const uniforms = layer.program.uniforms;
  if (uniforms.arc) gl.uniform4f(uniforms.arc, 0, 0, radius, halfWidth);
  if (uniforms.arcEnds) gl.uniform4f(uniforms.arcEnds, 0, Math.PI * 2, ARC_PIECES, 0);
  if (uniforms.arcLumps) gl.uniform2f(uniforms.arcLumps, lumps, lumpTurn);
  drawShapes(gl, picture, layer, 0, ARC_PIECES);
}

// ---- the aura -----------------------------------------------------------------------------------

/** How strong the aura is at its brightest, on the shell's edge. */
const AURA_LIGHT = 0.24;

/**
 * The soft warm bloom round him (`AURA_INNER` to `AURA_OUTER`), painted as the band its gradient
 * lights rather than as a disc, so the middle stays see-through. It answers his voice only as much as
 * his sparks' glow does (`glowGain`). While he arrives it spreads out of the core with his shell of
 * specks, its gradient shrunk with the frame it is drawn in.
 */
function drawAura(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const alpha = AURA_LIGHT * state.auraAlpha * state.glowGain;
  if (alpha <= 0) return;
  const layer = picture.arc;
  beginPath(gl, picture);
  useLayerRoundTheShell(gl, picture, layer, frame);
  setRadialPaint(gl, layer, clamp01(alpha), GRADIENTS.aura.row, GRADIENTS.aura.radius);
  drawCircle(gl, picture, (AURA_INNER + AURA_OUTER) / 2, (AURA_OUTER - AURA_INNER) / 2, 0, 0);
}

// ---- the core -----------------------------------------------------------------------------------

/** How much dimmer the white-hot ring's dimmest stretches are than its brightest. */
const CORE_RING_LUMPS = 0.3;

/** One of the white-hot ring's nested strokes round the core, its brighter stretches rolling round it. */
function strokeCoreRing(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.arc;
  beginPath(gl, picture);
  useLayerAtCore(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  drawCircle(gl, picture, CORE_RING_RADIUS, halfWidth, CORE_RING_LUMPS, (frame.state.roll * Math.PI) / 180);
}

/**
 * The core: a glow, mostly see-through, at its brightest just inside the white-hot ring and blooming
 * out of it both ways; Age of Ultron's small ringed eye inside it, its rings an orange body under a
 * pale orange line, never white, so it reads under the glow without outshining the ring; a faint
 * bar across it; and the ring itself — the brightest thing in him — a thin orange body under a
 * crisper orange-white line.
 */
function drawCore(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const alpha = state.coreAlpha;
  if (alpha <= 0) return;
  const brightness = alpha * state.coreDrift;
  const glow = brightness * state.coreGlow;
  const disc = picture.disc;
  beginPath(gl, picture);
  useLayerAtCore(gl, picture, disc, frame);
  setRadialPaint(gl, disc, clamp01(glow), GRADIENTS.coreGlow.row, GRADIENTS.coreGlow.radius);
  if (disc.program.uniforms.disc) gl.uniform3f(disc.program.uniforms.disc, 0, 0, GRADIENTS.coreGlow.radius);
  drawShapes(gl, picture, disc, 0, 1);

  const paths = picture.paths;
  useLayerAtCore(gl, picture, picture.segments, frame);
  strokeStatic(gl, picture, paths.coreRing, 0.024 / 2, ORANGE, 0.3 * glow);
  strokeStatic(gl, picture, paths.coreRing, 0.01 / 2, PALE_ORANGE, 0.6 * glow);
  strokeStatic(gl, picture, paths.coreBar, 0.008 / 2, PALE_ORANGE, 0.16 * glow);

  strokeCoreRing(gl, picture, frame, 0.024 / 2, ORANGE, clamp01(0.7 * brightness));
  strokeCoreRing(gl, picture, frame, 0.009 / 2, WHITE_HOT, clamp01(0.9 * brightness));
}

// ---- round him: the cage and the embers -------------------------------------------------------

/** The cage's hairlines, in one paint and width, turned with his body. */
function strokeCage(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  halfWidth: number,
  kind: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.cage;
  const state = frame.state;
  beginPath(gl, picture);
  useLayerRoundTheShell(gl, picture, layer, frame);
  setPaint(gl, layer, kind, colour, alpha);
  const turn = layer.program.uniforms.bodyTurn;
  if (turn) gl.uniform2f(turn, state.bodyCos, state.bodySin);
  setUniform1(layer, gl, 'time', state.time);
  setUniform1(layer, gl, 'halfWidth', halfWidth / state.shellReach);
  drawShapes(gl, picture, layer, 0, layer.shapes);
}

/**
 * The cage round him: hairlines, as the film's wireframe is — a fine pale orange line that glitters
 * as it turns, over a glow much fainter and not much wider, so a line blooms a little and never
 * reads as a bar. It was a gold line on an amber one on a glow five times its width, and read as
 * thick glowing bars. On its own it never reaches near-white; where it crosses one of his white-hot
 * specks it Screens it nearer white, as the film's bright specks are.
 */
function drawCage(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const alpha = frame.state.cageAlpha;
  if (alpha <= 0) return;
  strokeCage(gl, picture, frame, 0.034 / 2, PICTURE_PAINTS.solid, GLOW, 0.15 * alpha);
  strokeCage(gl, picture, frame, 0.011 / 2, PICTURE_PAINTS.sparkle, PALE_ORANGE, clamp01(0.9 * alpha));
}

/** The embers, in one paint and width. */
function strokeEmbers(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.embers;
  const state = frame.state;
  beginPath(gl, picture);
  useLayerRoundTheShell(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'time', state.time);
  setUniform1(layer, gl, 'share', state.emberShare);
  setUniform1(layer, gl, 'halfWidth', halfWidth / state.shellReach);
  drawShapes(gl, picture, layer, 0, layer.shapes);
}

/** The embers drifting off him: a warm glow round a pale orange fleck. */
function drawEmbers(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const alpha = frame.state.cageAlpha;
  if (alpha <= 0) return;
  strokeEmbers(gl, picture, frame, 0.032 / 2, GLOW, 0.32 * alpha);
  strokeEmbers(gl, picture, frame, 0.011 / 2, PALE_ORANGE, clamp01(alpha));
}

// ---- while he talks ---------------------------------------------------------------------------

/** The fray's strands and streaks, in one paint and width. */
function strokeFray(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.fray;
  const state = frame.state;
  beginPath(gl, picture);
  useLayerFlat(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'drive', state.frayDrive);
  setUniform1(layer, gl, 'time', state.time);
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  drawShapes(gl, picture, layer, 0, layer.shapes);
}

/** While he talks: strands fraying off the shell's edge, streak arcs and streaks off its right (`drawFray`). */
function drawFray(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  if (frame.state.frayDrive <= 0.02) return;
  strokeFray(gl, picture, frame, 0.02 / 2, GLOW, 0.22);
  strokeFray(gl, picture, frame, 0.0065 / 2, ORANGE, 0.75);
}

/** The chips' streaks, or their cores, in one paint and width. */
function strokeChips(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  part: ShapeRange,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.chips;
  const state = frame.state;
  beginPath(gl, picture);
  useLayerFlat(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  const location = layer.program.uniforms.burst;
  if (location) gl.uniform4f(location, state.burstAge, state.burstCount, state.burstReach, state.burstStrength);
  drawShapes(gl, picture, layer, part.first, part.count);
}

/** The latest burst's shards of light: a soft glow, an orange streak, and its white-hot core (`drawChips`). */
function drawChips(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  if (state.burstAge >= CHIP_GONE_SECONDS || state.burstStrength <= 0) return;
  const parts = picture.chipParts;
  strokeChips(gl, picture, frame, parts.streak, 0.045 / 2, GLOW, 0.35);
  strokeChips(gl, picture, frame, parts.streak, 0.017 / 2, ORANGE, 0.95);
  strokeChips(gl, picture, frame, parts.core, 0.007 / 2, WHITE_HOT, 0.55);
}

// ---- while he thinks --------------------------------------------------------------------------

/** How far out of the core the thinking pulse has bloomed by the time it has gone, in R. */
const PULSE_REACH = 1.2;

/** A stroke of the thinking pulse, round the core. */
function strokePulse(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  radius: number,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.arc;
  beginPath(gl, picture);
  useLayerAtCore(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  drawCircle(gl, picture, radius, halfWidth, 0, 0);
}

/** The ring that blooms out of the core's white-hot ring as a thought's pass finishes (`drawThinkingPulse`). */
function drawThinkingPulse(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  if (state.thinking * state.pulse <= 0) return;
  const radius = CORE_RING_RADIUS + (PULSE_REACH - CORE_RING_RADIUS) * state.pulse;
  const strength = state.thinking * (1 - state.pulse);
  strokePulse(gl, picture, frame, radius, 0.05 / 2, GLOW, 0.3 * strength);
  strokePulse(gl, picture, frame, radius, 0.012 / 2, ORANGE, 0.85 * strength);
}

// ---- satellites -------------------------------------------------------------------------------

/** Writes `glyph`'s runs into a slot of the glyphs' buffer, if that slot does not hold it already. */
function holdGlyph(gl: HologramGl, picture: GpuPicture, slot: number, glyph: string) {
  'worklet';
  if (picture.glyphSlots[slot] === glyph) return;
  let runs = flattenGlyph(glyph);
  if (runs.length === 0) runs = flattenGlyph(PLAIN_RING_GLYPH);
  const count = Math.min(GLYPH_RUNS, runs.length / GLYPH_RUN_NUMBERS);
  const ends = new Float32Array(count * 16);
  const joins = new Float32Array(count * 4);
  for (let run = 0; run < count; run++) {
    for (let corner = 0; corner < 4; corner++) {
      for (let number = 0; number < 4; number++) {
        ends[run * 16 + corner * 4 + number] = runs[run * GLYPH_RUN_NUMBERS + number];
      }
      joins[run * 4 + corner] = runs[run * GLYPH_RUN_NUMBERS + 4];
    }
  }
  const offset = slot * GLYPH_RUNS * 4;
  gl.bindBuffer(ARRAY_BUFFER, picture.glyphEnds);
  gl.bufferSubData(ARRAY_BUFFER, offset * 16, ends);
  gl.bindBuffer(ARRAY_BUFFER, picture.glyphJoins);
  gl.bufferSubData(ARRAY_BUFFER, offset * 4, joins);
  picture.glyphSlots[slot] = glyph;
  picture.glyphRuns[slot] = count;
}

/** Where a satellite is drawn: its centre in the square, and its glyph's radius there. */
interface SatellitePlace {
  centreX: number;
  centreY: number;
  glyphRadius: number;
}

/** A layer set up in a satellite's own frame, in glyph radii round its centre. */
function useLayerAtSatellite(
  gl: HologramGl,
  picture: GpuPicture,
  layer: PictureLayer,
  frame: GpuPictureFrame,
  place: SatellitePlace,
) {
  'worklet';
  useLayer(gl, picture, layer, place.glyphRadius, place.centreX, place.centreY, frame.pixels);
}

/** A filled disc of `radius` glyph radii at a satellite's centre, as a path of its own. */
function fillSatelliteDisc(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  place: SatellitePlace,
  radius: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const disc = picture.disc;
  beginPath(gl, picture);
  useLayerAtSatellite(gl, picture, disc, frame, place);
  setSolid(gl, disc, colour, alpha);
  const discAt = disc.program.uniforms.disc;
  if (discAt) gl.uniform3f(discAt, 0, 0, radius);
  drawShapes(gl, picture, disc, 0, 1);
}

/** A satellite's glyph from its slot, in the plain stroke and, into a tool call, the flare's. */
function strokeSatelliteGlyph(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  place: SatellitePlace,
  slot: number,
  light: number,
  flare: number,
) {
  'worklet';
  const glyphs = picture.glyphs;
  for (let pass = 0; pass < (flare > 0 ? 2 : 1); pass++) {
    beginPath(gl, picture);
    useLayerAtSatellite(gl, picture, glyphs, frame, place);
    setSolid(gl, glyphs, pass === 0 ? DEEP_ORANGE : ORANGE, pass === 0 ? light * (1 - flare) : light * flare);
    setUniform1(glyphs, gl, 'halfWidth', GLYPH_STROKE_WIDTH / 2);
    drawShapes(gl, picture, glyphs, slot * GLYPH_RUNS, picture.glyphRuns[slot]);
  }
}

/** The ring a tool call flares out of a satellite, shrinking in as the flare goes. */
function strokeSatelliteFlare(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  place: SatellitePlace,
  light: number,
  flare: number,
) {
  'worklet';
  const arc = picture.arc;
  beginPath(gl, picture);
  useLayerAtSatellite(gl, picture, arc, frame, place);
  setSolid(gl, arc, ORANGE, light * flare);
  drawCircle(gl, picture, 1.75 - 0.95 * flare, 0.07 / 2, 0, 0);
}

/** One satellite at its place: its halo, glyph, dot and flare. */
function drawSatellite(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  place: SatellitePlace,
  slot: number,
  light: number,
  flare: number,
) {
  'worklet';
  const haloAlpha = Math.min(1, 0.16 * light * (1 + 1.5 * flare));
  fillSatelliteDisc(gl, picture, frame, place, 1.15, GLOW, haloAlpha);
  fillSatelliteDisc(gl, picture, frame, place, 0.7, GLOW, haloAlpha);
  strokeSatelliteGlyph(gl, picture, frame, place, slot, light, flare);
  fillSatelliteDisc(gl, picture, frame, place, 0.1, ORANGE, light * (0.6 + 0.4 * flare));
  if (flare > 0) strokeSatelliteFlare(gl, picture, frame, place, light, flare);
}

/** Every satellite round the sphere, over him, at the drawing's clock (`drawSatellites`). */
function drawSatellites(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const orbits = frame.satellites;
  let slot = 0;
  for (let index = 0; index < orbits.length && slot < GLYPH_SLOTS; index++) {
    const orbit = orbits[index];
    const satellite = orbit === undefined ? undefined : screenSatellite(orbit, frame.state.time);
    if (orbit === undefined || satellite === undefined) continue;
    holdGlyph(gl, picture, slot, orbit.glyph);
    const place = {
      centreX: 0.5 + satellite.across * SPHERE_FRACTION,
      centreY: 0.5 - satellite.up * SPHERE_FRACTION,
      glyphRadius: satellite.glyphRadii * SPHERE_FRACTION,
    };
    drawSatellite(gl, picture, frame, place, slot, satellite.light, orbit.flare);
    slot++;
  }
}

/**
 * Draws one frame of the picture into the bound framebuffer, which the caller has sized and cleared
 * — colour and stencil — and leaves the blend set as it was drawn with and the stencil test off, for
 * the body to draw over it.
 */
export function drawGpuPicture(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  gl.enable(BLEND);
  gl.blendEquation(FUNC_ADD);
  gl.blendFuncSeparate(ONE, ONE_MINUS_SRC_COLOR, ONE, ONE_MINUS_SRC_ALPHA);
  gl.enable(STENCIL_TEST);
  gl.stencilMask(0xff);
  gl.enable(DEPTH_TEST);
  picture.stencil[0] = 0;
  gl.activeTexture(TEXTURE0);
  gl.bindTexture(TEXTURE_2D, picture.sparkle);
  gl.activeTexture(TEXTURE0 + 1);
  gl.bindTexture(TEXTURE_2D, picture.gradients);
  gl.activeTexture(TEXTURE0);
  drawAura(gl, picture, frame);
  drawCore(gl, picture, frame);
  drawCage(gl, picture, frame);
  drawEmbers(gl, picture, frame);
  drawFray(gl, picture, frame);
  drawChips(gl, picture, frame);
  drawThinkingPulse(gl, picture, frame);
  drawSatellites(gl, picture, frame);
  gl.disable(STENCIL_TEST);
  gl.disable(DEPTH_TEST);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}
