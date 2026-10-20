import type { AgentActivity } from './agent-activity';

/**
 * Seeing him work: one satellite round Jarvis for each of his agents a request is using, from the
 * Jarvis server's `agentActivity` messages (`agent-activity.ts`). Every device that is him shows
 * them the same way: the headset round him in the room (`vr/src/hologram3d/satellites.ts`), the
 * phone and its web build round the sphere on the screen (`satellite-drawing.ts`), each with the glyph
 * its agent's vertical on the server draws it with.
 *
 * - **Planned**, a delegation's satellite comes out dim on his orbit: the plan names it, and it has
 *   not been seen to do anything yet.
 * - **Working**, it is lit; each **tool** call flares it for {@link FLARE_SECONDS}.
 * - **Asking**, it is lit and held — it waits on sir — until the conversation ends.
 * - **Answered**, it folds back into him over {@link FOLD_SECONDS}: the orbit closes on his centre.
 * - **Failed**, it drifts outwards and goes out over the same time, without reaching him.
 *
 * Nothing it shows can outlast what it knows: a satellite with no news for {@link STALE_SECONDS}
 * (but one asking) goes out as failed, since a dropped line or a lost event would otherwise leave it
 * circling all evening, and the end of the conversation folds every one in.
 *
 * Pure: a state in, a state out, times in seconds on any steady clock (the XR frame's, the phone's
 * `performance.now`). Where each one is round him is {@link satelliteOrbits}' to say, as a place on
 * an orbit of radius 1; each device scales that to his size.
 */

/** How long a tool call's flare takes to die away. */
export const FLARE_SECONDS = 0.6;

/** How long an answered satellite takes to fold into him, and a failed one to go out. */
export const FOLD_SECONDS = 0.9;

/** How long a satellite comes out over. */
export const APPEAR_SECONDS = 0.35;

/** How long a satellite waits for news before it is taken for lost. */
export const STALE_SECONDS = 90;

/** The most satellites at once: past that, the newest delegations are not shown. */
export const MAX_SATELLITES = 8;

/** How bright a planned satellite is, against a working one's 1. */
export const PLANNED_BRIGHTNESS = 0.4;

/** How far out a failed satellite drifts before it is gone, in orbit radii. */
export const FAILED_DRIFT = 0.35;

/** How long the orbit takes to go round once. */
export const ORBIT_SECONDS = 9;

/** How far the orbit's plane is tilted off level, so the satellites pass in front of him and behind. */
export const ORBIT_TILT_RADIANS = (18 * Math.PI) / 180;

/** How fast a satellite closes the gap to its place when the count changes, per second. */
const SPACING_RATE = 3;

/**
 * The glyph a satellite is drawn with when its agent's message brought none: a plain ring, so an
 * agent whose vertical draws nothing still shows as at work. The rest come from the server, each
 * vertical declaring its own (`mcp/mastra/verticals/agent-glyphs.ts`).
 */
export const PLAIN_RING_GLYPH = 'M 0.45 0 A 0.45 0.45 0 1 0 -0.45 0 A 0.45 0.45 0 1 0 0.45 0 Z';

type SatelliteStatus = 'planned' | 'working' | 'asking' | 'answered' | 'failed';

interface Satellite {
  readonly agentId: string;
  /** Its agent's glyph, as its latest message drew it; none yet, and it is a plain ring. */
  readonly glyph: string | undefined;
  readonly status: SatelliteStatus;
  /** When it last had news. */
  readonly heardAt: number;
  /** When it last called a tool, if it has. */
  readonly toolAt: number | undefined;
  /** When it answered or failed, if it has. */
  readonly endedAt: number | undefined;
  /** How far it has come out, 0–1. */
  readonly presence: number;
  /** Where it is round the orbit, in turns from the first satellite: eased towards its place. */
  readonly offset: number;
  /** In the order they came, so a satellite keeps its place in the ring. */
  readonly order: number;
}

