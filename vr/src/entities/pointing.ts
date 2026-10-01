import type { Ray, Vector3Like } from '../xr/ray';

/**
 * What sir is pointing at, and what the conversation is told about it.
 *
 * **Choosing.** A placed entity is pointed at when it lies inside a narrow cone around a pointing
 * ray — a hand's index finger in a point pose, or a controller's ray. A cone rather than a sphere of
 * fixed size round each entity, because a hand's jitter is an angle: 1–2° is 7–14 cm at 4 m, and a
 * lamp across the room must be as easy to point at as one on the desk. Hands get the wider cone,
 * since their rays are the shakier. Of the entities inside a cone, the nearest to its axis wins.
 * Then, so the choice does not flicker:
 *
 * - a new target is committed only once it has stayed the best for {@link DWELL_SECONDS};
 * - the current one is kept until another is better by {@link SWITCH_MARGIN_DEGREES}, or until it
 *   has been outside a cone {@link DROP_CONE_FACTOR} times as wide for {@link DROP_GRACE_SECONDS};
 * - an entity well beyond what the ray hit — behind the wall it is pointing at — is passed over,
 *   when the caller knows where the ray hit.
 *
 * **Telling the conversation.** People point and then speak, and the call may not be live yet when
 * they point — "Hey Jarvis" comes after the finger — so the latest target is remembered: sent the
 * moment the call is live if it was pointed at within {@link QUEUED_FOR_SECONDS}, kept as the
 * conversation's context for {@link CLEAR_AFTER_SECONDS} after the pointing stops, and then cleared.
 * The same target is never sent twice in one conversation, and nothing is sent more often than once
 * every {@link MIN_SEND_INTERVAL_SECONDS}. Every update goes under one context id, so a newer one
 * supersedes the older.
 *
 * Pure: a state in, a state out, times in seconds on any steady clock.
 */

export type PointerKind = 'hand' | 'controller';

/** One ray that is pointing this frame. The caller includes a hand only while it is in a point pose. */
export interface PointerSource {
  id: string;
  kind: PointerKind;
  ray: Ray;
  /** How far along the ray it hit a real surface, when a hit test says. */
  hitDistance?: number;
}

/** A placed entity that could be pointed at: one whose anchor is located this frame. */
export interface PointingTarget {
  id: string;
  position: Vector3Like;
}

/** The half-angle of a hand's pointing cone. */
export const HAND_CONE_DEGREES = 7;

/** The half-angle of a controller's pointing cone: its ray is steadier. */
export const CONTROLLER_CONE_DEGREES = 4;

/** How much nearer the axis another entity has to be to take over from the current one. */
export const SWITCH_MARGIN_DEGREES = 2;

/** How much wider than its cone the current target may stray before it starts to be dropped. */
export const DROP_CONE_FACTOR = 1.5;

/** How long a new target has to stay the best before it counts. */
export const DWELL_SECONDS = 0.28;

/** How long the current target may stay outside the wider cone, or unseen, before it is dropped. */
export const DROP_GRACE_SECONDS = 0.2;

/** How far beyond the ray's hit an entity may be and still count, for one on the surface hit. */
export const OCCLUSION_SLACK_METRES = 0.4;

export interface PointingState {
  /** The committed target, and since when. */
  readonly pointed?: { id: string; since: number };
  /** A target waiting out its dwell. */
  readonly candidate?: { id: string; since: number };
  /** Since when the committed target has been outside its wider cone. */
  readonly strayingSince?: number;
}

export const NOT_POINTING: PointingState = {};

/** The angle, in degrees, between `ray` and the direction from its origin to `position`. */
export function angleToTarget(ray: Ray, position: Vector3Like): number {
  const x = position.x - ray.origin.x;
  const y = position.y - ray.origin.y;
  const z = position.z - ray.origin.z;
  const distance = Math.hypot(x, y, z);
  if (distance < 1e-9) return 0;
  const cosine = (x * ray.direction.x + y * ray.direction.y + z * ray.direction.z) / distance;
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI;
}

function coneOf(kind: PointerKind): number {
  return kind === 'hand' ? HAND_CONE_DEGREES : CONTROLLER_CONE_DEGREES;
}

/** Whether `target` lies beyond what `source`'s ray hit, by more than the slack. */
function isHidden(source: PointerSource, target: PointingTarget): boolean {
  if (source.hitDistance === undefined) return false;
  const distance = Math.hypot(
    target.position.x - source.ray.origin.x,
    target.position.y - source.ray.origin.y,
    target.position.z - source.ray.origin.z,
  );
  return distance > source.hitDistance + OCCLUSION_SLACK_METRES;
}

/**
 * How each target lies to the rays: its smallest angle to any ray that can see it, and whether that
 * is inside the ray's cone, or only inside the wider one.
 */
interface Aim {
  id: string;
  degrees: number;
  inCone: boolean;
  inWideCone: boolean;
}

function aimsAt(sources: readonly PointerSource[], targets: readonly PointingTarget[]): Aim[] {
  const aims: Aim[] = [];
  for (const target of targets) {
    let best: Aim | undefined;
    for (const source of sources) {
      if (isHidden(source, target)) continue;
      const degrees = angleToTarget(source.ray, target.position);
      const cone = coneOf(source.kind);
      const aim = { id: target.id, degrees, inCone: degrees <= cone, inWideCone: degrees <= cone * DROP_CONE_FACTOR };
      if (best === undefined || degrees < best.degrees) best = aim;
    }
    if (best !== undefined) aims.push(best);
  }
  return aims;
}

