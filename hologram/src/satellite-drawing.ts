import { BlendMode, PaintStyle, StrokeCap, StrokeJoin } from '@shopify/react-native-skia/lib/module/skia/types';
import { orbitPoint, PLAIN_RING_GLYPH, type SatelliteOrbit } from './agent-work';
import { type HologramCanvas, type HologramSkia, SPHERE_FRACTION } from './hologram-drawing';

/**
 * The satellites on a screen: the phone's, and its web build's. Each agent a request is using goes
 * round the sphere as a small glyph (`agent-work.ts` says which, where and how lit) — the glyph its
 * vertical on the server declares, sent with every `agentActivity` as an SVG path, the same path the
 * headset draws in the room (`vr/src/hologram3d/satellites.ts`).
 *
 * Drawn in his colours and blended as he is (Screen), over him, after `drawHologram` in the same
 * picture: a glyph, a hot dot at its middle, a little halo round it, a ring flaring out from it on
 * each tool it calls, and a slow pulse while it waits on sir. The ring is tilted, so a satellite is
 * a little larger and brighter passing in front of him and smaller and dimmer passing behind.
 *
 * A glyph is made into a path as it is drawn, every frame: a frame draws a handful, and a path cached
 * across frames would have to be kept somewhere a worklet may write, which on a phone it may not.
 * The paths a frame made are handed back, for a renderer over CanvasKit to delete once its picture
 * is recorded, as it does the drawing's own (`createReleasableHologramResources`).
 *
 * It keeps the main entry's rule (see `hologram/AGENTS.md`): Skia arrives as an argument, its enums
 * as plain values, and the drawing runs as a worklet on the phone's UI thread, in CanvasKit in a
 * browser, and headless in the specs.
 */

/**
 * The orbit's radius, in his radii: inside what a screen shows of the canvas, not just inside the
 * canvas. The phone's whole-screen canvas is drawn 1.35 times wider than the screen so his chips are
 * never cut off by its edge (`CHIP_HEADROOM` in `mobile/src/hologram-size.ts`), which leaves 1.37 of
 * his radii either side of him on the screen: this, and a glyph, fit in it.
 */
export const SCREEN_ORBIT_RADII = 1.22;

/** A glyph's radius, in his radii. */
export const SCREEN_GLYPH_RADII = 0.13;

/** How long the pulse of one waiting on sir takes. */
export const ASKING_PULSE_SECONDS = 1.6;

/** How wide a glyph's strokes are, in glyph radii: the same on every device. */
export const GLYPH_STROKE_WIDTH = 0.15;

/** How much smaller and dimmer a satellite is at the far side of the ring than at the near side. */
const FAR_SIDE_SCALE = 0.8;
const FAR_SIDE_LIGHT = 0.45;

/** Made once per view: the paints, which a frame only re-tints. */
export function createSatelliteResources(Skia: HologramSkia) {
  const paint = (colour: string, style: PaintStyle, width = 0) => {
    const made = Skia.Paint();
    made.setAntiAlias(true);
    made.setStyle(style);
    made.setColor(Skia.Color(colour));
    made.setBlendMode(BlendMode.Screen);
    made.setStrokeWidth(width);
    made.setStrokeCap(StrokeCap.Round);
    made.setStrokeJoin(StrokeJoin.Round);
    return made;
  };
  return {
    glyphStroke: paint('#ff7e28', PaintStyle.Stroke, GLYPH_STROKE_WIDTH),
    flareGlyphStroke: paint('#ff8e3c', PaintStyle.Stroke, GLYPH_STROKE_WIDTH),
    flareRing: paint('#ff8e3c', PaintStyle.Stroke, 0.07),
    core: paint('#ff8e3c', PaintStyle.Fill),
    halo: paint('#dc5c20', PaintStyle.Fill),
  };
}

export type SatelliteResources = ReturnType<typeof createSatelliteResources>;

/** A path made for a frame, which a renderer over CanvasKit deletes once the frame is recorded. */
export type MadeGlyphPath = ReturnType<HologramSkia['Path']['MakeFromSVGString']>;

/**
 * Draws one satellite centred on 0,0 of `canvas` at a radius of 1 — its halo, glyph, dot and flare —
 * `light` bright and `flare` into a tool call. Returns the path it made of the glyph.
 */
export function drawSatelliteGlyph(
  canvas: HologramCanvas,
  Skia: HologramSkia,
  glyph: string,
  light: number,
  flare: number,
  resources: SatelliteResources,
): MadeGlyphPath {
  'worklet';
  resources.halo.setAlphaf(Math.min(1, 0.16 * light * (1 + 1.5 * flare)));
  canvas.drawCircle(0, 0, 1.15, resources.halo);
  canvas.drawCircle(0, 0, 0.7, resources.halo);

  // A path the server sent that Skia cannot read is a plain ring: it is still an agent at work.
  const path = Skia.Path.MakeFromSVGString(glyph) ?? Skia.Path.MakeFromSVGString(PLAIN_RING_GLYPH);
  if (path !== null) {
    resources.glyphStroke.setAlphaf(light * (1 - flare));
    canvas.drawPath(path, resources.glyphStroke);
    if (flare > 0) {
      resources.flareGlyphStroke.setAlphaf(light * flare);
      canvas.drawPath(path, resources.flareGlyphStroke);
    }
  }

  resources.core.setAlphaf(light * (0.6 + 0.4 * flare));
  canvas.drawCircle(0, 0, 0.1, resources.core);

  if (flare > 0) {
    resources.flareRing.setAlphaf(light * flare);
    canvas.drawCircle(0, 0, 1.75 - 0.95 * flare, resources.flareRing);
  }
  return path;
}

/**
 * Draws `orbits` round the sphere of a `size` square canvas, at `time` seconds on the drawing's own
 * clock — the frame clock's, so they go round as smoothly as he turns. Returns the paths it made.
 */
export function drawSatellites(
  canvas: HologramCanvas,
  Skia: HologramSkia,
  size: number,
  time: number,
  orbits: readonly SatelliteOrbit[],
  resources: SatelliteResources,
): MadeGlyphPath[] {
  'worklet';
  const made: MadeGlyphPath[] = [];
  const radius = size * SPHERE_FRACTION;
  const pulse = 0.5 + 0.5 * Math.cos((2 * Math.PI * time) / ASKING_PULSE_SECONDS);
  for (let index = 0; index < orbits.length; index++) {
    const orbit = orbits[index];
    if (orbit === undefined || orbit.level <= 0) continue;
    const { across, up, towards } = orbitPoint(orbit, time);
    // 0 at the far side of the ring, 1 at the near side.
    const nearness = 0.5 + 0.5 * Math.max(-1, Math.min(1, towards));
    const light =
      orbit.level * (FAR_SIDE_LIGHT + (1 - FAR_SIDE_LIGHT) * nearness) * (orbit.asking ? 0.55 + 0.45 * pulse : 1);
    const glyphRadius = radius * SCREEN_GLYPH_RADII * (FAR_SIDE_SCALE + (1 - FAR_SIDE_SCALE) * nearness);
    canvas.save();
    canvas.translate(size / 2 + across * radius * SCREEN_ORBIT_RADII, size / 2 - up * radius * SCREEN_ORBIT_RADII);
    canvas.scale(glyphRadius, glyphRadius);
    made.push(drawSatelliteGlyph(canvas, Skia, orbit.glyph, light, orbit.flare, resources));
    canvas.restore();
  }
  return made;
}