export interface AgentWorkState {
  /** By delegation id. */
  readonly satellites: ReadonlyMap<string, Satellite>;
  readonly steppedAt: number | undefined;
  /** How many have ever come, for the next one's order. */
  readonly arrivals: number;
}

export const NO_WORK: AgentWorkState = { satellites: new Map(), steppedAt: undefined, arrivals: 0 };

function isEnded(status: SatelliteStatus): boolean {
  return status === 'answered' || status === 'failed';
}

/** What `activity` says of a satellite, which a later message never takes back once it has ended. */
function statusAfter(previous: SatelliteStatus | undefined, activity: AgentActivity): SatelliteStatus {
  switch (activity.state) {
    case 'planned':
      // A delegation planned again after it ended is a new request reusing its id: it starts over.
      return previous === undefined || isEnded(previous) ? 'planned' : previous;
    case 'tool':
    case 'working':
      return 'working';
    default:
      return activity.state;
  }
}

/**
 * Takes in one `agentActivity` message at `now`. A delegation that has ended takes no more news, but
 * one planned again — a new request reusing its id — starts over as a new satellite.
 */
export function recordActivity(state: AgentWorkState, activity: AgentActivity, now: number): AgentWorkState {
  const known = state.satellites.get(activity.delegationId);
  if (known === undefined || (isEnded(known.status) && activity.state === 'planned')) {
    return addSatellite(state, activity, now);
  }
  if (isEnded(known.status)) return state;
  const status = statusAfter(known.status, activity);
  const satellites = new Map(state.satellites);
  satellites.set(activity.delegationId, {
    ...known,
    status,
    glyph: activity.glyph ?? known.glyph,
    heardAt: now,
    toolAt: activity.state === 'tool' ? now : known.toolAt,
    endedAt: isEnded(status) ? now : undefined,
  });
  return { ...state, satellites };
}

/** A new satellite for `activity`, in the ring's widest gap: none for one already done, or past the most. */
function addSatellite(state: AgentWorkState, activity: AgentActivity, now: number): AgentWorkState {
  const status = statusAfter(undefined, activity);
  if (isEnded(status) || liveCount(state) >= MAX_SATELLITES) return state;
  const satellites = new Map(state.satellites);
  satellites.set(activity.delegationId, {
    agentId: activity.agentId,
    glyph: activity.glyph,
    status,
    heardAt: now,
    toolAt: activity.state === 'tool' ? now : undefined,
    endedAt: undefined,
    presence: 0,
    offset: placeOf(state, state.arrivals),
    order: state.arrivals,
  });
  return { ...state, satellites, arrivals: state.arrivals + 1 };
}

/** The conversation is over: whatever is still out folds in, as if it had answered. */
export function releaseWork(state: AgentWorkState, now: number): AgentWorkState {
  if (state.satellites.size === 0) return state;
  const satellites = new Map<string, Satellite>();
  for (const [id, satellite] of state.satellites) {
    satellites.set(id, isEnded(satellite.status) ? satellite : { ...satellite, status: 'answered', endedAt: now });
  }
  return { ...state, satellites };
}

function liveCount(state: AgentWorkState): number {
  let count = 0;
  for (const satellite of state.satellites.values()) if (!isEnded(satellite.status)) count++;
  return count;
}

/** Where a newcomer with `order` goes: in the widest gap of the ring, or straight across from the one there. */
function placeOf(state: AgentWorkState, order: number): number {
  const taken = [...state.satellites.values()]
    .filter((satellite) => !isEnded(satellite.status))
    .map((satellite) => wrap(satellite.offset))
    .sort((first, second) => first - second);
  if (taken.length === 0) return order === 0 ? 0 : wrap(order * 0.38);
  let widest = { start: taken[taken.length - 1] ?? 0, size: 1 - (taken[taken.length - 1] ?? 0) + (taken[0] ?? 0) };
  for (let index = 1; index < taken.length; index++) {
    const start = taken[index - 1] ?? 0;
    const size = (taken[index] ?? 0) - start;
    if (size > widest.size) widest = { start, size };
  }
  return wrap(widest.start + widest.size / 2);
}

