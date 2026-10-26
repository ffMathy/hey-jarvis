import { orbitPoint, type SatelliteOrbit } from './agent-work';

/**
 * The satellites on a screen: the phone's, and its web build's. Each agent a request is using goes
 * round the sphere as a small glyph (`agent-work.ts` says which, where and how lit) — the glyph its
 * vertical on the server declares, sent with every `agentActivity` as an SVG path, the same path the
 * headset draws in the room (`vr/src/hologram3d/satellites.ts`).
 *
 * Drawn in his colours and blended as he is (Screen), over him, in the same picture
 * (`gpu/gpu-picture.ts`): a glyph, a hot dot at its middle, a little halo round it, a ring flaring
 * out from it on each tool it calls, and a slow pulse while it waits on sir. The ring is tilted, so
 * a satellite is a little larger and brighter passing in front of him and smaller and dimmer passing
 * behind. This is where on the screen each one is and how lit; the drawing is the GPU's.
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

/** Where a satellite is on the screen, in his radii from his centre (y up), how big and how lit. */
export interface ScreenSatellite {
  across: number;
  up: number;
  /** Its glyph's radius, in his radii. */
  glyphRadii: number;
  light: number;
}

/**
 * Where `orbit` puts its satellite at `time` seconds on the drawing's own clock — the frame clock's,
 * so they go round as smoothly as he turns — or undefined while it is not lit at all.
 */
export function screenSatellite(orbit: SatelliteOrbit, time: number): ScreenSatellite | undefined {
  'worklet';
  if (orbit.level <= 0) return undefined;
  const { across, up, towards } = orbitPoint(orbit, time);
  // 0 at the far side of the ring, 1 at the near side.
  const nearness = 0.5 + 0.5 * Math.max(-1, Math.min(1, towards));
  const pulse = 0.5 + 0.5 * Math.cos((2 * Math.PI * time) / ASKING_PULSE_SECONDS);
  return {
    across: across * SCREEN_ORBIT_RADII,
    up: up * SCREEN_ORBIT_RADII,
    glyphRadii: SCREEN_GLYPH_RADII * (FAR_SIDE_SCALE + (1 - FAR_SIDE_SCALE) * nearness),
    light: orbit.level * (FAR_SIDE_LIGHT + (1 - FAR_SIDE_LIGHT) * nearness) * (orbit.asking ? 0.55 + 0.45 * pulse : 1),
  };
}
