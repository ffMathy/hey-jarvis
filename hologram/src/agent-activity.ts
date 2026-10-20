/**
 * Which of his agents Jarvis has at work on a request, and where each has got to. The Jarvis server
 * pushes it to every device over the line each one holds open (`jarvis-server-link.ts`), in an
 * `agentActivity` message, as the routing plan names a delegation, its agent starts, calls a tool,
 * stops to ask something, and answers or fails. The headset shows each one as a satellite round him.
 *
 * The delegation and the agent are opaque, like an entity's id: compared, never parsed — a new agent
 * on the server should need no change on a device, which shows one it does not know as it shows any.
 *
 * The message comes from a server this device does not control, over the network, so it is read
 * strictly: the declared shape only, a state from the list below, and ids that are usable strings
 * within the limit. Anything else is dropped. The worst a wrong one can do is draw a satellite.
 */

/**
 * - `planned` — the plan names it, and it has not been seen to do anything yet;
 * - `working` — its agent has started;
 * - `tool` — its agent just called a tool: a moment, after which it is still working;
 * - `asking` — it stopped on a question only sir can answer;
 * - `answered` / `failed` — it is done.
 */
export type AgentActivityState = 'planned' | 'working' | 'tool' | 'asking' | 'answered' | 'failed';

export const AGENT_ACTIVITY_STATES: readonly AgentActivityState[] = [
  'planned',
  'working',
  'tool',
  'asking',
  'answered',
  'failed',
];

/** One delegation's news. */
export interface AgentActivity {
  /** Opaque, unique across requests. */
  readonly delegationId: string;
  /** Opaque: `weather`, `calendar`, `internetOfThings`… as the server's planner names its agents. */
  readonly agentId: string;
  readonly state: AgentActivityState;
}

/** The longest delegation or agent id that is taken: longer than any the server makes. */
export const AGENT_ACTIVITY_ID_MAX_LENGTH = 200;

function usableId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return id.length > 0 && id.length <= AGENT_ACTIVITY_ID_MAX_LENGTH ? id : undefined;
}

function isState(value: unknown): value is AgentActivityState {
  return AGENT_ACTIVITY_STATES.some((state) => state === value);
}

/** The activity an `agentActivity` message carries, or `undefined` for one that is not usable. Never throws. */
export function agentActivityOf(message: unknown): AgentActivity | undefined {
  if (typeof message !== 'object' || message === null) return undefined;
  const delegationId = usableId('delegationId' in message ? message.delegationId : undefined);
  const agentId = usableId('agentId' in message ? message.agentId : undefined);
  const state = 'state' in message ? message.state : undefined;
  if (delegationId === undefined || agentId === undefined || !isState(state)) return undefined;
  return { delegationId, agentId, state };
}
