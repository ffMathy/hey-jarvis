import { describe, expect, it } from 'bun:test';
import { orbitPoint, PLAIN_RING_GLYPH, type SatelliteOrbit } from './agent-work';
import { SPHERE_FRACTION } from './hologram-drawing';
import { ASKING_PULSE_SECONDS, SCREEN_GLYPH_RADII, SCREEN_ORBIT_RADII, screenSatellite } from './satellite-drawing';

/**
 * Where each satellite is on a screen and how lit. What they look like drawn is the GPU's, and the
 * headset's browser tests say it, on the very picture the apps draw
 * (`vr/tests/e2e/hologram-picture-behaviour.spec.ts`).
 */

/** The phone's whole-screen canvas is drawn this much wider than the screen (`CHIP_HEADROOM`). */
const CANVAS_OVER_SCREEN = 1.35;
/** His radius at rest, in halves of the drawing's square. */
const SPHERE_IN_HALF_SQUARES = SPHERE_FRACTION * 2;

function orbit(overrides: Partial<SatelliteOrbit> = {}): SatelliteOrbit {
  return { glyph: PLAIN_RING_GLYPH, level: 1, flare: 0, asking: false, turn: 0, reach: 1, ...overrides };
}

function shown(drawn: SatelliteOrbit, time = 0) {
  const satellite = screenSatellite(drawn, time);
  if (satellite === undefined) throw new Error('the satellite was not shown');
  return satellite;
}

describe('the satellites on a screen', () => {
  it('fit inside the canvas, glyph and flare included, wherever they are on the ring', () => {
    expect(SPHERE_IN_HALF_SQUARES * (SCREEN_ORBIT_RADII + SCREEN_GLYPH_RADII * 1.75)).toBeLessThan(1);
  });

  it('fit on the screen of a phone whose canvas is drawn wider than it, glyph included', () => {
    expect(SPHERE_IN_HALF_SQUARES * (SCREEN_ORBIT_RADII + SCREEN_GLYPH_RADII)).toBeLessThan(1 / CANVAS_OVER_SCREEN);
  });

  it('are where their orbit says, on the ring round him', () => {
    for (const turn of [0, 0.2, 0.5, 0.85]) {
      for (const time of [0, 1.2, 7.5]) {
        const drawn = orbit({ turn });
        const { across, up } = orbitPoint(drawn, time);
        const satellite = shown(drawn, time);

        expect(satellite.across).toBeCloseTo(across * SCREEN_ORBIT_RADII, 12);
        expect(satellite.up).toBeCloseTo(up * SCREEN_ORBIT_RADII, 12);
        // never at his centre
        expect(Math.hypot(satellite.across, satellite.up)).toBeGreaterThan(SCREEN_GLYPH_RADII);
      }
    }
  });

  it('are smaller and dimmer passing behind him than in front of him, and lower in front', () => {
    const front = shown(orbit({ turn: 0.25 }));
    const behind = shown(orbit({ turn: 0.75 }));

    expect(front.light).toBeGreaterThan(behind.light);
    expect(front.glyphRadii).toBeGreaterThan(behind.glyphRadii);
    expect(front.up).toBeLessThan(behind.up);
  });

  it('pulse while they wait on sir, and are as lit as they are when they do not', () => {
    const lights = Array.from({ length: 16 }, (_, step) => {
      const time = (step / 16) * ASKING_PULSE_SECONDS;
      return shown(orbit({ asking: true, turn: 0.25 }), time).light / shown(orbit({ turn: 0.25 }), time).light;
    });

    expect(Math.max(...lights)).toBeCloseTo(1, 2);
    expect(Math.min(...lights)).toBeLessThan(0.6);
  });

  it('are lit by their level, and not shown once they have gone out', () => {
    expect(shown(orbit({ level: 0.5, turn: 0.25 })).light).toBeCloseTo(shown(orbit({ turn: 0.25 })).light / 2, 12);
    expect(screenSatellite(orbit({ level: 0 }), 0)).toBeUndefined();
  });
});
