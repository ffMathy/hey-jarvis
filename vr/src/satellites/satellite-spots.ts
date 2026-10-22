import { type AgentWorkState, orbitPoint, type SatelliteOrbit, satelliteOrbits } from 'hologram';
import type { Vector3Like } from 'hologram/gpu';

/**
 * Where the satellites are in the room: `hologram`'s orbits (`agent-work.ts`, the lifecycle every
 * device shares) round his centre, at {@link ORBIT_RADII} of his radius — outside his halo, inside
 * the panels under him. `hologram3d/satellites.ts` draws them.
 */

/** The orbit's radius, in his radii. */
export const ORBIT_RADII = 1.75;

/** One satellite to draw in the room: where, which glyph, and how lit. */
export interface SatelliteSpot extends Omit<SatelliteOrbit, 'turn' | 'reach'> {
  position: Vector3Like;
}

/**
 * Every satellite at `now` on the XR frame's clock, round `centre` on an orbit of {@link ORBIT_RADII}
 * of his `radius`. The ring keeps the room's axes, so it reads the same from wherever sir stands.
 */
export function satelliteSpots(
  state: AgentWorkState,
  now: number,
  centre: Vector3Like,
  radius: number,
): SatelliteSpot[] {
  const scale = ORBIT_RADII * radius;
  return satelliteOrbits(state, now).map(({ turn, reach, ...drawn }) => {
    const { across, up, towards } = orbitPoint({ turn, reach }, now);
    return {
      ...drawn,
      position: { x: centre.x + across * scale, y: centre.y + up * scale, z: centre.z + towards * scale },
    };
  });
}
