import { z } from 'zod';
import type { ServerMessage } from './conversation-strategy';
import { isRouteToolName, readRoutingLoop } from './routing-loop';

/**
 * The headset's half of lighting up what Jarvis works on, as the agent sees it.
 *
 * The headset says once, when it connects, that it can light things up and see what sir points at.
 * The agent calls `markAffected` with whatever the routing loop relays as affected, but only after
 * hearing that. And while sir points at something, the headset keeps the agent told what it is, so
 * "that" can be routed by its id.
 *
 * The sentences below are the headset's, copied because this package imports nothing of the
 * devices': the device context is the one the headset session passes as `deviceContext`
 * (`horizon/src/conversation/`), the pointing ones come from its pointing policy
 * (`horizon/src/entities/`). If the two drift apart, the prompt's gate stops matching what the
 * headset says, and the specs here go on testing a sentence the headset no longer sends.
 */

/** What the headset tells the agent once connected, and what the prompt gates `markAffected` on. */
export const HEADSET_DEVICE_CONTEXT =
  "This conversation is on sir's headset, which lights up what you are working on and tells you what he is pointing at.";

/** The context id the device context travels under. */
export const DEVICE_CONTEXT_ID = 'device';

/** The context id every pointing update shares, so each one replaces the last. */
export const POINTING_CONTEXT_ID = 'pointing';

/** What the headset says once sir has stopped pointing at anything for a while. */
export const NOT_POINTING_CONTEXT = 'Sir is not pointing at anything.';

/**
 * The client tool that lights up what a request touches, spelled as the headset registers it in
 * `hologram/` and as Mastra's routing instructions name it in `mcp/mastra/verticals/routing/`.
 * Nothing but the specs in this package stand between those spellings and `agent-config.json`.
 */
export const MARK_AFFECTED_TOOL_NAME = 'markAffected';

/**
 * Something a request is reading or changing: an opaque id from whichever agent touched it — a
 * light, an inbox, a calendar — and a display name when that agent had one.
 */
export interface AffectedEntity {
  id: string;
  name?: string;
}

/** What the headset says while sir points at something. */
export function pointingContext(entity: Required<AffectedEntity>): string {
  return `Sir is pointing at "${entity.name}" (${entity.id}).`;
}

const markAffectedParametersSchema = z.object({
  entities: z.array(z.unknown()),
});

const markedEntitySchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().optional(),
});

/** One `markAffected` call, as the headset would have received it. */
export interface MarkAffectedCall {
  toolCallId: string;
  /** The entities it passed in the shape the headset reads. */
  entities: AffectedEntity[];
  /** Whatever it passed that the headset would have ignored, kept so a failure can quote it. */
  ignored: unknown[];
}

/** Every `markAffected` call the agent made, in the order it made them. */
export function readMarkAffectedCalls(messages: ServerMessage[]): MarkAffectedCall[] {
  return messages.flatMap((message) => {
    if (message.type !== 'client_tool_call' || message.client_tool_call.tool_name !== MARK_AFFECTED_TOOL_NAME) {
      return [];
    }

    const parameters = markAffectedParametersSchema.safeParse(message.client_tool_call.parameters);
    if (!parameters.success) {
      return [
        {
          toolCallId: message.client_tool_call.tool_call_id,
          entities: [],
          ignored: [message.client_tool_call.parameters],
        },
      ];
    }

    const entities: AffectedEntity[] = [];
    const ignored: unknown[] = [];
    for (const candidate of parameters.data.entities) {
      const entity = markedEntitySchema.safeParse(candidate);
      if (entity.success) {
        entities.push(entity.data);
      } else {
        ignored.push(candidate);
      }
    }
    return [{ toolCallId: message.client_tool_call.tool_call_id, entities, ignored }];
  });
}

/** Every entity the routing loop relayed as affected, in the order it first relayed each one. */
export function readRelayedAffectedEntities(messages: ServerMessage[]): AffectedEntity[] {
  const relayed = new Map<string, AffectedEntity>();
  for (const step of readRoutingLoop(messages).steps) {
    for (const entity of step.report?.affectedEntities ?? []) {
      if (!relayed.has(entity.id)) {
        relayed.set(entity.id, entity);
      }
    }
  }
  return [...relayed.values()];
}

/**
 * The ids the agent marked that the routing loop never relayed. Each one is an id the model
 * mistyped, shortened or made up — which on the headset lights up the wrong thing, or nothing.
 */
export function findUnrelayedMarks(messages: ServerMessage[]): string[] {
  const relayed = new Set(readRelayedAffectedEntities(messages).map((entity) => entity.id));
  return readMarkAffectedCalls(messages)
    .flatMap((call) => call.entities.map((entity) => entity.id))
    .filter((id) => !relayed.has(id));
}

/**
 * What each `routePromptWorkflow` call was asked, once per call. ElevenLabs reports a call twice,
 * loading and then settled, with the same parameters each time.
 */
export function readRoutedQueries(messages: ServerMessage[]): string[] {
  const queries = new Map<string, string>();
  for (const message of messages) {
    if (message.type !== 'mcp_tool_call' || !isRouteToolName(message.mcp_tool_call.tool_name)) {
      continue;
    }
    const callId = message.mcp_tool_call.tool_call_id || `position:${queries.size}`;
    if (queries.has(callId)) {
      continue;
    }
    // `userQuery`, as the workflow's input schema names it. Should ElevenLabs ever relay the
    // parameters in some other envelope, the whole of them is searched instead of nothing.
    const parameters = message.mcp_tool_call.parameters;
    const userQuery = parameters?.userQuery;
    queries.set(callId, typeof userQuery === 'string' ? userQuery : JSON.stringify(parameters ?? {}));
  }
  return [...queries.values()];
}
