import { containsPoint, type FloorPoint } from './floor-polygon';
import { clearanceAt, firstBlockedFraction } from './occupancy-grid';
import type { LevelArea, RoomScene } from './room-scene';
import type { DepthProbe, Placement, PlacementLevel, PlacementRequest, Vector3Like } from './types';

/**
 * Choosing where Jarvis appears: somewhere in front of the user, in the same room, with space
 * around him and nothing between him and their eyes.
 *
 * Candidates are laid out in a cone ahead of the head, the ones that break a hard rule are
 * dropped, the rest are scored, and the best one with a clear line of sight wins. When no
 * candidate survives, the rules are relaxed one step at a time — less room around him, then a
 * smaller him, then a wider cone with an arrow pointing to him — and when even that fails he
 * goes small, straight ahead, no further than what is known to be there.
 */

/** His radius when drawn at full size, metres (the drawing reaches 1.9 times it). */
export const RESTING_RADIUS = 0.22;

/** His radius when squeezed into a cramped spot, metres. */
export const SQUEEZED_RADIUS = 0.13;

/** The distance he is happiest at, metres from the head along the floor. */
const PREFERRED_DISTANCE = 1.6;

/** Radius of the user's body around the head, seen from above, that he must stay clear of. */
const BODY_RADIUS = 0.35;

/** Spacing of the candidates: by distance, by angle, and over table tops. */
const DISTANCE_STEP = 0.1;
const ANGLE_STEP = (5 * Math.PI) / 180;
const SURFACE_STEP = 0.15;

/** Heights tried either side of the comfortable one, and the band above the floor they must stay in. */
const HEIGHT_OFFSETS = [0, -0.2, 0.2, -0.4, 0.4];
const LOWEST_ABOVE_FLOOR = 0.8;
const HIGHEST_ABOVE_FLOOR = 2;

/** Gaps between his lowest point and a table top, tried in turn when he hovers above one. */
const SURFACE_LIFTS = [0.15, 0.25, 0.35];

/**
 * Where a line of sight starts, metres out from the eyes: close to the head there can be a
 * wall the user leans on or a shelf beside them, which blocks nothing they can see past.
 */
const SIGHT_START = 0.2;

/** Depth hits nearer than this are the user's own hands and arms, not the room. */
const NEAREST_DEPTH_HIT = 0.4;

/** The last resort: this far ahead, pulled in to stay this far in front of anything in the way, but never nearer than that. */
const FALLBACK_DISTANCE = 1.2;
const FALLBACK_GAP = 0.3;
const FALLBACK_NEAREST = 0.45;
/** Depth probes within this angle of straight ahead can pull the last resort in. */
const FALLBACK_PROBE_COSINE = Math.cos((20 * Math.PI) / 180);

/** How strongly each preference counts in a candidate's score. */
const SCORE_WEIGHTS = {
  /** Per metre of clearance, up to the metre after which more room makes no difference. */
  clearance: 1,
  /** Per metre away from the preferred distance. */
  distance: 0.8,
  /** At the edge of the comfortable cone. */
  angle: 0.5,
  /** Per metre above or below the comfortable height. */
  height: 0.8,
  /** Standing exactly where he stood last time. */
  previous: 0.6,
};
const CLEARANCE_SATURATION = 1;
const COMFORTABLE_HALF_ANGLE = (35 * Math.PI) / 180;
const WIDE_HALF_ANGLE = (60 * Math.PI) / 180;
/** Within this distance of where he stood last time, a candidate gets some of the bonus for staying. */
const PREVIOUS_REACH = 0.6;

/** One step of the relax chain: what a spot must satisfy at this level. */
interface LevelRules {
  level: PlacementLevel;
  radius: number;
  /** Free space needed around his centre, metres. */
  clearance: number;
  nearest: number;
  farthest: number;
  halfAngle: number;
  /** Whether spots hovering above a table or desk are tried. */
  aboveSurfaces: boolean;
}

const FULL_SIZE = { radius: RESTING_RADIUS, nearest: 0.9, farthest: 2.6, aboveSurfaces: false };
const SQUEEZED = { radius: SQUEEZED_RADIUS, clearance: 0.3, nearest: 0.6, farthest: 2.6, aboveSurfaces: true };

