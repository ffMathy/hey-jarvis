/**
 * What the placement code knows about the room, and what it answers.
 *
 * Everything here is plain data — numbers, arrays and typed arrays, no class instances and
 * nothing from WebXR — so a snapshot taken in an XR frame can be posted to the placement worker
 * as it is, and the tests can build rooms by hand. Positions are in the session's `local-floor`
 * reference space: metres, y up, the floor at y = 0 near where the session started.
 */

/** A point or a direction, in metres. */
export interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

/** A flat surface from the headset's Space Setup: a wall, the floor, a table top and so on. */
export interface ScenePlane {
  /** Semantic label ('floor', 'wall', 'table', …) or '' when absent. */
  label: string;
  /** 4×4 column-major pose of planeSpace in the reference space. */
  pose: Float32Array;
  /** Polygon in planeSpace (y = 0, +y = normal). */
  polygon: Vector3Like[];
}

/** A triangle mesh: a piece of furniture as a box, or the whole room as one scanned mesh. */
export interface SceneMesh {
  label: string;
  /** 4×4 column-major pose of meshSpace in the reference space. */
  pose: Float32Array;
  /** x, y, z per vertex, in meshSpace. */
  vertices: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
}

export interface RoomSnapshot {
  planes: ScenePlane[];
  meshes: SceneMesh[];
  /** Bumped when the reference space resets (recentre) — invalidates every cached pose. */
  epoch: number;
}

export interface DepthProbe {
  /** Unit direction from the head, reference space. */
  direction: Vector3Like;
  /** Distance to the nearest surface along it, metres (live depth hit-test). */
  distance: number;
}

export interface PlacementRequest {
  head: Vector3Like;
  /** Unit forward of the gaze or of the controller ray that summoned him. */
  forward: Vector3Like;
  depthProbes: DepthProbe[];
  /** Where he stood last time, so a new spot does not jump for a marginally better score. */
  previous?: Vector3Like;
  /**
   * The epoch `previous` was placed in. When it is given and differs from the room's, the
   * reference space has been reset since, `previous` is a point in a frame that no longer
   * exists, and it is ignored.
   */
  previousEpoch?: number;
}

/**
 * How far the search had to relax its rules to find a spot, strictest first.
 *
 * - `full`: plenty of room, comfortably in view.
 * - `tight`: in view, but closer to things than he would like.
 * - `small`: drawn smaller, so he fits somewhere cramped, such as above a desk.
 * - `wide`: nowhere in view, so somewhere further round, with an arrow pointing to him.
 * - `fallback`: nowhere at all; small, straight ahead, at a distance that stays in front of
 *   whatever is known to be there.
 */
export type PlacementLevel = 'full' | 'tight' | 'small' | 'wide' | 'fallback';

export interface Placement {
  position: Vector3Like;
  /** Hologram radius to draw at (0.22 normally, ≈0.13 when squeezed). */
  radius: number;
  level: PlacementLevel;
  /** Free distance around the centre, metres (Infinity if unknown). */
  clearance: number;
  /** Whether a head-locked arrow should point to him (he is outside the comfortable view cone). */
  needsPointer: boolean;
  /** The epoch of the room this was placed in, to hand back as `previousEpoch` next time. */
  epoch: number;
}

/** What the debug HUD shows about the room. */
export interface RoomDescription {
  planes: number;
  meshes: number;
  /** How many planes and meshes carry each label ('' for none). */
  labels: Record<string, number>;
  /** Triangles across every mesh, the global mesh included. */
  triangles: number;
  /** Occupied cells in the grid, or 0 before one has been built. */
  voxels: number;
  /** The epoch of the snapshot the grid was built from. */
  epoch: number;
  /** Why the room could not be used, in words for the HUD; undefined when it could. */
  problem?: string;
}

export interface RoomModel {
  /** Replace the scene (cheap if nothing changed: compare lastChangedTime/membership upstream). */
  update(snapshot: RoomSnapshot): void;
  place(request: PlacementRequest): Placement;
  /** For the HUD. */
  describe(): RoomDescription;
}
