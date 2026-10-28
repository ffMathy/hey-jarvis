import type { NativeMesh, NativePlane, XRRigidTransform } from 'iwer';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * The room the emulator reports, read back from the planes and boxes it hands a page — so what is
 * drawn is laid out by exactly what the app is told about, and nothing stands where the app thinks
 * there is space.
 *
 * A plane, as `@iwer/sem` has it, is a rectangle in its own x-z plane whose side facing into the room
 * is its local −y; a box is the eight corners of a cuboid in its own frame, turned so that one of its
 * axes is upright. Both are re-expressed here in the room's terms: a rectangle with a right, an up and
 * a normal pointing into the room, and a cuboid standing on the floor facing the middle of it.
 */

/** A flat surface: a wall, the floor, the ceiling, a window, a door or a picture. */
export interface RoomSurface {
  label: string;
  /** From the plane's own frame to the room's. */
  matrix: Matrix4;
  /** The rectangle in the plane's own (x, z). */
  rect: Rect;
  /** The middle of the rectangle, in the room. */
  centre: Vector3;
  /** The unit normal facing into the room. */
  normal: Vector3;
}

/** An axis-aligned rectangle in a plane's own (x, z), which are called u and v here. */
export interface Rect {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

/** A piece of furniture's bounding box, standing on the floor. */
export interface RoomBox {
  label: string;
  /** The middle of its footprint, at the height of its underside. */
  base: Vector3;
  /** Across its front, how tall it is, and how deep. */
  width: number;
  height: number;
  depth: number;
  /** The horizontal unit direction its front faces: towards the middle of the floor. */
  front: Vector3;
  /** The room-aligned box round it, as the app's own room code sees it. */
  bounds: Box3;
}

export interface RoomLayout {
  surfaces: RoomSurface[];
  boxes: RoomBox[];
  /** The middle of the floor, which furniture faces. */
  middle: Vector3;
}

const UP = new Vector3(0, 1, 0);

function matrixOf(transform: XRRigidTransform): Matrix4 {
  const { position, orientation } = transform;
  return new Matrix4().compose(
    new Vector3(position.x, position.y, position.z),
    new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
    new Vector3(1, 1, 1),
  );
}

function rectOf(plane: NativePlane): Rect {
  const us = plane.polygon.map((point) => point.x);
  const vs = plane.polygon.map((point) => point.z);
  return { minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs) };
}

/** A point of a plane's own (u, v) in the room. */
export function pointOnSurface(surface: RoomSurface, u: number, v: number): Vector3 {
  return new Vector3(u, 0, v).applyMatrix4(surface.matrix);
}

/** The four corners of a surface's rectangle, in the room. */
export function cornersOf(surface: RoomSurface): Vector3[] {
  const { minU, maxU, minV, maxV } = surface.rect;
  return [
    pointOnSurface(surface, minU, minV),
    pointOnSurface(surface, maxU, minV),
    pointOnSurface(surface, maxU, maxV),
    pointOnSurface(surface, minU, maxV),
  ];
}

function surfaceOf(plane: NativePlane, middle: Vector3 | undefined): RoomSurface {
  const matrix = matrixOf(plane.transform);
  const rect = rectOf(plane);
  const centre = new Vector3((rect.minU + rect.maxU) / 2, 0, (rect.minV + rect.maxV) / 2).applyMatrix4(matrix);
  const normal = new Vector3(0, -1, 0).transformDirection(matrix);
  // The capture's planes all face the room on their −y, but a wall that came the other way round would
  // be drawn from behind and lit as if it faced outside, so it is turned to face the middle.
  if (middle !== undefined && normal.dot(new Vector3().subVectors(middle, centre)) < 0) normal.negate();
  return { label: plane.semanticLabel, matrix, rect, centre, normal };
}

