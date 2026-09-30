import { describe, expect, it } from 'bun:test';
import { readFile } from 'fs/promises';
import * as path from 'path';
import { latestContextualUpdates, type ServerMessage, transcriptOf } from '../utils/conversation-strategy.js';
import {
  findUnrelayedMarks,
  HEADSET_DEVICE_CONTEXT,
  NOT_POINTING_CONTEXT,
  POINTING_CONTEXT_ID,
  pointingContext,
  readMarkAffectedCalls,
  readRelayedAffectedEntities,
  readRoutedQueries,
} from '../utils/headset.js';

/**
 * The headset eval needs live credentials and a tunnel; this does not. It pins down what the
 * detectors behind that eval read off the connection — which entities were marked, which were
 * relayed, what was routed — and that the prompt still quotes the sentences the headset sends, so
 * a drift in any of them fails here, on every push, instead of quietly blinding the eval.
 */

const KITCHEN = { id: 'light.kitchen_ceiling', name: 'Kitchen ceiling light' };
const INBOX = { id: 'inbox:work', name: 'Work inbox' };

let nextCallId = 0;

function marked(parameters: Record<string, unknown>): ServerMessage {
  nextCallId += 1;
  return {
    type: 'client_tool_call',
    client_tool_call: { tool_name: 'markAffected', tool_call_id: `client-${nextCallId}`, parameters },
  };
}

function mcpCall(toolName: string, payload: unknown, parameters?: Record<string, unknown>): ServerMessage[] {
  nextCallId += 1;
  const callId = `mcp-${nextCallId}`;
  return [
    {
      type: 'mcp_tool_call',
      mcp_tool_call: { tool_name: toolName, tool_call_id: callId, state: 'loading', parameters, result: [] },
    },
    {
      type: 'mcp_tool_call',
      mcp_tool_call: {
        tool_name: toolName,
        tool_call_id: callId,
        state: 'success',
        parameters,
        result: [{ type: 'text', text: JSON.stringify(payload) }],
      },
    },
  ];
}

const routed = (userQuery: string): ServerMessage[] =>
  mcpCall(
    'routePromptWorkflow',
    { instructions: 'Call getNextInstructionsWorkflow now.', sessionId: 'session-1' },
    { userQuery },
  );

const polled = (affectedEntities: unknown): ServerMessage[] =>
  mcpCall('getNextInstructionsWorkflow', {
    instructions: 'Call markAffected with the entities in affectedEntities, then poll again.',
    taskIdsInProgress: ['lights'],
    affectedEntities,
  });

describe('readMarkAffectedCalls', () => {
  it('reads the entities of each call in the shape the headset parses', () => {
    const calls = readMarkAffectedCalls([marked({ entities: [KITCHEN, { id: INBOX.id }] })]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.entities).toEqual([KITCHEN, { id: INBOX.id }]);
    expect(calls[0]?.ignored).toEqual([]);
  });

  it('sets aside what the headset would ignore, and keeps it for the failure message', () => {
    const calls = readMarkAffectedCalls([
      marked({ entities: [KITCHEN, { name: 'No id' }, { id: '   ' }, 'light.bare'] }),
    ]);

    expect(calls[0]?.entities).toEqual([KITCHEN]);
    expect(calls[0]?.ignored).toEqual([{ name: 'No id' }, { id: '   ' }, 'light.bare']);
  });

  it('reads a call with no entity list as a call that lit up nothing', () => {
    const calls = readMarkAffectedCalls([marked({ entityIds: [KITCHEN.id] })]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.entities).toEqual([]);
  });

  it('ignores every other client tool', () => {
    const other: ServerMessage = {
      type: 'client_tool_call',
      client_tool_call: { tool_name: 'openCamera', tool_call_id: 'client-other', parameters: {} },
    };

    expect(readMarkAffectedCalls([other])).toEqual([]);
  });
});