/** The target that should be pointed at, before dwell: the committed one unless another clearly beats it. */
function preferred(aims: readonly Aim[], current: string | undefined): string | undefined {
  let best: Aim | undefined;
  for (const aim of aims) if (aim.inCone && (best === undefined || aim.degrees < best.degrees)) best = aim;
  const kept = aims.find((aim) => aim.id === current && aim.inWideCone);
  if (kept === undefined) return best?.id;
  if (best === undefined || best.id === kept.id) return kept.id;
  return best.degrees < kept.degrees - SWITCH_MARGIN_DEGREES ? best.id : kept.id;
}

/** The next state, given this frame's pointing rays and the placed entities they could point at. */
export function stepPointing(
  state: PointingState,
  sources: readonly PointerSource[],
  targets: readonly PointingTarget[],
  now: number,
): PointingState {
  const aims = aimsAt(sources, targets);
  const current = state.pointed?.id;
  const keptInWideCone = aims.some((aim) => aim.id === current && aim.inWideCone);
  const strayingSince = current === undefined || keptInWideCone ? undefined : (state.strayingSince ?? now);
  const dropped = strayingSince !== undefined && now - strayingSince >= DROP_GRACE_SECONDS;
  const pointed = dropped ? undefined : state.pointed;
  const want = preferred(aims, pointed?.id);

  if (want === undefined || want === pointed?.id) {
    return { pointed, strayingSince: dropped ? undefined : strayingSince };
  }
  const candidate = state.candidate?.id === want ? state.candidate : { id: want, since: now };
  if (now - candidate.since >= DWELL_SECONDS) return { pointed: { id: want, since: now } };
  return { pointed, candidate, strayingSince: dropped ? undefined : strayingSince };
}

/** The context id every pointing update goes under, so each supersedes the last. */
export const POINTING_CONTEXT_ID = 'pointing';

/** How long a target pointed at before the call was live is still sent once it is. */
export const QUEUED_FOR_SECONDS = 15;

/** How long the conversation keeps a target as its context after the pointing stops. */
export const CLEAR_AFTER_SECONDS = 12;

/** The least time between two updates. */
export const MIN_SEND_INTERVAL_SECONDS = 1;

/** What is sent once nothing is pointed at any more. */
export const NOT_POINTING_TEXT = 'Sir is not pointing at anything.';

/** An entity pointed at, as the conversation is told about it. */
export interface PointedEntity {
  id: string;
  name?: string;
}

/**
 * What the conversation is told about `entity`: its name to talk about it by and its id to act on.
 * A double quote in the name would end the quoted name early, so it is turned into a single one.
 */
export function pointingText(entity: PointedEntity): string {
  const label = (entity.name ?? entity.id).replaceAll('"', "'");
  return `Sir is pointing at "${label}" (${entity.id}).`;
}

export interface PointingContextState {
  /** Whether the call was live at the last step. */
  readonly live: boolean;
  /** The last entity pointed at, and when it last was. */
  readonly latest?: { entity: PointedEntity; seenAt: number };
  /** What this conversation was last told, and when: an entity's id, or that there is nothing. */
  readonly told?: { id: string | null; at: number };
  readonly lastSentAt?: number;
}

export const NOTHING_TOLD: PointingContextState = { live: false };

export interface PointingContextStep {
  state: PointingContextState;
  /** An update to send now, under POINTING_CONTEXT_ID. */
  send?: string;
}

/** What the conversation should hold now: an entity, or nothing (null). */
function wanted(state: PointingContextState, pointing: boolean, now: number): PointedEntity | null {
  const latest = state.latest;
  if (latest === undefined) return null;
  if (pointing) return latest.entity;
  const told = state.told;
  if (told !== undefined && told.id === latest.entity.id) {
    return now - Math.max(latest.seenAt, told.at) < CLEAR_AFTER_SECONDS ? latest.entity : null;
  }
  return now - latest.seenAt < QUEUED_FOR_SECONDS ? latest.entity : null;
}

/**
 * The next state, and the update to send if there is one, given what is pointed at this frame and
 * whether the call is live.
 */
export function stepPointingContext(
  previous: PointingContextState,
  pointed: PointedEntity | undefined,
  live: boolean,
  now: number,
): PointingContextStep {
  // A call that has just gone live, or just ended, is a conversation that has been told nothing.
  const fresh = live !== previous.live;
  const state: PointingContextState = {
    live,
    latest: pointed === undefined ? previous.latest : { entity: pointed, seenAt: now },
    told: fresh ? undefined : previous.told,
    lastSentAt: fresh ? undefined : previous.lastSentAt,
  };
  if (!live) return { state };
  const entity = wanted(state, pointed !== undefined, now);
  const toldId = state.told?.id ?? null;
  const message =
    entity !== null && entity.id !== toldId
      ? pointingText(entity)
      : entity === null && toldId !== null
        ? NOT_POINTING_TEXT
        : undefined;
  if (message === undefined) return { state };
  if (state.lastSentAt !== undefined && now - state.lastSentAt < MIN_SEND_INTERVAL_SECONDS) return { state };
  return { state: { ...state, told: { id: entity?.id ?? null, at: now }, lastSentAt: now }, send: message };
}

/**
 * What would be sent the moment the call went live: for the debug hook, since offline — in the
 * browser tests — the call never is.
 */
export function pendingPointingContext(state: PointingContextState, now: number): string | undefined {
  const latest = state.latest;
  if (latest === undefined || now - latest.seenAt >= QUEUED_FOR_SECONDS) return undefined;
  if (state.live && state.told?.id === latest.entity.id) return undefined;
  return pointingText(latest.entity);
}