function wrap(turns: number): number {
  return turns - Math.floor(turns);
}

/** The signed shortest way round from `from` to `to`, in turns: −0.5 to 0.5. */
function turnsBetween(from: number, to: number): number {
  return wrap(to - from + 0.5) - 0.5;
}

/**
 * Brings every satellite up to `now`: out while it is live, in once it has ended; spread evenly round
 * the ring, each easing to its place; and forgotten once it has folded away.
 */
export function stepWork(state: AgentWorkState, now: number): AgentWorkState {
  const elapsed = state.steppedAt === undefined ? 0 : Math.max(0, now - state.steppedAt);
  const live = [...state.satellites.entries()]
    .filter(([, satellite]) => !isEnded(satellite.status))
    .sort(([, first], [, second]) => first.order - second.order);
  const first = live[0]?.[1].offset ?? 0;
  const places = new Map(live.map(([id], index) => [id, wrap(first + index / live.length)]));

  const satellites = new Map<string, Satellite>();
  for (const [id, satellite] of state.satellites) {
    const stale =
      !isEnded(satellite.status) && satellite.status !== 'asking' && now - satellite.heardAt > STALE_SECONDS;
    const current: Satellite = stale ? { ...satellite, status: 'failed', endedAt: now } : satellite;
    if (current.endedAt !== undefined && now - current.endedAt >= FOLD_SECONDS) continue;
    const place = places.get(id);
    const ease = 1 - Math.exp(-SPACING_RATE * elapsed);
    satellites.set(id, {
      ...current,
      presence: Math.min(1, current.presence + elapsed / APPEAR_SECONDS),
      offset: place === undefined ? current.offset : wrap(current.offset + turnsBetween(current.offset, place) * ease),
    });
  }
  return { ...state, satellites, steppedAt: now };
}

/**
 * One satellite to draw, wherever a device draws it: which glyph, how lit, and where on the orbit —
 * as a fixed share of a turn, which the device adds its own clock to ({@link orbitPoint}), so it
 * goes round as smoothly as that device draws frames however seldom this is worked out.
 */
export interface SatelliteOrbit {
  /** An SVG path in glyph radii, y down: see `agent-activity.ts`. */
  glyph: string;
  /** How lit it is, 0–1: its presence, its brightness for its status, and its fold. */
  level: number;
  /** A tool call's flare, 1 the moment it is called and 0 once it has died away. */
  flare: number;
  /** Whether it is waiting on sir, which the drawing pulses. */
  asking: boolean;
  /** Where it is round the orbit at time 0, in turns. */
  turn: number;
  /** How far out it is, in orbit radii: 1 on the orbit, less as it folds in, more as a failed one drifts out. */
  reach: number;
}