describe('readRelayedAffectedEntities', () => {
  it('collects what the polls relayed, once per id, in the order each first arrived', () => {
    const relayed = readRelayedAffectedEntities([
      ...routed('Are the kitchen lights on?'),
      ...polled([KITCHEN]),
      ...polled([KITCHEN, INBOX]),
    ]);

    expect(relayed).toEqual([KITCHEN, INBOX]);
  });

  it('reads a malformed list as nothing relayed, without losing the rest of the report', () => {
    const messages = [...routed('Are the kitchen lights on?'), ...polled('light.kitchen_ceiling')];

    expect(readRelayedAffectedEntities(messages)).toEqual([]);
  });
});

describe('findUnrelayedMarks', () => {
  it('passes marks copied exactly from what was relayed', () => {
    const messages = [...polled([KITCHEN, INBOX]), marked({ entities: [KITCHEN, { id: INBOX.id }] })];

    expect(findUnrelayedMarks(messages)).toEqual([]);
  });

  it('names an id the agent changed on the way through', () => {
    const messages = [...polled([KITCHEN]), marked({ entities: [{ id: 'light.kitchen', name: KITCHEN.name }] })];

    expect(findUnrelayedMarks(messages)).toEqual(['light.kitchen']);
  });
});

describe('readRoutedQueries', () => {
  it('reads each routing call once, although ElevenLabs reports it twice', () => {
    const queries = readRoutedQueries([
      ...routed('Is that on? (pointing at "Kitchen ceiling light", id light.kitchen_ceiling)'),
      ...polled([]),
    ]);

    expect(queries).toEqual(['Is that on? (pointing at "Kitchen ceiling light", id light.kitchen_ceiling)']);
  });
});

describe('latestContextualUpdates', () => {
  it('keeps only the newest update of each context, and every update that has none', () => {
    const device: ServerMessage = { type: 'contextual_update', text: HEADSET_DEVICE_CONTEXT, context_id: 'device' };
    const first: ServerMessage = {
      type: 'contextual_update',
      text: pointingContext(INBOX),
      context_id: POINTING_CONTEXT_ID,
    };
    const second: ServerMessage = {
      type: 'contextual_update',
      text: pointingContext(KITCHEN),
      context_id: POINTING_CONTEXT_ID,
    };
    const loose: ServerMessage = { type: 'contextual_update', text: 'Something without a context.' };

    expect(latestContextualUpdates([device, first, loose, second]).map((update) => update.text)).toEqual([
      HEADSET_DEVICE_CONTEXT,
      'Something without a context.',
      pointingContext(KITCHEN),
    ]);
  });

  it('shows the evaluator which context an update replaces', () => {
    const transcript = transcriptOf([
      { type: 'contextual_update', text: pointingContext(KITCHEN), context_id: POINTING_CONTEXT_ID },
    ]);

    expect(transcript).toContain('replacing any earlier "pointing" update');
    expect(transcript).toContain(pointingContext(KITCHEN));
  });
});

describe('the prompt, against what the headset says', () => {
  const promptPath = path.join(import.meta.dir, '../../src/assets/agent-prompt.md');

  it('gates markAffected on the exact sentence the headset sends', async () => {
    // A paraphrase here would leave the model to decide whether the headset's words "count", and a
    // model at temperature zero decides that the same wrong way every time.
    const prompt = await readFile(promptPath, 'utf-8');

    expect(prompt).toContain(HEADSET_DEVICE_CONTEXT);
  });

  it('shows the pointing update in the form the headset sends it', async () => {
    const prompt = await readFile(promptPath, 'utf-8');

    expect(prompt).toContain(pointingContext(KITCHEN));
  });

  it('names the update that clears the pointing in words the headset uses', async () => {
    const prompt = await readFile(promptPath, 'utf-8');
    // The prompt folds it into its own sentence, so it is matched without the capital or the stop.
    const clearing = NOT_POINTING_CONTEXT.replace(/^Sir is/, 'he is').replace(/\.$/, '');

    expect(prompt).toContain(clearing);
  });
});
