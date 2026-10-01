import type { FloorPoint } from './floor-polygon';
import { poseFromAxes, toReference } from './pose-matrix';
import type { SceneMesh, ScenePlane, Vector3Like } from './types';

/**
 * Rooms built by hand for the placement specs, in the shapes a headset reports them: planes
 * posed with their normal along +y of their own space, furniture as eight-cornered box meshes,
 * and the room scan as one big mesh of small triangles. Only the specs import this.
 */

const UP = { x: 0, y: 1, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };

/** A floor-plan rectangle from its opposite corners. */
export interface FloorRectangle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * A horizontal rectangle at `height`: a floor, a ceiling or a table top.
 *
 * `facingDown` turns the plane's normal into the ground, which is how some of the captured rooms
 * the browser tests use report their floors.
 */
export function horizontalPlane(label: string, area: FloorRectangle, height: number, facingDown = false): ScenePlane {
  const halfWidth = (area.maxX - area.minX) / 2;
  const halfDepth = (area.maxZ - area.minZ) / 2;
  const centre = { x: (area.minX + area.maxX) / 2, y: height, z: (area.minZ + area.maxZ) / 2 };
  // x × y = z keeps the plane's own space right-handed either way up.
  const pose = facingDown
    ? poseFromAxes(centre, { x: 1, y: 0, z: 0 }, DOWN, { x: 0, y: 0, z: -1 })
    : poseFromAxes(centre, { x: 1, y: 0, z: 0 }, UP, { x: 0, y: 0, z: 1 });
  const polygon = [
    { x: -halfWidth, y: 0, z: -halfDepth },
    { x: halfWidth, y: 0, z: -halfDepth },
    { x: halfWidth, y: 0, z: halfDepth },
    { x: -halfWidth, y: 0, z: halfDepth },
  ];
  return { label, pose, polygon };
}

/** A vertical rectangle standing on the floor-plan line from `from` to `to`, between two heights. */
export function verticalPlane(
  label: string,
  from: FloorPoint,
  to: FloorPoint,
  bottom: number,
  top: number,
): ScenePlane {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const along = { x: (to.x - from.x) / length, y: 0, z: (to.z - from.z) / length };
  const normal = { x: -along.z, y: 0, z: along.x };
  const centre = { x: (from.x + to.x) / 2, y: (bottom + top) / 2, z: (from.z + to.z) / 2 };
  // With x along the wall and y its normal, z = x × y points straight down.
  const pose = poseFromAxes(centre, along, normal, DOWN);
  const halfLength = length / 2;
  const halfHeight = (top - bottom) / 2;
  const polygon = [
    { x: -halfLength, y: 0, z: -halfHeight },
    { x: halfLength, y: 0, z: -halfHeight },
    { x: halfLength, y: 0, z: halfHeight },
    { x: -halfLength, y: 0, z: halfHeight },
  ];
  return { label, pose, polygon };
}

/** The floor, the ceiling and four walls of a rectangular room. */
export function roomPlanes(area: FloorRectangle, height: number): ScenePlane[] {
  const { minX, maxX, minZ, maxZ } = area;
  return [
    horizontalPlane('floor', area, 0),
    horizontalPlane('ceiling', area, height, true),
    verticalPlane('wall', { x: minX, z: minZ }, { x: maxX, z: minZ }, 0, height),
    verticalPlane('wall', { x: maxX, z: minZ }, { x: maxX, z: maxZ }, 0, height),
    verticalPlane('wall', { x: maxX, z: maxZ }, { x: minX, z: maxZ }, 0, height),
    verticalPlane('wall', { x: minX, z: maxZ }, { x: minX, z: minZ }, 0, height),
  ];
}

/**
 * A box's 8 corners — the bottom four, then the top four, each round its footprint — and its 12
 * triangles, from its lowest corner to its highest.
 */
