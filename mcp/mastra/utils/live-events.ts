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
 * lights up what a request is touching and shows which agents are working on it, and the phone
 * shows the latest glance when sir opens Jarvis from the launcher.
 */
export type LiveEvent =
  | {
      type: 'affectedEntities';
      /** What a request's tool just read or changed. See `affected-entities.ts`. */
      entities: AffectedEntity[];
    }
  | ({ type: 'agentActivity' } & AgentActivity)
  | {
      type: 'glance';
      /** The page the phone shows when sir opens Jarvis from the launcher. See `visualize/glance.ts`. */
      glance: GlanceSummary;
    };

/** One button on a glance: what it says, and the request Jarvis runs when it is pressed. */
export interface GlanceAction {
  /** A short slug, `[a-z0-9-]`, unique on its glance: what the page and the device name it by. */
  id: string;
  /** The button's text. */
  label: string;
  /** The request it stands for, as sir would say it to Jarvis: "Unlock the front door". */
  prompt: string;
}

/**
 * The current glance as a device is told of it: the page to show and the actions on it.
 *
 * The id names this one build of the glance, so an action pressed on a page that has since been
 * replaced is recognised as stale and refused.
 */
export interface GlanceSummary {
  id: string;
  /** Where the page is hosted. */
  url: string;
  title: string;
  /** When it was built, as an ISO 8601 timestamp. */
  generatedAt: string;
  actions: GlanceAction[];
}

/**
 * Where one of a request's delegations has got to, for sir's headset to show him at work: a
 * satellite round Jarvis for each agent a request is using, which flares on every tool it calls
 * and folds back into him when it answers.
 *
 * - `planned` — the plan names it, and it has not been seen to do anything yet;
 * - `working` — its agent has started streaming;
 * - `tool` — its agent just called a tool: a moment, not a state, and it is still working after it;
 * - `asking` — it stopped on a question only sir can answer;
 * - `answered` / `failed` — it is done, one way or the other.
 */
export type AgentActivityState = 'planned' | 'working' | 'tool' | 'asking' | 'answered' | 'failed';

export interface AgentActivity {
  /** The delegation, unique across requests (a plan's step ids carry the plan's own id). Opaque. */
  delegationId: string;
  /** The agent delegated to, as the planner names it: `weather`, `calendar`, `internetOfThings`… */
  agentId: string;
  state: AgentActivityState;
  /**
   * How the agent is drawn, as an SVG path its vertical declares (`verticals/agent-glyphs.ts`);
   * left out for an agent with none, which a device draws as a plain ring.
   */
  glyph?: string;
}

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
