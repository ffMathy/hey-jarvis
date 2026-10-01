import { LEAVING_SECONDS } from 'hologram';

/**
 * How long a corona stays lit around an entity Jarvis said he was working on.
 *
 * A `markAffected` call says which entities a request touches, and nothing ever says the work is
 * done: the agents' tools finish on the server, and the voice agent's own tool events only say when
 * he is waiting on the routing workflow. So a corona is lit by a mark and kept by the evidence at
 * hand:
 *
 * - **Every mark shows for at least {@link MIN_SHOWN_SECONDS}**, so a quick request still visibly
 *   lands on the lamp it was about.
 * - **It is held while he is thinking** — the conversation's `thinking`, which is what his own
 *   scan shows — for up to {@link HELD_WHILE_THINKING_SECONDS} after its last mark, so a thought
 *   that never settles cannot leave a lamp lit all evening.
 * - **It fades out over his leave time** once neither holds it, or at once when the conversation
 *   ends, and fades in quickly when marked, from wherever it had faded to.
 *
 * Pure: a state in, a state out, times in seconds on any steady clock (the XR frame's).
 */

/** The least time a mark keeps its corona lit. */
export const MIN_SHOWN_SECONDS = 2.5;

/** The longest thinking holds a corona after its last mark. */
export const HELD_WHILE_THINKING_SECONDS = 25;

/** How long a corona takes to go out: the time he takes to leave. */
export const CORONA_FADE_OUT_SECONDS = LEAVING_SECONDS;

/** How long a corona takes to light: quick, since it is answering something just said. */
export const CORONA_FADE_IN_SECONDS = 0.25;

interface AffectedEntry {
  lastMarkedAt: number;
  /** How lit it is, 0–1. */
  level: number;
  /** The conversation it was marked in has ended: it fades whatever else would hold it. */
  released: boolean;
}

export interface AffectedState {
  readonly entries: ReadonlyMap<string, AffectedEntry>;
  /** When the levels were last brought up to date. */
  readonly steppedAt: number | undefined;
}

export const NOTHING_AFFECTED: AffectedState = { entries: new Map(), steppedAt: undefined };

/** One corona to draw: which entity, and how lit (0–1). */
export interface CoronaLevel {
  id: string;
  level: number;
}

/** Marks `ids` as being worked on at `now`, lighting a corona for each from the next step. */
export function markAffected(state: AffectedState, ids: readonly string[], now: number): AffectedState {
  if (ids.length === 0) return state;
  const entries = new Map(state.entries);
  for (const id of ids) {
    entries.set(id, { lastMarkedAt: now, level: entries.get(id)?.level ?? 0, released: false });
  }
  return { ...state, entries };
}

/** The conversation ended: every corona fades out, whatever held it. */
export function releaseAffected(state: AffectedState): AffectedState {
  if (state.entries.size === 0) return state;
  const entries = new Map<string, AffectedEntry>();
  for (const [id, entry] of state.entries) entries.set(id, { ...entry, released: true });
  return { ...state, entries };
}

/** Whether a mark still holds its corona lit at `now`. */
function isHeld(entry: AffectedEntry, now: number, thinking: boolean): boolean {
  if (entry.released) return false;
  const since = now - entry.lastMarkedAt;
  return since < MIN_SHOWN_SECONDS || (thinking && since < HELD_WHILE_THINKING_SECONDS);
}

/**
 * Brings every corona's level up to `now`: rising towards 1 while it is held, falling towards 0 once
 * it is not, and forgotten once it is out.
 */
export function stepAffected(state: AffectedState, now: number, thinking: boolean): AffectedState {
  const elapsed = state.steppedAt === undefined ? 0 : Math.max(0, now - state.steppedAt);
  const entries = new Map<string, AffectedEntry>();
  for (const [id, entry] of state.entries) {
    const level = isHeld(entry, now, thinking)
      ? Math.min(1, entry.level + elapsed / CORONA_FADE_IN_SECONDS)
      : Math.max(0, entry.level - elapsed / CORONA_FADE_OUT_SECONDS);
    // One that is out and no longer held is gone; one just marked starts at 0 and is kept to rise.
    if (level <= 0 && !isHeld(entry, now, thinking)) continue;
    entries.set(id, { ...entry, level });
  }
  return { entries, steppedAt: now };
}

/** The coronas to draw, brightest first: every entity with any light left. */
export function coronaLevels(state: AffectedState): CoronaLevel[] {
  const levels: CoronaLevel[] = [];
  for (const [id, entry] of state.entries) if (entry.level > 0) levels.push({ id, level: entry.level });
  return levels.sort((first, second) => second.level - first.level || first.id.localeCompare(second.id));
}

/** Every entity with a corona lit, lighting or fading, for the debug hook. */
export function affectedIds(state: AffectedState): string[] {
  return [...state.entries.keys()].sort();
}
