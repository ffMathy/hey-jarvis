import type { DrawerSurface } from '../entities/grab';
import type { Ray, Vector3Like } from '../xr/ray';

/**
 * Where everything on the drawer is: the lectern sir takes the things Jarvis works on from.
 *
 * The drawer is a flat board, world-locked where it opened — a little below the eyes and within
 * arm's reach, tilted back towards the eyes like a lectern — because hands have to reach it and a
 * board that followed the gaze would move away from the hand reaching for it. It holds a page of
 * slots, each an entity's token over its name, a header with the page, and a footer with the page
 * buttons and Done.
 *
 * Everything is laid out in the board's own plane, in metres from its middle: x to sir's right, y up
 * the board, z out of it towards him. The canvas that draws it (`entity-drawer.ts`), the tokens
 * floating over it, the grab's idea of where it is (`entities/grab.ts`) and the buttons' hit tests
 * all read their places from here, so they cannot disagree.
 */

export const DRAWER_COLUMNS = 4;
export const DRAWER_ROWS = 3;
export const SLOTS_PER_PAGE = DRAWER_COLUMNS * DRAWER_ROWS;

/**
 * A slot's size. Five centimetres between tokens is the least a pinch can pick one out of its
 * neighbours by; these leave nine across and nine down, and room under each token for a name on two
 * lines and a note under that.
 */
export const SLOT_WIDTH_METRES = 0.09;
export const SLOT_HEIGHT_METRES = 0.09;

export const DRAWER_MARGIN_METRES = 0.015;
export const DRAWER_HEADER_METRES = 0.05;
export const DRAWER_FOOTER_METRES = 0.06;

export const DRAWER_WIDTH_METRES = DRAWER_COLUMNS * SLOT_WIDTH_METRES + 2 * DRAWER_MARGIN_METRES;
export const DRAWER_HEIGHT_METRES =
  DRAWER_HEADER_METRES + DRAWER_ROWS * SLOT_HEIGHT_METRES + DRAWER_FOOTER_METRES + 2 * DRAWER_MARGIN_METRES;

/** How far in front of the board a token floats, so a hand closes on it and not on the board. */
export const TOKEN_LIFT_METRES = 0.018;

/** How far down from a slot's top edge its token sits; the name goes under it. */
export const TOKEN_FROM_SLOT_TOP_METRES = 0.022;

/** Where the drawer opens: this far ahead of the eyes along the floor, and this far below them. */
export const DRAWER_AHEAD_METRES = 0.42;
export const DRAWER_BELOW_EYES_METRES = 0.3;

/** How big a footer button is drawn, and how far from its middle a ray or a fingertip still counts. */
export const DRAWER_BUTTON_RADIUS_METRES = 0.02;
export const DRAWER_BUTTON_REACH_METRES = 0.03;

/** How near the board a fingertip has to be to press one of its buttons. */
export const DRAWER_TOUCH_DEPTH_METRES = 0.025;

export type DrawerButton = 'previous' | 'next' | 'done';

export const DRAWER_BUTTONS: readonly DrawerButton[] = ['previous', 'done', 'next'];

/** A point on the board, in metres from its middle, in its own axes. */
export interface DrawerPoint {
  x: number;
  y: number;
  z: number;
}

/** Where the board stands: its middle, and its axes as unit vectors in the room. */
export interface DrawerPose {
  centre: Vector3Like;
  right: Vector3Like;
  up: Vector3Like;
  /** Out of the board, towards sir. */
  normal: Vector3Like;
}

function add(point: Vector3Like, direction: Vector3Like, distance: number): Vector3Like {
  return {
    x: point.x + direction.x * distance,
    y: point.y + direction.y * distance,
    z: point.z + direction.z * distance,
  };
}