/** The relax chain, strictest first. `wide` is tried at full size first and squeezed second. */
const LEVELS: LevelRules[] = [
  { level: 'full', ...FULL_SIZE, clearance: 0.5, halfAngle: COMFORTABLE_HALF_ANGLE },
  { level: 'tight', ...FULL_SIZE, clearance: 0.35, halfAngle: COMFORTABLE_HALF_ANGLE },
  { level: 'small', ...SQUEEZED, halfAngle: COMFORTABLE_HALF_ANGLE },
  { level: 'wide', ...FULL_SIZE, clearance: 0.35, halfAngle: WIDE_HALF_ANGLE },
  { level: 'wide', ...SQUEEZED, halfAngle: WIDE_HALF_ANGLE },
];

/** The request, worked out against the room: which way is ahead, which room the user is in, what height suits them. */
interface Bearing {
  head: Vector3Like;
  /** Ahead along the floor, and to the right of it; unit x/z. */
  forward: FloorPoint;
  right: FloorPoint;
  /** The outline he must stay inside, or null when the room's extent is unknown. */
  room: FloorPoint[] | null;
  floorHeight: number;
  /** The height he is placed at by preference. */
  eyeLevel: number;
  previous: Vector3Like | null;
  probes: DepthProbe[];
}

interface Candidate {
  position: Vector3Like;
  distance: number;
  azimuth: number;
  clearance: number;
  score: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * The outline of the room the head is in: the floor under it, else the ceiling over it, else
 * the walls around it — or null, and he may go anywhere the grid allows.
 */
function roomAround(
  scene: RoomScene,
  head: FloorPoint,
): { outline: FloorPoint[] | null; floor: LevelArea | undefined } {
  const floor = scene.floors.find((area) => containsPoint(area.outline, head));
  if (floor !== undefined) return { outline: floor.outline, floor };
  const ceiling = scene.ceilings.find((area) => containsPoint(area.outline, head));
  if (ceiling !== undefined) return { outline: ceiling.outline, floor };
  const walled = scene.wallOutline.length > 0 && containsPoint(scene.wallOutline, head);
  return { outline: walled ? scene.wallOutline : null, floor };
}

function bearingOf(scene: RoomScene, request: PlacementRequest): Bearing {
  const { head } = request;
  const along = Math.hypot(request.forward.x, request.forward.z);
  // Straight up or down has no direction along the floor; the app hands in its own idea of
  // ahead for that case, so this only keeps the arithmetic finite.
  const forward = along > 1e-4 ? { x: request.forward.x / along, z: request.forward.z / along } : { x: 0, z: -1 };
  const { outline, floor } = roomAround(scene, head);
  const floorBelow = scene.floors
    .filter((area) => area.height < head.y)
    .sort((lower, higher) => higher.height - lower.height)[0];
  const floorHeight = floor?.height ?? floorBelow?.height ?? 0;
  const samePlace = request.previousEpoch === undefined || request.previousEpoch === scene.epoch;
  return {
    head,
    forward,
    right: { x: -forward.z, z: forward.x },
    room: outline,
    floorHeight,
    eyeLevel: floorHeight + clamp(head.y - floorHeight - 0.15, 1.1, 1.6),
    previous: samePlace ? (request.previous ?? null) : null,
    probes: request.depthProbes.filter((probe) => probe.distance >= NEAREST_DEPTH_HIT),
  };
}

/** Evenly spaced values from `low` to `high`, both included, `step` apart (the last step may be shorter). */
function spaced(low: number, high: number, step: number): number[] {
  const values: number[] = [];
  for (let value = low; value < high - 1e-9; value += step) values.push(value);
  values.push(high);
  return values;
}

/** The generic candidates: a fan of angles, distances and heights ahead of the head. */
function* fanPositions(bearing: Bearing, rules: LevelRules): Generator<Vector3Like> {
  const { head, forward, right, eyeLevel, floorHeight } = bearing;
  const heights = HEIGHT_OFFSETS.map((offset) => eyeLevel + offset).filter(
    (height) => height >= floorHeight + LOWEST_ABOVE_FLOOR && height <= floorHeight + HIGHEST_ABOVE_FLOOR,
  );
  const sideSteps = Math.floor(rules.halfAngle / ANGLE_STEP + 1e-9);
  for (let side = -sideSteps; side <= sideSteps; side++) {
    const angle = side * ANGLE_STEP;
    const directionX = forward.x * Math.cos(angle) + right.x * Math.sin(angle);
    const directionZ = forward.z * Math.cos(angle) + right.z * Math.sin(angle);
    for (const distance of spaced(rules.nearest, rules.farthest, DISTANCE_STEP)) {
      for (const height of heights) {
        yield { x: head.x + directionX * distance, y: height, z: head.z + directionZ * distance };
      }
    }
  }
}

/** Spots hovering over table and desk tops, a few gaps above each. */
function* surfacePositions(surfaces: LevelArea[], radius: number): Generator<Vector3Like> {
  for (const { outline, height } of surfaces) {
    const acrossX = outline.map((point) => point.x);
    const acrossZ = outline.map((point) => point.z);
    for (const x of spaced(Math.min(...acrossX), Math.max(...acrossX), SURFACE_STEP)) {
      for (const z of spaced(Math.min(...acrossZ), Math.max(...acrossZ), SURFACE_STEP)) {
        if (!containsPoint(outline, { x, z })) continue;
        for (const lift of SURFACE_LIFTS) yield { x, y: height + radius + lift, z };
      }
    }
  }
}

function* candidatePositions(scene: RoomScene, bearing: Bearing, rules: LevelRules): Generator<Vector3Like> {
  yield* fanPositions(bearing, rules);
  if (rules.aboveSurfaces) yield* surfacePositions(scene.surfaces, rules.radius);
  if (bearing.previous !== null) yield bearing.previous;
}

/** Whether a depth probe says there is a live surface in front of, or too close to, the spot. */
function probeBlocks(probe: DepthProbe, bearing: Bearing, position: Vector3Like, clearance: number): boolean {
  const offsetX = position.x - bearing.head.x;
  const offsetY = position.y - bearing.head.y;
  const offsetZ = position.z - bearing.head.z;
  const along = offsetX * probe.direction.x + offsetY * probe.direction.y + offsetZ * probe.direction.z;
  if (along <= 0) return false;
  const acrossSquared = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ - along * along;
  // The ray only says something about the spot if it passes through the space he needs.
  if (acrossSquared >= clearance * clearance) return false;
  return probe.distance < along + Math.sqrt(clearance * clearance - acrossSquared);
}

/** The spot as a candidate, or null when it breaks a rule that needs no line of sight to check. */
function assess(scene: RoomScene, bearing: Bearing, rules: LevelRules, position: Vector3Like): Candidate | null {
  const offsetX = position.x - bearing.head.x;
  const offsetZ = position.z - bearing.head.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance < BODY_RADIUS + rules.radius || distance < rules.nearest - 1e-6 || distance > rules.farthest + 1e-6) {
    return null;
  }
  const azimuth = Math.atan2(
    offsetX * bearing.right.x + offsetZ * bearing.right.z,
    offsetX * bearing.forward.x + offsetZ * bearing.forward.z,
  );
  if (Math.abs(azimuth) > rules.halfAngle + 1e-6) return null;
  if (bearing.room !== null && !containsPoint(bearing.room, position)) return null;
  if (bearing.probes.some((probe) => probeBlocks(probe, bearing, position, rules.clearance))) return null;
  const clearance =
    scene.grid === null ? Number.POSITIVE_INFINITY : clearanceAt(scene.grid, position, scene.occupiedCells);
  if (clearance < rules.clearance) return null;
  return { position, distance, azimuth, clearance, score: scoreOf(bearing, position, distance, azimuth, clearance) };
}

