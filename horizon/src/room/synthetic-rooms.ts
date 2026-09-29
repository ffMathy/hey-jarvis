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

/** A piece of furniture as Quest sends it: a box mesh of 8 corners and 12 triangles, standing on the floor. */
export function boxMesh(label: string, area: FloorRectangle, height: number, bottom = 0): SceneMesh {
  const halfWidth = (area.maxX - area.minX) / 2;
  const halfDepth = (area.maxZ - area.minZ) / 2;
  const centre = { x: (area.minX + area.maxX) / 2, y: bottom, z: (area.minZ + area.maxZ) / 2 };
  const pose = poseFromAxes(centre, { x: 1, y: 0, z: 0 }, UP, { x: 0, y: 0, z: 1 });
  const vertices = new Float32Array(24);
  let offset = 0;
  for (const y of [0, height]) {
    for (const [x, z] of [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth],
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
  return { label, pose, vertices, indices: new Uint32Array(faces.flat()) };
}

/** A quadrilateral by its corners in order, for building a room scan. */
type Quad = [Vector3Like, Vector3Like, Vector3Like, Vector3Like];

function planeQuad(plane: ScenePlane): Quad {
  const [a, b, c, d] = plane.polygon.map((point) => toReference(plane.pose, point.x, 0, point.z));
  return [a, b, c, d];
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
  return faces.map(([a, b, c, d]) => [corners[a], corners[b], corners[c], corners[d]]);
}

/** Linear interpolation between two points. */
function mix(a: Vector3Like, b: Vector3Like, fraction: number): Vector3Like {
  return { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction, z: a.z + (b.z - a.z) * fraction };
}

/**
 * A room scan of the given planes and boxes: one mesh labelled 'global mesh', every surface cut
 * into triangles about `spacing` metres across, all in the reference space (an identity pose).
 */
export function roomScan(planes: ScenePlane[], boxes: SceneMesh[], spacing = 0.3): SceneMesh {
  const quads = [...planes.map(planeQuad), ...boxes.flatMap(boxQuads)];
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const [a, b, c, d] of quads) {
    const across = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / spacing));
    const down = Math.max(1, Math.ceil(Math.hypot(d.x - a.x, d.y - a.y, d.z - a.z) / spacing));
    const first = vertices.length / 3;
    for (let row = 0; row <= down; row++) {
      const left = mix(a, d, row / down);
      const right = mix(b, c, row / down);
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
