import { BlendMode, PaintStyle, StrokeCap, StrokeJoin } from '@shopify/react-native-skia/lib/module/skia/types';
import { orbitPoint, type SatelliteOrbit } from './agent-work';
import { type HologramCanvas, type HologramSkia, SPHERE_FRACTION } from './hologram-drawing';

/**
 * The satellites on a screen: the phone's, and its web build's. Each agent a request is using goes
 * round the sphere as a small glyph (`agent-work.ts` says which, where and how lit) — the same eight
 * glyphs, in the same order, as the headset draws in the room (`vr/src/hologram3d/satellites.ts`): a
 * sun for the weather, a page for the calendar, an envelope for email, a hexagon for the house, a
 * triangle for shopping, a tick for the to-do list, angle brackets for coding, and a lens for web
 * research and any agent not listed.
 *
 * Drawn in his colours and blended as he is (Screen), over him, after `drawHologram` in the same
 * picture: a glyph, a hot dot at its middle, a little halo round it, a ring flaring out from it on
 * each tool it calls, and a slow pulse while it waits on sir. The ring is tilted, so a satellite is
 * a little larger and brighter passing in front of him and smaller and dimmer passing behind.
 *
 * It keeps the main entry's rule (see `hologram/AGENTS.md`): Skia arrives as an argument, its enums
 * as plain values, and the drawing runs as a worklet on the phone's UI thread, in CanvasKit in a
 * browser, and headless in the specs.
 */

/** The orbit's radius, in his radii: inside the canvas, which ends at 1 / (2 × SPHERE_FRACTION). */
export const SCREEN_ORBIT_RADII = 1.55;

/** A glyph's radius, in his radii. */
export const SCREEN_GLYPH_RADII = 0.13;

/** How long the pulse of one waiting on sir takes. */
export const ASKING_PULSE_SECONDS = 1.6;

/** How much smaller and dimmer a satellite is at the far side of the ring than at the near side. */
const FAR_SIDE_SCALE = 0.8;
const FAR_SIDE_LIGHT = 0.45;

/** Each glyph as an SVG path in glyph radii, y down — the headset's distance fields, as strokes. */
const GLYPH_PATHS = [
  // The weather: a sun, a ring with eight rays.
  `${circle(0, 0, 0.42)} ${Array.from({ length: 8 }, (_, ray) => {
    const angle = (ray * Math.PI) / 4;
    return `M ${0.66 * Math.cos(angle)} ${0.66 * Math.sin(angle)} L ${0.92 * Math.cos(angle)} ${0.92 * Math.sin(angle)}`;
  }).join(' ')}`,
  // The calendar: a page with its binding along the top.
  'M -0.62 -0.55 L 0.62 -0.55 L 0.62 0.55 L -0.62 0.55 Z M -0.62 -0.25 L 0.62 -0.25',
  // Email: an envelope, its flap folded down to the middle.
  'M -0.7 -0.48 L 0.7 -0.48 L 0.7 0.48 L -0.7 0.48 Z M -0.7 -0.48 L 0 0 L 0.7 -0.48',
  // The house: a hexagon.
  `${Array.from({ length: 6 }, (_, corner) => {
    const angle = Math.PI / 6 + (corner * Math.PI) / 3;
    return `${corner === 0 ? 'M' : 'L'} ${0.7 * Math.cos(angle)} ${0.7 * Math.sin(angle)}`;
  }).join(' ')} Z`,
  // Shopping: a triangle.
  'M 0 -0.66 L 0.64 0.44 L -0.64 0.44 Z',
  // To-do: a tick.
  'M -0.6 0 L -0.15 0.45 L 0.65 -0.5',
  // Coding: angle brackets.
  'M -0.25 -0.55 L -0.72 0 L -0.25 0.55 M 0.25 -0.55 L 0.72 0 L 0.25 0.55',
  // Web research, and any agent not listed: a lens with its handle.
  `${circle(-0.12, -0.12, 0.42)} M 0.18 0.18 L 0.66 0.66`,
];

function circle(centreX: number, centreY: number, radius: number): string {
  return `M ${centreX + radius} ${centreY} A ${radius} ${radius} 0 1 0 ${centreX - radius} ${centreY} A ${radius} ${radius} 0 1 0 ${centreX + radius} ${centreY} Z`;
}

/** Made once per view: the glyphs' paths and the paints, which a frame only re-tints. */
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
    glyphs: GLYPH_PATHS.map((path) => {
      const made = Skia.Path.MakeFromSVGString(path);
      if (made === null) throw new Error(`A satellite glyph is not a path: ${path}`);
      return made;
    }),
    glyphStroke: paint('#ff7e28', PaintStyle.Stroke, 0.15),
    flareGlyphStroke: paint('#ff8e3c', PaintStyle.Stroke, 0.15),
    flareRing: paint('#ff8e3c', PaintStyle.Stroke, 0.07),
    core: paint('#ff8e3c', PaintStyle.Fill),
    halo: paint('#dc5c20', PaintStyle.Fill),
  };
}

export type SatelliteResources = ReturnType<typeof createSatelliteResources>;

/**
 * Draws `orbits` round the sphere of a `size` square canvas, at `time` seconds on the drawing's own
 * clock — the frame clock's, so they go round as smoothly as he turns.
 */
export function drawSatellites(
  canvas: HologramCanvas,
  size: number,
  time: number,
  orbits: readonly SatelliteOrbit[],
  resources: SatelliteResources,
) {
  'worklet';
  if (orbits.length === 0) return;
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

    resources.halo.setAlphaf(Math.min(1, 0.16 * light * (1 + 1.5 * orbit.flare)));
    canvas.drawCircle(0, 0, 1.15, resources.halo);
    canvas.drawCircle(0, 0, 0.7, resources.halo);

    const glyph = resources.glyphs[orbit.glyph] ?? resources.glyphs[resources.glyphs.length - 1];
    if (glyph !== undefined) {
      resources.glyphStroke.setAlphaf(light * (1 - orbit.flare));
      canvas.drawPath(glyph, resources.glyphStroke);
      if (orbit.flare > 0) {
        resources.flareGlyphStroke.setAlphaf(light * orbit.flare);
        canvas.drawPath(glyph, resources.flareGlyphStroke);
      }
    }

    resources.core.setAlphaf(light * (0.6 + 0.4 * orbit.flare));
    canvas.drawCircle(0, 0, 0.1, resources.core);

    if (orbit.flare > 0) {
      resources.flareRing.setAlphaf(light * orbit.flare);
      canvas.drawCircle(0, 0, 1.75 - 0.95 * orbit.flare, resources.flareRing);
    }
    canvas.restore();
  }
}