function scoreOf(
  bearing: Bearing,
  position: Vector3Like,
  distance: number,
  azimuth: number,
  clearance: number,
): number {
  let score =
    SCORE_WEIGHTS.clearance * Math.min(clearance, CLEARANCE_SATURATION) -
    SCORE_WEIGHTS.distance * Math.abs(distance - PREFERRED_DISTANCE) -
    SCORE_WEIGHTS.angle * (Math.abs(azimuth) / COMFORTABLE_HALF_ANGLE) -
    SCORE_WEIGHTS.height * Math.abs(position.y - bearing.eyeLevel);
  if (bearing.previous !== null) {
    const { previous } = bearing;
    const moved = Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z);
    score += SCORE_WEIGHTS.previous * Math.max(0, 1 - moved / PREVIOUS_REACH);
  }
  return score;
}

/** Whether nothing the grid holds is between the eyes and `position`. */
function inSight(scene: RoomScene, head: Vector3Like, position: Vector3Like): boolean {
  if (scene.grid === null) return true;
  const length = Math.hypot(position.x - head.x, position.y - head.y, position.z - head.z);
  if (length <= SIGHT_START) return true;
  const start = SIGHT_START / length;
  const from = {
    x: head.x + (position.x - head.x) * start,
    y: head.y + (position.y - head.y) * start,
    z: head.z + (position.z - head.z) * start,
  };
  return firstBlockedFraction(scene.grid, from, position) === Number.POSITIVE_INFINITY;
}

