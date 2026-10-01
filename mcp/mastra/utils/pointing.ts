import { type AffectedEntity, cleanAffectedEntities } from './affected-entities.js';

/**
 * What sir is pointing at, as his headset last said over the WebSocket API
 * (`verticals/api/live-socket.ts`), so that "turn that on" can be routed to the thing he means.
 *
 * The headset says it whenever it changes -- an entity, or nothing -- and routing reads it the moment
 * a request arrives (`withPointing`), writing the thing into the request by its id: nothing but the
 * request's text reaches the planner, which copies the id into the prompt it writes, and the agent
 * then acts on exactly that id rather than guessing which light "that" was. The voice agent hears
 * none of it.
 *
 * Kept per socket, so a headset that disconnects stops pointing at anything, and the newest report
 * from any of them wins: routing is told nothing about which conversation it serves.
 */

interface Pointed {
  entity: AffectedEntity;
  /** Which report this was, so the newest across sockets wins. */
  order: number;
}

const pointedBySource = new Map<object, Pointed>();
let reports = 0;

/** Records what `source` -- one socket -- says sir is pointing at, or that he points at nothing. */
export function reportPointing(source: object, entity: AffectedEntity | undefined): void {
  const [cleaned] = entity === undefined ? [] : cleanAffectedEntities([entity]);
  if (cleaned === undefined) {
    pointedBySource.delete(source);
    return;
  }
  reports += 1;
  pointedBySource.set(source, { entity: cleaned, order: reports });
}

/** Forgets what `source` said, for a socket that has closed. */
export function forgetPointing(source: object): void {
  pointedBySource.delete(source);
}

/** What sir is pointing at now, by the newest report of any socket, or nothing. */
export function currentPointing(): AffectedEntity | undefined {
  let newest: Pointed | undefined;
  for (const pointed of pointedBySource.values()) {
    if (newest === undefined || pointed.order > newest.order) {
      newest = pointed;
    }
  }
  return newest?.entity;
}

/**
 * The request as the planner should read it: as sir said it, and with what he is pointing at after
 * it when he is pointing at something -- `Turn that on (pointing at "Kitchen ceiling", id
 * light.kitchen_ceiling)`.
 */
export function withPointing(userQuery: string): string {
  const pointed = currentPointing();
  if (pointed === undefined) {
    return userQuery;
  }
  const name = pointed.name === undefined ? '' : `"${pointed.name}", `;
  return `${userQuery} (pointing at ${name}id ${pointed.id})`;
}

/** Forgets every report, for a spec. */
export function resetPointingForTest(): void {
  pointedBySource.clear();
  reports = 0;
}
