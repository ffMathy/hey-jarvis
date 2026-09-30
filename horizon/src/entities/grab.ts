import type { Ray, Vector3Like } from '../xr/ray';

/**
 * Taking an entity's token from the drawer, or from where it stands, and putting it somewhere.
 *
 * Two ways to hold one, because some things are within reach and some — a ceiling lamp — are not:
 *
 * - **Near:** pinch (a hand) or squeeze the grip (a controller) with the hand on a token, carry it,
 *   and let go where it belongs. Let go on the drawer and it goes back in: the entity is unplaced.
 * - **Far:** point at a token and pinch or pull the trigger, and it rides the ray, sitting where the
 *   ray meets a real surface (the room's depth hit test), so it is seen where it would land. Point at
 *   the real lamp and pinch or pull the trigger again to drop it there. With no surface hit, it keeps
 *   the last distance, which a controller's thumbstick pushes out or pulls in. Dropped on the drawer,
 *   it goes back in.
 *
 * A hand's pinch is both its hold and its select, so a pinch on a token is a near grab, a pinch
 * anywhere else picks by ray, and while a token rides the ray the next pinch drops it. A grabber that
 * stops being tracked while it carries something drops nothing: the carry is cancelled and the entity
 * stays where it was, since a hand lost to tracking is not a decision.
 *
 * Pure: a state in, a state out and the events to carry out. The runtime turns a `placed` event into
 * a drop on the room anchors and a registry write, and an `unplaced` one into a registry write.
 */

export type GrabberKind = 'hand' | 'controller';

/** One hand or controller this frame. */
export interface Grabber {
  /** Which input source: the same key every frame, `left-hand` or `right-controller`, say. */
  id: string;
  kind: GrabberKind;
  /** Where it holds things — a hand's pinch point, a controller's grip — or undefined when untracked. */
  grip?: Vector3Like;
  /** A hand pinching, or a controller's grip squeezed. */
  holding: boolean;
  /** A hand pinching, or a controller's trigger pulled. */
  selecting: boolean;
  /** Where it points, or undefined when untracked. */
  ray?: Ray;
  /** How far along the ray it hit a real surface, when the hit test says. */
  hitDistance?: number;
  /** A controller's thumbstick forward (+) or back (−), −1 to 1: pushes a token riding the ray out or in. */
  reach?: number;
}

/** A token that can be taken: an entity in the drawer, or one placed in the room. */
export interface GrabToken {
  id: string;
  position: Vector3Like;
  from: 'drawer' | 'room';
  /** How big it is to take, in metres; TOKEN_RADIUS_METRES unless the drawer's slot is bigger. */
  radius?: number;
}

/** The drawer: a rectangle facing the user, `right` and `up` its unit axes and `normal` towards him. */
export interface DrawerSurface {
  centre: Vector3Like;
  right: Vector3Like;
  up: Vector3Like;
  normal: Vector3Like;
  halfWidth: number;
  halfHeight: number;
}

export interface GrabFrame {
  grabbers: readonly Grabber[];
  tokens: readonly GrabToken[];
  drawer?: DrawerSurface;
  deltaSeconds: number;
}

export type GrabMode = 'near' | 'far';

export type GrabEvent =
  | { kind: 'grabbed'; id: string; grabber: string; mode: GrabMode; from: 'drawer' | 'room' }
  /** Let go in the room: keep it at `position`. */
  | { kind: 'placed'; id: string; position: Vector3Like }
  /** Let go on the drawer: it goes back in. */
  | { kind: 'unplaced'; id: string }
  /** Its grabber stopped being tracked: it stays where it was. */
  | { kind: 'cancelled'; id: string };

/** A token being carried, for drawing it and saying where it would go. */
export interface CarriedToken {
  id: string;
  grabber: string;
  mode: GrabMode;
  /** Where it was taken from: the drawer, or its place in the room, which it keeps until let go. */
  from: 'drawer' | 'room';
  position: Vector3Like;
  /** Where it would go if let go now. */
  over: 'drawer' | 'room';
}

interface Carrying {
  id: string;
  mode: GrabMode;
  from: 'drawer' | 'room';
  /** How far along the ray a token riding it is. */
  distance: number;
  position: Vector3Like;
  over: 'drawer' | 'room';
}

interface Buttons {
  holding: boolean;
  selecting: boolean;
}

export interface GrabState {
  readonly carrying: ReadonlyMap<string, Carrying>;
  /** Each grabber's buttons last frame, for telling a press from a hold. */
  readonly buttons: ReadonlyMap<string, Buttons>;
}

export const NOTHING_GRABBED: GrabState = { carrying: new Map(), buttons: new Map() };

/** How big a token is to take when it says nothing else. */
export const TOKEN_RADIUS_METRES = 0.02;

/** How near a pinch has to be to a token's edge to take it. */
export const HAND_REACH_METRES = 0.05;

/** How near a controller's grip has to be: the controller's body is in the way of getting closer. */
export const CONTROLLER_REACH_METRES = 0.06;

