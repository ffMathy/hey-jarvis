import { PLAIN_RING_GLYPH, type SatelliteOrbit } from '../agent-work';
import {
  CORE_X,
  CORE_Y,
  type HologramFrameState,
  type HologramPictureScene,
  LIMB_BLOOM_BAND,
  LIMB_BLOOM_RADIUS,
  LIMB_RIDGE_BAND,
  LIMB_RIDGE_RADIUS,
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
  chipsLayer,
  cometsLayer,
  crescentLayer,
  discLayer,
  frayLayer,
  knotLayer,
  lightningLayer,
  type PictureLayerSource,
  SEGMENTS_VERTEX_SHADER,
  type ShapeRange,
  type StaticPathName,
  segmentLayer,
  spokesLayer,
  staticSegmentsLayer,
  swooshLayer,
  type TrussPart,
  ticksLayer,
  trussLayer,
} from './picture-layers';
import { sceneSparklePixels } from './sparkle';

/**
 * Everything of him but his body on the GPU, over a bare WebGL 2 context: what was Skia's picture
 * of him, until the GPU drew all of him.
 *
 * Drawn layer for layer as Skia drew it — the inner shells, the lines, the core, the thin ring, the
 * ladder truss, the crescent, the fray, the chips, the accents, the thinking pulse, and the
 * satellites over him — each of Skia's `drawPath` calls one draw here, with the same paint, the same
 * width and the same transform, from the layers in `picture-layers.ts`, whose vertex shaders are the
 * drawing's path builders moved to the GPU. vr's `hologram-picture.spec.ts` holds it to frames Skia
 * drew. So a frame's JavaScript is a few dozen draws'
 * uniforms, and nothing it does grows with what is drawn.
 *
 * **Every paint is Screen**, as every one of Skia's was: premultiplied light, blended
 * `ONE, ONE_MINUS_SRC_COLOR` (alpha `ONE, ONE_MINUS_SRC_ALPHA`), which is Screen with the paint's
 * coverage folded in exactly as Skia's antialiasing folds it.
 *
 * **A path is one coverage, as Skia's is.** Skia strokes a path once, so where its runs overlap —
 * a polyline's joins, two comets crossing — the overlap is not lit twice. Here a path is several
 * shapes, so each path's draws take a stencil value of their own and paint only pixels that path
 * has not painted yet: the stencil test is `NOTEQUAL` its value, and a pixel painted is set to it.
 * The values count up from 1 each frame, the stencil cleared to 0 with the colour and again if a
 * frame ever ran past 255 paths, so the canvas needs a stencil buffer.
 *
 * **And where its shapes overlap, the one that covers a pixel most is the one painted.** The first
 * to reach a pixel would otherwise take it, and the faint antialiased edge of one strand of the
 * crescent, reaching a pixel before the strand lying over it, left a dark seam inside the stroke.
 * So each draw is made twice (`drawShapes`): into the depth buffer alone, each fragment nearer the
 * more it covers, and then in colour where the depth is equal, which is the fragment that covered
 * most; the stencil still stops a tie painting twice. Each path draws in a band of depths nearer
 * than every earlier path's, so the depth buffer, cleared to 1 with the colour, needs clearing only
 * with the stencil, and the canvas needs a depth buffer as well. expo-gl's on Android asks for 16
 * bits, which leaves each path's band 256 steps of coverage.
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

/** What `createGpuPicture` makes, as plain data, so a worklet can carry it (see `GpuBody`). */
export interface GpuPicture {
  segments: PictureLayer;
  glyphs: PictureLayer;
  arc: PictureLayer;
  disc: PictureLayer;
  segment: PictureLayer;
  comets: PictureLayer;
  spokes: PictureLayer;
  swoosh: PictureLayer;
  knot: PictureLayer;
  truss: PictureLayer;
  ticks: PictureLayer;
  crescent: PictureLayer;
  fray: PictureLayer;
  chips: PictureLayer;
  lightning: PictureLayer;
  paths: Record<StaticPathName, ShapeRange>;
  trussParts: Record<TrussPart, ShapeRange>;
  crescentTiers: ShapeRange[];
  chipParts: Record<'slab' | 'middle', ShapeRange>;
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
  const statics = staticSegmentsLayer(staticPathsOf(scene.textureSeed));
  const truss = trussLayer(scene);
  const crescent = crescentLayer(scene);
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
    uniforms: ['halfWidth', 'roundCaps'],
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
  gl.texImage2D(
    TEXTURE_2D,
    0,
    RGBA8,
    GRADIENT_TEXELS,
    GRADIENT_ROWS,
    0,
    RGBA,
    UNSIGNED_BYTE,
    pictureGradientPixels(scene.textureSeed),
  );
  gl.bindTexture(TEXTURE_2D, null);

