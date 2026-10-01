import type { AffectedEntity } from './affected-entities.js';
import { logger } from './logger.js';

/**
 * What the server tells sir's devices as it happens, rather than when they ask: the events the
 * WebSocket API pushes to every device holding a socket open (`verticals/api/live-socket.ts`).
 *
 * A channel of its own, in `utils`, so that whatever has something to say -- routing, as a tool
 * reports what it touched -- needs no import from the API vertical, and the API vertical needs none
 * from it. An event is published whether or not anyone is listening: in Studio's process, which
 * serves no sockets, it simply goes nowhere.
 *
 * A device subscribes by holding a socket open, and acts on the events it cares about: the headset
 * lights up what a request is touching, and the phone and the watch need not do anything at all.
 */
export type LiveEvent = {
  type: 'affectedEntities';
  /** What a request's tool just read or changed. See `affected-entities.ts`. */
  entities: AffectedEntity[];
};

type LiveEventListener = (event: LiveEvent) => void;

const listeners = new Set<LiveEventListener>();

/** Hands `event` to every listener. Never throws: a listener that fails is logged and skipped. */
export function publishLiveEvent(event: LiveEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.warn('A live event listener failed', {
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Calls `listener` with every event published from now on. Returns how to stop. */
export function onLiveEvent(listener: LiveEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