function boxOf(mesh: NativeMesh, middle: Vector3): RoomBox {
  const matrix = matrixOf(mesh.transform);
  const local = new Box3();
  for (let index = 0; index < mesh.vertices.length; index += 3) {
    local.expandByPoint(
      new Vector3(mesh.vertices[index] ?? 0, mesh.vertices[index + 1] ?? 0, mesh.vertices[index + 2] ?? 0),
    );
  }
  const size = local.getSize(new Vector3()).toArray();
  const centre = local.getCenter(new Vector3()).applyMatrix4(matrix);
  const axes = [0, 1, 2].map((axis) => new Vector3().setFromMatrixColumn(matrix, axis).normalize());
  const upright = axes.reduce(
    (best, axis, index) => (Math.abs(axis.y) > Math.abs(axes[best]?.y ?? 0) ? index : best),
    0,
  );
  const [first, second] = [0, 1, 2].filter((axis) => axis !== upright);
  if (first === undefined || second === undefined) throw new Error('A box has fewer than three axes.');
  const across = (size[first] ?? 0) >= (size[second] ?? 0) ? first : second;
  const deep = across === first ? second : first;
  const height = size[upright] ?? 0;
  const front = (axes[deep] ?? new Vector3(0, 0, 1)).clone().setY(0).normalize();
  if (front.dot(new Vector3().subVectors(middle, centre).setY(0)) < 0) front.negate();
  return {
    label: mesh.semanticLabel,
    base: centre.clone().addScaledVector(UP, -height / 2),
    width: size[across] ?? 0,
    height,
    depth: size[deep] ?? 0,
    front,
    bounds: local.clone().applyMatrix4(matrix),
  };
}

/** The room as the emulator reports it. Furniture with no box — the capture's planes on table tops — is left to the boxes. */
export function readRoomLayout(planes: Iterable<NativePlane>, meshes: Iterable<NativeMesh>): RoomLayout {
  const all = [...planes];
  const floor = all.find((plane) => plane.semanticLabel === 'floor');
  if (floor === undefined) throw new Error('The emulated room has no floor.');
  const middle = surfaceOf(floor, undefined).centre;
  const surfaces = all.map((plane) => surfaceOf(plane, middle));
  const boxes = [...meshes].filter((mesh) => mesh.semanticLabel !== 'global mesh').map((mesh) => boxOf(mesh, middle));
  return { surfaces, boxes, middle };
}

/**
 * Where `opening` lies in the plane of `wall`, as a rectangle of the wall's (u, v), or nothing when it is
 * not in that wall: turned away from it, more than a few centimetres in front or behind, or outside it.
 */
export function openingIn(wall: RoomSurface, opening: RoomSurface): Rect | undefined {
  if (wall.normal.dot(opening.normal) < 0.95) return undefined;
  const toWall = wall.matrix.clone().invert();
  const corners = cornersOf(opening).map((corner) => corner.applyMatrix4(toWall));
  if (corners.some((corner) => Math.abs(corner.y) > 0.1)) return undefined;
  const us = corners.map((corner) => corner.x);
  const vs = corners.map((corner) => corner.z);
  const rect = { minU: Math.min(...us), maxU: Math.max(...us), minV: Math.min(...vs), maxV: Math.max(...vs) };
  const middleU = (rect.minU + rect.maxU) / 2;
  const middleV = (rect.minV + rect.maxV) / 2;
  const inside =
    middleU > wall.rect.minU && middleU < wall.rect.maxU && middleV > wall.rect.minV && middleV < wall.rect.maxV;
  return inside ? rect : undefined;
}

/**
 * A surface's own upright frame: across it to the right as one faces it, straight up, and out of it into
 * the room, with its width and height along the first two — for windows and pictures, whose up is the
 * room's however the capture turned their plane.
 */
export function uprightFrameOf(surface: RoomSurface): { basis: Matrix4; width: number; height: number } {
  const normal = surface.normal.clone().setY(0).normalize();
  const right = new Vector3().crossVectors(UP, normal).normalize();
  const corners = cornersOf(surface).map((corner) => corner.sub(surface.centre));
  const across = corners.map((corner) => corner.dot(right));
  const heights = corners.map((corner) => corner.y);
  const basis = new Matrix4().makeBasis(right, UP, normal).setPosition(surface.centre);
  return {
    basis,
    width: Math.max(...across) - Math.min(...across),
    height: Math.max(...heights) - Math.min(...heights),
  };
}