  return {
    segments: layerOf(gl, statics.layer),
    glyphs: layerOf(gl, glyphSource, [
      ['ends', glyphEnds, 4],
      ['joins', glyphJoins, 1],
    ]),
    arc: layerOf(gl, arcLayer()),
    disc: layerOf(gl, discLayer()),
    segment: layerOf(gl, segmentLayer()),
    comets: layerOf(gl, cometsLayer(scene)),
    spokes: layerOf(gl, spokesLayer()),
    swoosh: layerOf(gl, swooshLayer()),
    knot: layerOf(gl, knotLayer()),
    truss: layerOf(gl, truss.layer),
    ticks: layerOf(gl, ticksLayer(scene)),
    crescent: layerOf(gl, crescent.layer),
    fray: layerOf(gl, frayLayer(scene)),
    chips: layerOf(gl, chips.layer),
    lightning: layerOf(gl, lightningLayer()),
    paths: statics.ranges,
    trussParts: truss.ranges,
    crescentTiers: crescent.tiers,
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
  /** `analyseFrame(frame, 1, scene)`: at size 1, so `state.radius` is his radius as a share of the square. */
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

function smooth01(value: number) {
  'worklet';
  const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
  return clamped * clamped * (3 - 2 * clamped);
}

function fraction(value: number) {
  'worklet';
  return value - Math.floor(value);
}

function hashInteger(value: number) {
  'worklet';
  let mixed = Math.imul(value | 0, 0x9e3779b1);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x85ebca77);
  mixed ^= mixed >>> 13;
  return (mixed >>> 0) / 4294967296;
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
 * Sets a layer up for a draw: its program, its shapes, the draw's transform — `a`…`f` the local
 * frame in the square's own frame (0 to 1, y down), as a canvas matrix's six numbers — and its paint.
 * `localPerPixel` is how long a device pixel is in the local frame.
 */
function useLayer(
  gl: HologramGl,
  picture: GpuPicture,
  layer: PictureLayer,
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  localPerPixel: number,
) {
  'worklet';
  const uniforms = layer.program.uniforms;
  gl.useProgram(layer.program.program);
  gl.bindVertexArray(layer.array);
  const matrix = picture.matrix;
  matrix[0] = a;
  matrix[1] = b;
  matrix[2] = 0;
  matrix[3] = c;
  matrix[4] = d;
  matrix[5] = 0;
  matrix[6] = e;
  matrix[7] = f;
  matrix[8] = 1;
  if (uniforms.toSquare) gl.uniformMatrix3fv(uniforms.toSquare, false, matrix);
  if (uniforms.localPerPixel) gl.uniform1f(uniforms.localPerPixel, localPerPixel);
  if (uniforms.sparkle) gl.uniform1i(uniforms.sparkle, 0);
  if (uniforms.gradients) gl.uniform1i(uniforms.gradients, 1);
}

/** A layer in the drawing's unit frame turned `degrees` clockwise about `pivotX`, `pivotY`, as `canvas.rotate` turns it. */
function useLayerTurned(
  gl: HologramGl,
  picture: GpuPicture,
  layer: PictureLayer,
  frame: GpuPictureFrame,
  degrees: number,
  pivotX: number,
  pivotY: number,
) {
  'worklet';
  const radius = frame.state.radius;
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const offsetX = pivotX - cos * pivotX + sin * pivotY;
  const offsetY = pivotY - sin * pivotX - cos * pivotY;
  useLayer(
    gl,
    picture,
    layer,
    radius * cos,
    radius * sin,
    -radius * sin,
    radius * cos,
    0.5 + radius * offsetX,
    0.5 + radius * offsetY,
    1 / (radius * frame.pixels),
  );
}

/** A layer in the drawing's unit frame, untransformed. */
function useLayerFlat(gl: HologramGl, picture: GpuPicture, layer: PictureLayer, frame: GpuPictureFrame) {
  'worklet';
  useLayerTurned(gl, picture, layer, frame, 0, 0, 0);
}

/** A layer in the drawing's unit frame moved to the core, as `canvas.translate(CORE_X, CORE_Y)` moves it. */
function useLayerAtCore(gl: HologramGl, picture: GpuPicture, layer: PictureLayer, frame: GpuPictureFrame) {
  'worklet';
  const radius = frame.state.radius;
  useLayer(
    gl,
    picture,
    layer,
    radius,
    0,
    0,
    radius,
    0.5 + radius * CORE_X,
    0.5 + radius * CORE_Y,
    1 / (radius * frame.pixels),
  );
}

/**
 * The paint, as Skia's paint was set for the draw: `kind` one of PICTURE_PAINTS, `colour` its RGB as a
 * number, `alpha` its alpha. A gradient's colour comes from the gradient, so its paint is the alpha
 * alone; `radialRow`, `radius` and `sweepRow` say which gradients it reads.
 */
function setPaint(
  gl: HologramGl,
  layer: PictureLayer,
  kind: number,
  colour: number,
  alpha: number,
  radialRow: number,
  radius: number,
  sweepRow: number,
) {
  'worklet';
  const uniforms = layer.program.uniforms;
  const isGradient = kind >= PICTURE_PAINTS.radialSweep;
  const red = isGradient ? 1 : ((colour >> 16) & 0xff) / 255;
  const green = isGradient ? 1 : ((colour >> 8) & 0xff) / 255;
  const blue = isGradient ? 1 : (colour & 0xff) / 255;
  if (uniforms.paintColour) gl.uniform4f(uniforms.paintColour, red * alpha, green * alpha, blue * alpha, alpha);
  if (uniforms.paintKind) gl.uniform1i(uniforms.paintKind, kind);
  if (uniforms.gradient) gl.uniform3f(uniforms.gradient, radialRow, radius, sweepRow);
}

function setSolid(gl: HologramGl, layer: PictureLayer, colour: number, alpha: number) {
  'worklet';
  setPaint(gl, layer, PICTURE_PAINTS.solid, colour, alpha, 0, 1, 0);
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

/** One of the paths that never change, stroked: `halfWidth` either side, its ends round or butt. */
function strokeStatic(
  gl: HologramGl,
  picture: GpuPicture,
  range: ShapeRange,
  halfWidth: number,
  roundCaps: number,
  kind: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.segments;
  setPaint(gl, layer, kind, colour, alpha, 0, 1, 0);
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  setUniform1(layer, gl, 'roundCaps', roundCaps);
  beginPath(gl, picture);
  drawShapes(gl, picture, layer, range.first, range.count);
}

// ---- the volume -------------------------------------------------------------------------------

/**
 * The inner layer, turning the other way from the rim: the whorl, the loop, the ")" bracket and the
 * edge-on ellipse, then the data streaks on the pinned body (`drawInnerShells`).
 */
function drawInnerShells(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const alpha = state.innerAlpha;
  if (alpha <= 0) return;
  const paths = picture.paths;
  const solid = PICTURE_PAINTS.solid;
  const sparkle = PICTURE_PAINTS.sparkle;
  useLayerTurned(gl, picture, picture.segments, frame, state.shellTurn, CORE_X, CORE_Y);
  strokeStatic(gl, picture, paths.whorl, 0.115 / 2, 1, solid, 0xd8651e, 0.26 * alpha);
  strokeStatic(gl, picture, paths.whorlOuter, 0.082 / 2, 1, solid, 0xd8651e, 0.17 * alpha);
  strokeStatic(gl, picture, paths.whorl, 0.04 / 2, 1, sparkle, 0xf47126, 0.95 * alpha);
  strokeStatic(gl, picture, paths.whorlOuter, 0.028 / 2, 1, sparkle, 0xf47126, 0.7 * alpha);
  strokeStatic(gl, picture, paths.whorl, 0.013 / 2, 1, sparkle, 0xff8c38, 0.6 * alpha * (1 - 0.5 * state.agitation));
  strokeStatic(gl, picture, paths.whorlTicks, 0.01 / 2, 1, sparkle, 0xf47126, 0.6 * alpha);
  strokeStatic(gl, picture, paths.loop, 0.056 / 2, 1, solid, 0xdc6820, 0.14 * alpha);
  strokeStatic(gl, picture, paths.loop, 0.023 / 2, 0, solid, 0xe6862f, 0.75 * alpha);
  strokeStatic(gl, picture, paths.edgeOn, 0.012 / 2, 0, solid, 0xe6862f, 0.3 * alpha);
  strokeStatic(gl, picture, paths.bracket, 0.03 / 2, 1, solid, 0xe68727, 0.6 * alpha);
  useLayerFlat(gl, picture, picture.segments, frame);
  strokeStatic(gl, picture, paths.dataStreaks, 0.007 / 2, 0, solid, 0xe6862f, 0.32 * alpha * state.coreAlpha);
}

/** Comets always; spokes or the swoosh when the script's epoch calls for them (`drawLines`). */
function drawLines(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const alpha = state.innerAlpha * state.coreAlpha;
  if (alpha <= 0) return;
  const script = state.script;
  const spokes = script.lineKind === 1;
  // The comets and the spokes are one path: a glow under it, then the line.
  for (let pass = 0; pass < 2; pass++) {
    const halfWidth = pass === 0 ? 0.034 / 2 : 0.013 / 2;
    const roundCaps = pass === 0 ? 1 : 0;
    const colour = pass === 0 ? 0xdc6820 : 0xec9440;
    const strength = pass === 0 ? 0.12 * alpha : 0.7 * alpha;
    beginPath(gl, picture);
    useLayerFlat(gl, picture, picture.comets, frame);
    setSolid(gl, picture.comets, colour, strength);
    setUniform1(picture.comets, gl, 'time', state.time);
    setUniform1(picture.comets, gl, 'halfWidth', halfWidth);
    setUniform1(picture.comets, gl, 'roundCaps', roundCaps);
    drawShapes(gl, picture, picture.comets, 0, picture.comets.shapes);
    if (spokes) {
      useLayerFlat(gl, picture, picture.spokes, frame);
      setSolid(gl, picture.spokes, colour, strength);
      setUniform1(picture.spokes, gl, 'lineSeed', script.lineSeed);
      setUniform1(picture.spokes, gl, 'envelope', script.lineEnvelope);
      setUniform1(picture.spokes, gl, 'halfWidth', halfWidth);
      setUniform1(picture.spokes, gl, 'roundCaps', roundCaps);
      drawShapes(gl, picture, picture.spokes, 0, picture.spokes.shapes);
    }
  }
  if (script.lineKind === 2) {
    beginPath(gl, picture);
    useLayerFlat(gl, picture, picture.swoosh, frame);
    setSolid(gl, picture.swoosh, 0xec9440, 0.42 * alpha * script.lineEnvelope);
    setUniform1(picture.swoosh, gl, 'lines', Math.floor(24 * clamp01(script.lineSeconds / 1.2)));
    setUniform1(picture.swoosh, gl, 'halfWidth', 0.006 / 2);
    drawShapes(gl, picture, picture.swoosh, 0, picture.swoosh.shapes);
  }
}

// ---- the core -----------------------------------------------------------------------------------

function strokeKnot(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.knot;
  beginPath(gl, picture);
  useLayerAtCore(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'knotStep', Math.floor(frame.state.time * 6));
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  setUniform1(layer, gl, 'roundCaps', 1);
  drawShapes(gl, picture, layer, 0, layer.shapes);
}

/** The core: the elongated bloom, the hooked ring, the bar and the spiky knot (`drawCore`). */
function drawCore(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const alpha = state.coreAlpha;
  if (alpha <= 0) return;
  const brightness = alpha * state.coreDrift;
  const radius = state.radius;
  // The bloom: a unit disc turned -45° and squashed to 0.2 by 0.29 at the core.
  const angle = (-45 * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const disc = picture.disc;
  beginPath(gl, picture);
  useLayer(
    gl,
    picture,
    disc,
    radius * cos * 0.2,
    radius * sin * 0.2,
    -radius * sin * 0.29,
    radius * cos * 0.29,
    0.5 + radius * CORE_X,
    0.5 + radius * CORE_Y,
    1 / (radius * frame.pixels),
  );
  setPaint(
    gl,
    disc,
    PICTURE_PAINTS.radial,
    0,
    clamp01(0.52 * brightness),
    GRADIENTS.coreBloom.row,
    GRADIENTS.coreBloom.radius,
    0,
  );
  if (disc.program.uniforms.disc) gl.uniform3f(disc.program.uniforms.disc, 0, 0, 1);
  drawShapes(gl, picture, disc, 0, 1);

  const paths = picture.paths;
  const solid = PICTURE_PAINTS.solid;
  useLayerAtCore(gl, picture, picture.segments, frame);
  strokeStatic(gl, picture, paths.coreRing, 0.075 / 2, 1, solid, 0xec8c2c, 0.2 * brightness);
  strokeKnot(gl, picture, frame, 0.075 / 2, 0xec8c2c, 0.2 * brightness);
  useLayerAtCore(gl, picture, picture.segments, frame);
  strokeStatic(gl, picture, paths.coreBar, 0.04 / 2, 1, solid, 0xec8c2c, 0.3 * brightness);
  strokeStatic(gl, picture, paths.coreRing, 0.04 / 2, 1, solid, 0xec8c2c, 0.3 * brightness);
  strokeStatic(gl, picture, paths.coreRing, 0.017 / 2, 1, solid, 0xffa440, clamp01(0.62 * brightness));
  strokeStatic(gl, picture, paths.coreBar, 0.013 / 2, 1, solid, 0xffa440, clamp01(0.62 * brightness));
  strokeKnot(gl, picture, frame, 0.009 / 2, 0xffa440, 0.55 * alpha);
}

// ---- the rim ------------------------------------------------------------------------------------

/**
 * A circle, or an arc of one, in the drawing's unit frame turned `degrees` about the centre: the
 * limb's bands, the thin ring and the thinking pulse.
 */
function strokeCircle(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  degrees: number,
  radius: number,
  halfWidth: number,
  kind: number,
  alpha: number,
  radialRow: number,
  radialRadius: number,
  sweepRow: number,
) {
  'worklet';
  const layer = picture.arc;
  beginPath(gl, picture);
  useLayerTurned(gl, picture, layer, frame, degrees, 0, 0);
  setPaint(gl, layer, kind, 0, alpha, radialRow, radialRadius, sweepRow);
  const uniforms = layer.program.uniforms;
  if (uniforms.arc) gl.uniform4f(uniforms.arc, 0, 0, radius, halfWidth);
  if (uniforms.arcEnds) gl.uniform4f(uniforms.arcEnds, 0, Math.PI * 2, ARC_PIECES, 0);
  drawShapes(gl, picture, layer, 0, ARC_PIECES);
}

/** The thin rim ring and the limb ridge under it (`drawThinRing`). */
function drawThinRing(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const script = state.script;
  const ridge = script.ringWeight * state.rimAlpha;
  if (ridge > 0.01) {
    strokeCircle(
      gl,
      picture,
      frame,
      state.roll,
      LIMB_RIDGE_RADIUS,
      LIMB_RIDGE_BAND / 2,
      PICTURE_PAINTS.radialSweep,
      clamp01(ridge),
      GRADIENTS.ridgeRing.row,
      GRADIENTS.ridgeRing.radius,
      GRADIENTS.ridgeLumps.row,
    );
  }
  const weight = ridge;
  if (weight <= 0.01) return;
  strokeCircle(
    gl,
    picture,
    frame,
    0,
    1,
    (0.012 + 0.008 * weight) / 2,
    PICTURE_PAINTS.sweep,
    clamp01(0.25 + 0.7 * weight),
    0,
    1,
    GRADIENTS.thinRing.row,
  );
}

function strokeTruss(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  part: ShapeRange,
  weight: number,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.truss;
  beginPath(gl, picture);
  useLayerTurned(gl, picture, layer, frame, frame.state.roll, 0, 0);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'weight', weight);
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  drawShapes(gl, picture, layer, part.first, part.count);
}

/** The rolling rim layer: the ladder truss, the thin ring's ticks and the strand fan (`drawTruss`). */
function drawTruss(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const script = state.script;
  const weight = script.trussWeight * state.rimAlpha;
  const parts = picture.trussParts;
  if (state.rimAlpha > 0) {
    const ticks = picture.ticks;
    beginPath(gl, picture);
    useLayerTurned(gl, picture, ticks, frame, state.roll, 0, 0);
    setSolid(gl, ticks, 0xf49838, (0.15 + 0.6 * script.ringWeight) * state.rimAlpha);
    setUniform1(ticks, gl, 'roll', state.roll);
    setUniform1(ticks, gl, 'halfWidth', 0.009 / 2);
    drawShapes(gl, picture, ticks, 0, ticks.shapes);
  }
  // Pieces under the weight that shows them are hidden by the shader, as appendTruss skips them.
  const glow = state.glowGain;
  strokeTruss(gl, picture, frame, parts.haze, weight, 0.18 / 2, 0x99561a, 0.58 * weight * glow);
  strokeTruss(
    gl,
    picture,
    frame,
    parts.outer,
    weight,
    (0.1 + 0.05 * weight) / 2,
    0xc9812c,
    0.5 * (0.3 + 0.7 * weight) * glow,
  );
  strokeTruss(gl, picture, frame, parts.inner, weight, (0.011 + 0.006 * weight) / 2, 0xf49838, 0.35 + 0.4 * weight);
  strokeTruss(gl, picture, frame, parts.outer, weight, (0.02 + 0.012 * weight) / 2, 0xf49838, 0.5 + 0.45 * weight);
  strokeTruss(gl, picture, frame, parts.outer, weight, 0.008 / 2, 0xffae46, 0.85 * weight);
  strokeTruss(gl, picture, frame, parts.rung, weight, 0.016 / 2, 0xf49838, 0.35 + 0.55 * weight);
  strokeTruss(gl, picture, frame, parts.detail, weight, 0.006 / 2, 0xf49838, 0.2 + 0.35 * weight);
  // the strand fan turns counter-clockwise at 3.5°/s, fading out and back on a 14 s cycle
  const fanCycle = fraction(state.time / 14);
  const fanAlpha = smooth01(fanCycle / 0.12) * smooth01((1 - fanCycle) / 0.12) * state.rimAlpha;
  const fanWeight = clamp01((script.trussWeight - 0.35) / 0.5) * fanAlpha;
  if (fanWeight > 0.02) {
    useLayerTurned(gl, picture, picture.segments, frame, -5 * fanCycle * 14 * 0.7, 0, 0);
    strokeStatic(gl, picture, picture.paths.strandFan, 0.008 / 2, 0, PICTURE_PAINTS.solid, 0xf49838, 0.6 * fanWeight);
  }
}

function strokeCrescent(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  tier: ShapeRange,
  shatter: number,
  shatterClock: number,
  halfWidth: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.crescent;
  const state = frame.state;
  beginPath(gl, picture);
  useLayerFlat(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'spread', state.spread);
  setUniform1(layer, gl, 'time', state.time);
  setUniform1(layer, gl, 'roll', state.roll);
  setUniform1(layer, gl, 'halfWidth', halfWidth);
  const location = layer.program.uniforms.shatter;
  if (location) gl.uniform2f(location, shatter, shatterClock);
  drawShapes(gl, picture, layer, tier.first, tier.count);
}

/** The bright crescent on the left limb and the limb bloom behind it (`drawCrescent`). */
function drawCrescent(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const weight = Math.max(state.script.crescentWeight, 0.65 * state.agitation) * state.rimAlpha;
  if (weight <= 0.01) return;
  const spread = state.spread;
  const shatterClock = 255 + hashInteger(state.burstCount * 131 + 7) * 35;
  const shatter = state.burstAge < 0.18 ? (1 - state.burstAge / 0.18) * (0.5 + 0.5 * state.burstStrength) : 0;
  strokeCircle(
    gl,
    picture,
    frame,
    0,
    LIMB_BLOOM_RADIUS,
    LIMB_BLOOM_BAND / 2,
    PICTURE_PAINTS.radialSweep,
    clamp01(0.42 * weight),
    GRADIENTS.bloomRing.row,
    GRADIENTS.bloomRing.radius,
    GRADIENTS.bloomMask.row,
  );
  const tiers = picture.crescentTiers;
  strokeCrescent(
    gl,
    picture,
    frame,
    tiers[2],
    shatter,
    shatterClock,
    (0.1 * (1 - 0.5 * spread)) / 2,
    0xe07a1a,
    0.26 * weight,
  );
  strokeCrescent(gl, picture, frame, tiers[0], shatter, shatterClock, 0.01 / 2, 0xdca131, clamp01(0.8 * weight));
  strokeCrescent(
    gl,
    picture,
    frame,
    tiers[1],
    shatter,
    shatterClock,
    (0.026 * (1 - 0.45 * spread)) / 2,
    0xf09430,
    clamp01(0.8 * weight),
  );
  strokeCrescent(
    gl,
    picture,
    frame,
    tiers[2],
    shatter,
    shatterClock,
    (0.056 * (1 - 0.62 * spread)) / 2,
    0xfba838,
    clamp01(0.85 * weight * (1 - 0.3 * spread)),
  );
  strokeCrescent(
    gl,
    picture,
    frame,
    tiers[3],
    shatter,
    shatterClock,
    (0.018 * (1 - 0.5 * spread)) / 2,
    0xffc244,
    clamp01(0.9 * weight * (1 - spread) * (1 - spread)),
  );
}

/** While he talks: strands fraying off the limb, streak arcs and streaks off the right limb (`drawFray`). */
function drawFray(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const drive = state.frayDrive;
  if (drive <= 0.02) return;
  const layer = picture.fray;
  beginPath(gl, picture);
  useLayerFlat(gl, picture, layer, frame);
  setSolid(gl, layer, 0xf0943a, 0.8);
  setUniform1(layer, gl, 'drive', drive);
  setUniform1(layer, gl, 'time', state.time);
  setUniform1(layer, gl, 'halfWidth', 0.011 / 2);
  drawShapes(gl, picture, layer, 0, layer.shapes);
}

// ---- chip bursts ------------------------------------------------------------------------------

function fillChips(
  gl: HologramGl,
  picture: GpuPicture,
  frame: GpuPictureFrame,
  part: ShapeRange,
  strokeHalf: number,
  colour: number,
  alpha: number,
) {
  'worklet';
  const layer = picture.chips;
  const state = frame.state;
  beginPath(gl, picture);
  useLayerFlat(gl, picture, layer, frame);
  setSolid(gl, layer, colour, alpha);
  setUniform1(layer, gl, 'strokeHalf', strokeHalf);
  const location = layer.program.uniforms.burst;
  if (location) gl.uniform4f(location, state.burstAge, state.burstCount, state.burstReach, state.burstStrength);
  drawShapes(gl, picture, layer, part.first, part.count);
}

/** The latest burst's chips: a soft edge, the slab, its hot middle (`drawChips`). */
function drawChips(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  if (state.burstAge >= 0.2 || state.burstStrength <= 0) return;
  const parts = picture.chipParts;
  fillChips(gl, picture, frame, parts.slab, 0.028 / 2, 0xf08a28, 0.5);
  fillChips(gl, picture, frame, parts.slab, 0, 0xf59430, 1);
  fillChips(gl, picture, frame, parts.middle, 0, 0xffa840, 0.45);
}

// ---- rare accents -----------------------------------------------------------------------------

/** The jagged lightning filament and the very rare red segment (`drawAccents`). */
function drawAccents(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  const script = state.script;
  const alpha = state.rimAlpha;
  if (alpha <= 0) return;
  if (script.lineKind === 3) {
    const layer = picture.lightning;
    beginPath(gl, picture);
    useLayerFlat(gl, picture, layer, frame);
    setSolid(gl, layer, 0xc39568, 0.85 * alpha * script.lineEnvelope);
    setUniform1(layer, gl, 'lineSeed', script.lineSeed);
    setUniform1(layer, gl, 'filmFrame', Math.floor(state.time * 24));
    setUniform1(layer, gl, 'halfWidth', 0.008 / 2);
    drawShapes(gl, picture, layer, 0, layer.shapes);
  }
  if (script.redVisible) {
    const layer = picture.segment;
    const angle = ((360 * hashInteger(script.lineSeed * 7) - 90) * Math.PI) / 180;
    beginPath(gl, picture);
    useLayerFlat(gl, picture, layer, frame);
    setSolid(gl, layer, 0xb3470f, 0.9 * alpha);
    const location = layer.program.uniforms.segment;
    if (location) {
      gl.uniform4f(
        location,
        Math.cos(angle) * 0.9,
        Math.sin(angle) * 0.9,
        Math.cos(angle + 0.12) * 0.9,
        Math.sin(angle + 0.12) * 0.9,
      );
    }
    setUniform1(layer, gl, 'halfWidth', 0.016 / 2);
    setUniform1(layer, gl, 'roundCaps', 0);
    drawShapes(gl, picture, layer, 0, 1);
  }
}

/** The ring that blooms out of the core as a thought's pass finishes (`drawThinkingPulse`). */
function drawThinkingPulse(gl: HologramGl, picture: GpuPicture, frame: GpuPictureFrame) {
  'worklet';
  const state = frame.state;
  if (state.thinking * state.pulse <= 0) return;
  // The thin ring's paint, at the width the thin ring was last drawn at.
  const ringWeight = state.script.ringWeight * state.rimAlpha;
  strokeCircle(
    gl,
    picture,
    frame,
    0,
    0.15 + 1.05 * state.pulse,
    (0.012 + 0.008 * ringWeight) / 2,
    PICTURE_PAINTS.sweep,
    state.thinking * (1 - state.pulse) * 0.9,
    0,
    1,
    GRADIENTS.thinRing.row,
  );
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
  const radius = place.glyphRadius;
  useLayer(gl, picture, layer, radius, 0, 0, radius, place.centreX, place.centreY, 1 / (radius * frame.pixels));
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
    setSolid(gl, glyphs, pass === 0 ? 0xff7e28 : 0xff8e3c, pass === 0 ? light * (1 - flare) : light * flare);
    setUniform1(glyphs, gl, 'halfWidth', GLYPH_STROKE_WIDTH / 2);
    setUniform1(glyphs, gl, 'roundCaps', 1);
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
  setSolid(gl, arc, 0xff8e3c, light * flare);
  const uniforms = arc.program.uniforms;
  if (uniforms.arc) gl.uniform4f(uniforms.arc, 0, 0, 1.75 - 0.95 * flare, 0.07 / 2);
  if (uniforms.arcEnds) gl.uniform4f(uniforms.arcEnds, 0, Math.PI * 2, ARC_PIECES, 1);
  drawShapes(gl, picture, arc, 0, ARC_PIECES);
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
  fillSatelliteDisc(gl, picture, frame, place, 1.15, 0xdc5c20, haloAlpha);
  fillSatelliteDisc(gl, picture, frame, place, 0.7, 0xdc5c20, haloAlpha);
  strokeSatelliteGlyph(gl, picture, frame, place, slot, light, flare);
  fillSatelliteDisc(gl, picture, frame, place, 0.1, 0xff8e3c, light * (0.6 + 0.4 * flare));
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
  drawInnerShells(gl, picture, frame);
  drawLines(gl, picture, frame);
  drawCore(gl, picture, frame);
  drawThinRing(gl, picture, frame);
  drawTruss(gl, picture, frame);
  drawCrescent(gl, picture, frame);
  drawFray(gl, picture, frame);
  drawChips(gl, picture, frame);
  drawAccents(gl, picture, frame);
  drawThinkingPulse(gl, picture, frame);
  drawSatellites(gl, picture, frame);
  gl.disable(STENCIL_TEST);
  gl.disable(DEPTH_TEST);
  gl.depthMask(true);
  gl.bindVertexArray(null);
}