/** How far off a ray a token may be and still be taken, as an angle, for a small token far away. */
export const FAR_PICK_DEGREES = 3;

/** How far in front of or behind the drawer a token let go still counts as on it. */
export const DRAWER_DEPTH_METRES = 0.06;

/** How far past its edges. */
export const DRAWER_MARGIN_METRES = 0.02;

/** How far beyond the ray's hit a token may be and still be taken: one standing on the surface hit. */
export const PICK_OCCLUSION_SLACK_METRES = 0.4;

/** How much the thumbstick fully over changes a riding token's distance each second: three times. */
export const REACH_FACTOR_PER_SECOND = 3;

export const NEAREST_RIDE_METRES = 0.2;
export const FARTHEST_RIDE_METRES = 10;

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

function length(vector: Vector3Like): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

/** Whether `point` is on the drawer: inside its rectangle, give or take a margin, and near its plane. */
export function isOnDrawer(drawer: DrawerSurface | undefined, point: Vector3Like): boolean {
  if (drawer === undefined) return false;
  const offset = difference(drawer.centre, point);
  return (
    Math.abs(dot(offset, drawer.right)) <= drawer.halfWidth + DRAWER_MARGIN_METRES &&
    Math.abs(dot(offset, drawer.up)) <= drawer.halfHeight + DRAWER_MARGIN_METRES &&
    Math.abs(dot(offset, drawer.normal)) <= DRAWER_DEPTH_METRES
  );
}

/** How far along `ray` it meets the drawer's rectangle, or undefined when it misses it. */
export function rayDrawerDistance(ray: Ray, drawer: DrawerSurface | undefined): number | undefined {
  if (drawer === undefined) return undefined;
  const facing = dot(ray.direction, drawer.normal);
  if (Math.abs(facing) < 1e-6) return undefined;
  const distance = dot(difference(ray.origin, drawer.centre), drawer.normal) / facing;
  if (distance <= 0) return undefined;
  const offset = difference(drawer.centre, add(ray.origin, ray.direction, distance));
  const inside =
    Math.abs(dot(offset, drawer.right)) <= drawer.halfWidth + DRAWER_MARGIN_METRES &&
    Math.abs(dot(offset, drawer.up)) <= drawer.halfHeight + DRAWER_MARGIN_METRES;
  return inside ? distance : undefined;
}

/** The free token nearest `grip` within reach of its edge. */
function nearestInReach(grabber: Grabber, grip: Vector3Like, tokens: readonly GrabToken[], taken: Set<string>) {
  const reach = grabber.kind === 'hand' ? HAND_REACH_METRES : CONTROLLER_REACH_METRES;
  let nearest: { token: GrabToken; gap: number } | undefined;
  for (const token of tokens) {
    if (taken.has(token.id)) continue;
    const gap = length(difference(grip, token.position)) - (token.radius ?? TOKEN_RADIUS_METRES);
    if (gap <= reach && (nearest === undefined || gap < nearest.gap)) nearest = { token, gap };
  }
  return nearest?.token;
}

/** The free token nearest `ray`'s axis, within its size or FAR_PICK_DEGREES, and how far along it is. */
function pickedByRay(grabber: Grabber, ray: Ray, tokens: readonly GrabToken[], taken: Set<string>) {
  const tangent = Math.tan((FAR_PICK_DEGREES * Math.PI) / 180);
  let best: { token: GrabToken; distance: number; share: number } | undefined;
  for (const token of tokens) {
    if (taken.has(token.id)) continue;
    const offset = difference(ray.origin, token.position);
    const along = dot(offset, ray.direction);
    if (along <= 0) continue;
    if (grabber.hitDistance !== undefined && along > grabber.hitDistance + PICK_OCCLUSION_SLACK_METRES) continue;
    const miss = length(difference(add(ray.origin, ray.direction, along), token.position));
    const allowed = Math.max(token.radius ?? TOKEN_RADIUS_METRES, along * tangent);
    const share = miss / allowed;
    if (share <= 1 && (best === undefined || share < best.share)) best = { token, distance: along, share };
  }
  return best;
}

/** Where a token riding `ray` sits this frame, how far along, and whether it is over the drawer. */
function ride(grabber: Grabber, ray: Ray, carrying: Carrying, drawer: DrawerSurface | undefined, deltaSeconds: number) {
  const onDrawer = rayDrawerDistance(ray, drawer);
  const pushed = carrying.distance * REACH_FACTOR_PER_SECOND ** ((grabber.reach ?? 0) * deltaSeconds);
  const free = Math.min(FARTHEST_RIDE_METRES, Math.max(NEAREST_RIDE_METRES, pushed));
  const surface = grabber.hitDistance ?? free;
  if (onDrawer !== undefined && onDrawer <= surface) {
    return { distance: onDrawer, position: add(ray.origin, ray.direction, onDrawer), over: 'drawer' as const };
  }
  return { distance: surface, position: add(ray.origin, ray.direction, surface), over: 'room' as const };
}