export function boxShape(low: Vector3Like, high: Vector3Like): { vertices: Float32Array; indices: Uint32Array } {
  const vertices = new Float32Array(24);
  let offset = 0;
  for (const y of [low.y, high.y]) {
    for (const [x, z] of [
      [low.x, low.z],
      [high.x, low.z],
      [high.x, high.z],
      [low.x, high.z],
    ]) {
      vertices.set([x, y, z], offset);
      offset += 3;
    }
  }
  const faces = [
    [0, 2, 1, 0, 3, 2],
    [4, 5, 6, 4, 6, 7],
    [0, 1, 5, 0, 5, 4],
    [1, 2, 6, 1, 6, 5],
    [2, 3, 7, 2, 7, 6],
    [3, 0, 4, 3, 4, 7],
  ];
  return { vertices, indices: new Uint32Array(faces.flat()) };
}

/** A piece of furniture as Quest sends it: a box mesh of 8 corners and 12 triangles, standing on the floor. */
export function boxMesh(label: string, area: FloorRectangle, height: number, bottom = 0): SceneMesh {
  const halfWidth = (area.maxX - area.minX) / 2;
  const halfDepth = (area.maxZ - area.minZ) / 2;
  const centre = { x: (area.minX + area.maxX) / 2, y: bottom, z: (area.minZ + area.maxZ) / 2 };
  const pose = poseFromAxes(centre, { x: 1, y: 0, z: 0 }, UP, { x: 0, y: 0, z: 1 });
  const shape = boxShape({ x: -halfWidth, y: 0, z: -halfDepth }, { x: halfWidth, y: height, z: halfDepth });
  return { label, pose, ...shape };
}

/** A quadrilateral by its corners in order, for building a room scan. */
type Quad = [Vector3Like, Vector3Like, Vector3Like, Vector3Like];

function planeQuad(plane: ScenePlane): Quad {
  const [first, second, third, fourth] = plane.polygon.map((point) => toReference(plane.pose, point.x, 0, point.z));
  return [first, second, third, fourth];
}

function boxQuads(box: SceneMesh): Quad[] {
  const corners: Vector3Like[] = [];
  for (let index = 0; index < 8; index++) {
    const [x, y, z] = box.vertices.subarray(index * 3, index * 3 + 3);
    corners.push(toReference(box.pose, x, y, z));
  }
  const faces = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  return faces.map(([first, second, third, fourth]) => [
    corners[first],
    corners[second],
    corners[third],
    corners[fourth],
  ]);
}

/** Linear interpolation between two points. */
function mix(from: Vector3Like, to: Vector3Like, fraction: number): Vector3Like {
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + (to.z - from.z) * fraction,
  };
}

/**
 * A room scan of the given planes and boxes: one mesh labelled 'global mesh', every surface cut
 * into triangles about `spacing` metres across, all in the reference space (an identity pose).
 */
export function roomScan(planes: ScenePlane[], boxes: SceneMesh[], spacing = 0.3): SceneMesh {
  const quads = [...planes.map(planeQuad), ...boxes.flatMap(boxQuads)];
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [topLeft, topRight, bottomRight, bottomLeft] of quads) {
    const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y, topRight.z - topLeft.z);
    const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y, bottomLeft.z - topLeft.z);
    const across = Math.max(1, Math.ceil(width / spacing));
    const down = Math.max(1, Math.ceil(height / spacing));
    const first = vertices.length / 3;
    for (let row = 0; row <= down; row++) {
      const left = mix(topLeft, bottomLeft, row / down);
      const right = mix(topRight, bottomRight, row / down);
      for (let column = 0; column <= across; column++) {
        const point = mix(left, right, column / across);
        vertices.push(point.x, point.y, point.z);
      }
    }
    for (let row = 0; row < down; row++) {
      for (let column = 0; column < across; column++) {
        const corner = first + row * (across + 1) + column;
        indices.push(corner, corner + 1, corner + across + 2, corner, corner + across + 2, corner + across + 1);
      }
    }
  }
  const identity = poseFromAxes({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, UP, { x: 0, y: 0, z: 1 });
  return {
    label: 'global mesh',
    pose: identity,
    vertices: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}