function difference(from: Vector3Like, to: Vector3Like): Vector3Like {
  return { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
}

function dot(first: Vector3Like, second: Vector3Like): number {
  return first.x * second.x + first.y * second.y + first.z * second.z;
}

function cross(first: Vector3Like, second: Vector3Like): Vector3Like {
  return {
    x: first.y * second.z - first.z * second.y,
    y: first.z * second.x - first.x * second.z,
    z: first.x * second.y - first.y * second.x,
  };
}

function normalised(vector: Vector3Like): Vector3Like {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

/**
 * The board opened in front of `eye`, `ahead` being the unit direction ahead along the floor: at
 * {@link DRAWER_AHEAD_METRES} and {@link DRAWER_BELOW_EYES_METRES}, level from side to side, and
 * tilted so it faces the eyes squarely.
 */
export function drawerPoseFacing(eye: Vector3Like, ahead: Vector3Like): DrawerPose {
  const level = normalised({ x: ahead.x, y: 0, z: ahead.z });
  const centre = {
    x: eye.x + level.x * DRAWER_AHEAD_METRES,
    y: eye.y - DRAWER_BELOW_EYES_METRES,
    z: eye.z + level.z * DRAWER_AHEAD_METRES,
  };
  const normal = normalised(difference(centre, eye));
  const right = normalised(cross({ x: 0, y: 1, z: 0 }, normal));
  return { centre, right, up: cross(normal, right), normal };
}

/** How many pages `count` entries take: one at least, so an empty drawer still has a page to say so on. */
export function pageCount(count: number): number {
  return Math.max(1, Math.ceil(count / SLOTS_PER_PAGE));
}

/** `page` kept to the pages `count` entries have. */
export function clampPage(page: number, count: number): number {
  return Math.min(Math.max(0, Math.floor(page)), pageCount(count) - 1);
}

/** The entries shown on `page`. */
export function entriesOnPage<Entry>(entries: readonly Entry[], page: number): Entry[] {
  const first = clampPage(page, entries.length) * SLOTS_PER_PAGE;
  return entries.slice(first, first + SLOTS_PER_PAGE);
}

/** The middle of the `index`th slot on a page, row by row from the top left. */
export function slotCentre(index: number): DrawerPoint {
  const column = index % DRAWER_COLUMNS;
  const row = Math.floor(index / DRAWER_COLUMNS);
  const top = DRAWER_HEIGHT_METRES / 2 - DRAWER_MARGIN_METRES - DRAWER_HEADER_METRES;
  return {
    x: -DRAWER_WIDTH_METRES / 2 + DRAWER_MARGIN_METRES + (column + 0.5) * SLOT_WIDTH_METRES,
    y: top - (row + 0.5) * SLOT_HEIGHT_METRES,
    z: 0,
  };
}

/** Where the `index`th slot's token floats. */
export function tokenPoint(index: number): DrawerPoint {
  const slot = slotCentre(index);
  return { x: slot.x, y: slot.y + SLOT_HEIGHT_METRES / 2 - TOKEN_FROM_SLOT_TOP_METRES, z: TOKEN_LIFT_METRES };
}

/** The middle of a footer button. */
export function buttonPoint(button: DrawerButton): DrawerPoint {
  const y = -DRAWER_HEIGHT_METRES / 2 + DRAWER_MARGIN_METRES + DRAWER_FOOTER_METRES / 2;
  const inset = DRAWER_MARGIN_METRES + SLOT_WIDTH_METRES / 2;
  switch (button) {
    case 'previous':
      return { x: -DRAWER_WIDTH_METRES / 2 + inset, y, z: 0 };
    case 'next':
      return { x: DRAWER_WIDTH_METRES / 2 - inset, y, z: 0 };
    case 'done':
      return { x: 0, y, z: 0 };
  }
}

/** A point on the board, in the room. */
export function drawerToRoom(pose: DrawerPose, point: DrawerPoint): Vector3Like {
  return add(add(add(pose.centre, pose.right, point.x), pose.up, point.y), pose.normal, point.z);
}

/** A point in the room, on the board's terms. */
export function roomToDrawer(pose: DrawerPose, point: Vector3Like): DrawerPoint {
  const offset = difference(pose.centre, point);
  return { x: dot(offset, pose.right), y: dot(offset, pose.up), z: dot(offset, pose.normal) };
}

/** The board as the grab sees it, to tell a token let go on it from one let go in the room. */
export function drawerSurfaceOf(pose: DrawerPose): DrawerSurface {
  return { ...pose, halfWidth: DRAWER_WIDTH_METRES / 2, halfHeight: DRAWER_HEIGHT_METRES / 2 };
}

/** The button whose middle is within reach of `point` on the board, or undefined. */
function buttonNear(point: DrawerPoint, enabled: ReadonlySet<DrawerButton>): DrawerButton | undefined {
  for (const button of DRAWER_BUTTONS) {
    if (!enabled.has(button)) continue;
    const middle = buttonPoint(button);
    if (Math.hypot(point.x - middle.x, point.y - middle.y) <= DRAWER_BUTTON_REACH_METRES) return button;
  }
  return undefined;
}

/** The button `ray` points at, or undefined: where it crosses the board, from the front. */
export function buttonAlong(pose: DrawerPose, ray: Ray, enabled: ReadonlySet<DrawerButton>): DrawerButton | undefined {
  const facing = dot(ray.direction, pose.normal);
  // From behind the board, or along it, there is nothing to press.
  if (facing > -1e-6) return undefined;
  const distance = dot(difference(ray.origin, pose.centre), pose.normal) / facing;
  if (distance <= 0) return undefined;
  return buttonNear(roomToDrawer(pose, add(ray.origin, ray.direction, distance)), enabled);
}

/** The button a fingertip at `point` is touching, or undefined: on the board's face, give or take. */
export function buttonTouched(
  pose: DrawerPose,
  point: Vector3Like,
  enabled: ReadonlySet<DrawerButton>,
): DrawerButton | undefined {
  const onBoard = roomToDrawer(pose, point);
  return Math.abs(onBoard.z) <= DRAWER_TOUCH_DEPTH_METRES ? buttonNear(onBoard, enabled) : undefined;
}