/** What letting go of `carrying` at its position amounts to. */
function letGo(carrying: Carrying): GrabEvent {
  return carrying.over === 'drawer'
    ? { kind: 'unplaced', id: carrying.id }
    : { kind: 'placed', id: carrying.id, position: { ...carrying.position } };
}

interface GrabberStep {
  carrying?: Carrying;
  events: GrabEvent[];
}

/** A grabber carrying something: moves it, and lets go of it on the right press or release. */
function carry(
  grabber: Grabber,
  carrying: Carrying,
  pressed: Buttons,
  released: Buttons,
  frame: GrabFrame,
): GrabberStep {
  if (carrying.mode === 'near') {
    if (grabber.grip === undefined) return { events: [{ kind: 'cancelled', id: carrying.id }] };
    const over: Carrying['over'] = isOnDrawer(frame.drawer, grabber.grip) ? 'drawer' : 'room';
    const moved: Carrying = { ...carrying, position: { ...grabber.grip }, over };
    return released.holding ? { events: [letGo(moved)] } : { carrying: moved, events: [] };
  }
  if (grabber.ray === undefined) return { events: [{ kind: 'cancelled', id: carrying.id }] };
  const moved: Carrying = { ...carrying, ...ride(grabber, grabber.ray, carrying, frame.drawer, frame.deltaSeconds) };
  return pressed.selecting ? { events: [letGo(moved)] } : { carrying: moved, events: [] };
}

/** A grabber with empty hands: takes a token within reach on a hold, or one on its ray on a select. */
function take(grabber: Grabber, pressed: Buttons, frame: GrabFrame, taken: Set<string>): GrabberStep {
  const { grip, ray } = grabber;
  const token = pressed.holding && grip !== undefined ? nearestInReach(grabber, grip, frame.tokens, taken) : undefined;
  if (token !== undefined && grip !== undefined) {
    const carrying: Carrying = {
      id: token.id,
      mode: 'near',
      from: token.from,
      distance: 0,
      position: { ...grip },
      over: isOnDrawer(frame.drawer, grip) ? 'drawer' : 'room',
    };
    return {
      carrying,
      events: [{ kind: 'grabbed', id: token.id, grabber: grabber.id, mode: 'near', from: token.from }],
    };
  }
  const picked = pressed.selecting && ray !== undefined ? pickedByRay(grabber, ray, frame.tokens, taken) : undefined;
  if (picked === undefined) return { events: [] };
  const carrying: Carrying = {
    id: picked.token.id,
    mode: 'far',
    from: picked.token.from,
    distance: picked.distance,
    position: { ...picked.token.position },
    over: picked.token.from,
  };
  return {
    carrying,
    events: [{ kind: 'grabbed', id: picked.token.id, grabber: grabber.id, mode: 'far', from: picked.token.from }],
  };
}

/** Which of a grabber's buttons went down this frame, and which came up, from how they were last frame. */
function edges(grabber: Grabber, before: Buttons | undefined): { pressed: Buttons; released: Buttons } {
  const was = before ?? { holding: false, selecting: false };
  return {
    pressed: { holding: grabber.holding && !was.holding, selecting: grabber.selecting && !was.selecting },
    released: { holding: !grabber.holding && was.holding, selecting: !grabber.selecting && was.selecting },
  };
}

export interface GrabStep {
  state: GrabState;
  events: GrabEvent[];
  carried: CarriedToken[];
}

/** The next state, what happened this frame, and every token being carried. */
export function stepGrab(state: GrabState, frame: GrabFrame): GrabStep {
  const carrying = new Map<string, Carrying>();
  const buttons = new Map<string, Buttons>();
  const events: GrabEvent[] = [];
  const present = new Set(frame.grabbers.map((grabber) => grabber.id));
  // A grabber gone from the frame altogether — a controller put down, a hand out of view — is untracked.
  for (const [id, held] of state.carrying) {
    if (!present.has(id)) events.push({ kind: 'cancelled', id: held.id });
  }
  const taken = new Set([...state.carrying].filter(([id]) => present.has(id)).map(([, held]) => held.id));
  for (const grabber of frame.grabbers) {
    const { pressed, released } = edges(grabber, state.buttons.get(grabber.id));
    buttons.set(grabber.id, { holding: grabber.holding, selecting: grabber.selecting });
    const held = state.carrying.get(grabber.id);
    const step: GrabberStep =
      held === undefined ? take(grabber, pressed, frame, taken) : carry(grabber, held, pressed, released, frame);
    events.push(...step.events);
    if (held !== undefined && step.carrying === undefined) taken.delete(held.id);
    if (step.carrying !== undefined) {
      carrying.set(grabber.id, step.carrying);
      taken.add(step.carrying.id);
    }
  }
  const carried = [...carrying].map(([grabber, held]) => ({
    id: held.id,
    grabber,
    mode: held.mode,
    from: held.from,
    position: { ...held.position },
    over: held.over,
  }));
  return { state: { carrying, buttons }, events, carried };
}