/** Smoothstep, 0–1. */
function ease(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * Every satellite at `now`, in the order they came. An answered one's reach closes on his centre as
 * it folds; a failed one's opens as it goes out.
 */
export function satelliteOrbits(state: AgentWorkState, now: number): SatelliteOrbit[] {
  const ordered = [...state.satellites.values()].sort((first, second) => first.order - second.order);
  return ordered.map((satellite) => {
    const fold = satellite.endedAt === undefined ? 0 : ease((now - satellite.endedAt) / FOLD_SECONDS);
    const failed = satellite.status === 'failed';
    const brightness = satellite.status === 'planned' ? PLANNED_BRIGHTNESS : 1;
    const flare = satellite.toolAt === undefined ? 0 : Math.max(0, 1 - (now - satellite.toolAt) / FLARE_SECONDS);
    return {
      glyph: satellite.glyph ?? PLAIN_RING_GLYPH,
      level: ease(satellite.presence) * brightness * (1 - fold * (failed ? 1 : 0.6)),
      flare: flare * flare,
      asking: satellite.status === 'asking',
      turn: satellite.offset,
      reach: failed ? 1 + FAILED_DRIFT * fold : 1 - fold,
    };
  });
}

/** Where a satellite is on an orbit of radius 1 round his centre at `time`. */
export interface OrbitPoint {
  /** To his right. */
  across: number;
  /** Above his centre. */
  up: number;
  /** Towards whoever is looking at him: positive in front of him, negative behind. */
  towards: number;
}

/**
 * Where `orbit` is at `time` seconds on the drawing device's clock: going round once every
 * {@link ORBIT_SECONDS}, on a ring tilted {@link ORBIT_TILT_RADIANS} so its near side is below his
 * centre and its far side above, as a ring seen from a little above it is.
 */
export function orbitPoint(orbit: Pick<SatelliteOrbit, 'turn' | 'reach'>, time: number): OrbitPoint {
  'worklet';
  const angle = 2 * Math.PI * (time / ORBIT_SECONDS + orbit.turn);
  const along = Math.sin(angle) * orbit.reach;
  return {
    across: Math.cos(angle) * orbit.reach,
    up: -along * Math.sin(ORBIT_TILT_RADIANS),
    towards: along * Math.cos(ORBIT_TILT_RADIANS),
  };
}

/** What the debug hook says of the satellites: each one's agent and status, in the order they came. */
export function describeWork(state: AgentWorkState): { agentId: string; status: string }[] {
  return [...state.satellites.values()]
    .sort((first, second) => first.order - second.order)
    .map(({ agentId, status }) => ({ agentId, status }));
}

/**
 * The agents sample mode's thinking pretends to have at work, with no server: made up, with glyphs
 * of their own, since every real agent's glyph is its vertical's on the server.
 */
export const SAMPLE_AGENTS = [
  { agentId: 'sampleDiamond', glyph: 'M 0 -0.7 L 0.7 0 L 0 0.7 L -0.7 0 Z' },
  { agentId: 'sampleSquare', glyph: 'M -0.55 -0.55 L 0.55 -0.55 L 0.55 0.55 L -0.55 0.55 Z' },
  { agentId: 'sampleCross', glyph: 'M -0.65 0 L 0.65 0 M 0 -0.65 L 0 0.65' },
] as const;

/** How often one of sample mode's pretend agents calls a tool, taking turns. */
export const SAMPLE_TOOL_SECONDS = 1.4;

const sampleDelegationId = (agentId: string) => `sample-${agentId}`;

/**
 * Sample mode's satellites: while it pretends to think, {@link SAMPLE_AGENTS} are at work, one of
 * them calling a tool every {@link SAMPLE_TOOL_SECONDS} in turn; once it stops, they answer. Fed
 * through {@link recordActivity}, as the server's messages are, so it shows exactly what they would.
 */
export function pretendWork(state: AgentWorkState, pretending: boolean, now: number): AgentWorkState {
  let next = state;
  const beat = Math.floor(now / SAMPLE_TOOL_SECONDS);
  SAMPLE_AGENTS.forEach(({ agentId, glyph }, index) => {
    const delegationId = sampleDelegationId(agentId);
    const satellite = next.satellites.get(delegationId);
    const live = satellite !== undefined && !isEnded(satellite.status);
    if (!pretending) {
      if (live) next = recordActivity(next, { delegationId, agentId, glyph, state: 'answered' }, now);
      return;
    }
    if (!live) next = recordActivity(next, { delegationId, agentId, glyph, state: 'working' }, now);
    const toolAt = next.satellites.get(delegationId)?.toolAt;
    const calledThisBeat = toolAt !== undefined && Math.floor(toolAt / SAMPLE_TOOL_SECONDS) === beat;
    if (beat % SAMPLE_AGENTS.length === index && !calledThisBeat) {
      next = recordActivity(next, { delegationId, agentId, glyph, state: 'tool' }, now);
    }
  });
  return next;
}