/** The best spot this level allows, or null. Line of sight is the dearest check, so it runs best-first. */
function bestAt(scene: RoomScene, bearing: Bearing, rules: LevelRules): Candidate | null {
  const candidates: Candidate[] = [];
  for (const position of candidatePositions(scene, bearing, rules)) {
    const candidate = assess(scene, bearing, rules, position);
    if (candidate !== null) candidates.push(candidate);
  }
  candidates.sort((worse, better) => better.score - worse.score);
  return candidates.find((candidate) => inSight(scene, bearing.head, candidate.position)) ?? null;
}

/** How far ahead, along the floor at his height, the first thing in the way is — from the grid and the depth probes. */
function distanceToObstacleAhead(scene: RoomScene, bearing: Bearing): number {
  const { head, forward, eyeLevel } = bearing;
  let nearest = Number.POSITIVE_INFINITY;
  if (scene.grid !== null) {
    const reach = FALLBACK_DISTANCE + FALLBACK_GAP;
    const from = { x: head.x + forward.x * SIGHT_START, y: eyeLevel, z: head.z + forward.z * SIGHT_START };
    const to = { x: head.x + forward.x * reach, y: eyeLevel, z: head.z + forward.z * reach };
    const fraction = firstBlockedFraction(scene.grid, from, to);
    if (fraction !== Number.POSITIVE_INFINITY) nearest = SIGHT_START + fraction * (reach - SIGHT_START);
  }
  for (const probe of bearing.probes) {
    const cosine = probe.direction.x * forward.x + probe.direction.z * forward.z;
    if (cosine >= FALLBACK_PROBE_COSINE) nearest = Math.min(nearest, probe.distance * cosine);
  }
  return nearest;
}

/** Small, straight ahead, and in front of anything known to be there. */
function lastResort(scene: RoomScene, bearing: Bearing): Placement {
  const { head, forward, eyeLevel } = bearing;
  const distance = clamp(distanceToObstacleAhead(scene, bearing) - FALLBACK_GAP, FALLBACK_NEAREST, FALLBACK_DISTANCE);
  const position = { x: head.x + forward.x * distance, y: eyeLevel, z: head.z + forward.z * distance };
  return {
    position,
    radius: SQUEEZED_RADIUS,
    level: 'fallback',
    clearance: scene.grid === null ? Number.POSITIVE_INFINITY : clearanceAt(scene.grid, position, scene.occupiedCells),
    needsPointer: false,
    epoch: scene.epoch,
  };
}

/**
 * Where to put him for `request` in `scene`.
 *
 * With nothing known about the room at all, it goes straight to the last resort: a full-size
 * hologram 1.6 m ahead of someone at a desk facing a wall a metre away would be inside the wall.
 */
export function placeInRoom(scene: RoomScene, request: PlacementRequest): Placement {
  const bearing = bearingOf(scene, request);
  if (scene.grid === null) return lastResort(scene, bearing);
  for (const rules of LEVELS) {
    const best = bestAt(scene, bearing, rules);
    if (best !== null) {
      return {
        position: { x: best.position.x, y: best.position.y, z: best.position.z },
        radius: rules.radius,
        level: rules.level,
        clearance: best.clearance,
        // Only the wide cone reaches past the comfortable one, but the angle is what decides.
        needsPointer: Math.abs(best.azimuth) > COMFORTABLE_HALF_ANGLE + 1e-6,
        epoch: scene.epoch,
      };
    }
  }
  return lastResort(scene, bearing);
}
