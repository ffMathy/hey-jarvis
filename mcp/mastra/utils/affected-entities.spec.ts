/**
 * The mark routing reads to know what a tool call touched, so sir's headset can light it up.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS,
  affectedEntityReaderOf,
  cleanAffectedEntities,
  lookUpWithinTimeLimit,
  markAsAffectingEntities,
  readAffectedEntities,
} from './affected-entities.js';
import { createShortcut } from './shortcut-factory.js';
import { createTool } from './tool-factory.js';

const lampResultSchema = z.object({ lamp: z.object({ id: z.string(), name: z.string() }) });

function lampTool(id: string) {
  return createTool({
    id,
    description: 'Switches a lamp',
    inputSchema: z.object({}),
    outputSchema: lampResultSchema,
    execute: async () => ({ lamp: { id: 'light.sofa_lamp', name: 'Sofa lamp' } }),
  });
}

/** Reads the lamp a {@link lampTool} call switched, the way a vertical's reader would. */
function readLamp(_toolArguments: unknown, toolResult: unknown) {
  return [lampResultSchema.parse(toolResult).lamp];
}

describe('affected entities', () => {
  it('reads what a marked tool touched out of its result', () => {
    markAsAffectingEntities(lampTool('affectedSpecLamp'), readLamp);

    expect(
      readAffectedEntities('affectedSpecLamp', {}, { lamp: { id: 'light.sofa_lamp', name: 'Sofa lamp' } }),
    ).toEqual([{ id: 'light.sofa_lamp', name: 'Sofa lamp' }]);
  });

  it('reads nothing for a tool that was not marked', () => {
    expect(readAffectedEntities('affectedSpecUnmarked', {}, { lamp: { id: 'light.porch', name: 'Porch' } })).toEqual(
      [],
    );
  });

  it('reads a result it does not recognise as touching nothing, rather than throwing', () => {
    markAsAffectingEntities(lampTool('affectedSpecMalformed'), readLamp);

    expect(readAffectedEntities('affectedSpecMalformed', {}, { lamp: 'the sofa one' })).toEqual([]);
  });

  /**
   * Mastra hands a call that never ran back as the tool's result rather than as an error: input
   * that failed validation, and a workflow called as a tool that failed. A reader that looks only at
   * the arguments, or reports a fixed thing, would otherwise light up what the call never reached.
   */
  describe('a call that never ran', () => {
    markAsAffectingEntities({ id: 'affectedSpecArgumentsOnly' }, () => [{ id: 'sent-items', name: 'Sent Items' }]);
    markAsAffectingEntities({ id: 'affectedSpecFailingWorkflow' }, () => [{ id: 'ffmathy/hey-jarvis' }]);

    it('touches nothing when its input failed validation', () => {
      const validationFailure = {
        error: true,
        message: 'Tool input validation failed for affectedSpecArgumentsOnly.',
        validationErrors: { errors: [], fields: {} },
      };

      expect(readAffectedEntities('affectedSpecArgumentsOnly', { to: 'nobody' }, validationFailure)).toEqual([]);
    });

    it('touches nothing when it was a workflow that failed', () => {
      expect(
        readAffectedEntities('workflow-affectedSpecFailingWorkflow', {}, { error: 'the step threw', runId: 'run-1' }),
      ).toEqual([]);
    });

    it('still touches what it names when it ran, whatever else its result says', () => {
      expect(readAffectedEntities('affectedSpecArgumentsOnly', {}, { success: true, message: 'Sent.' })).toEqual([
        { id: 'sent-items', name: 'Sent Items' },
      ]);
      expect(readAffectedEntities('workflow-affectedSpecFailingWorkflow', {}, { result: {}, runId: 'run-1' })).toEqual([
        { id: 'ffmathy/hey-jarvis' },
      ]);
    });
  });

  it('reads a marked workflow by the name an agent calls it', () => {
    markAsAffectingEntities({ id: 'affectedSpecWorkflow' }, () => [{ id: 'calendar.family' }]);

    expect(readAffectedEntities('workflow-affectedSpecWorkflow', {}, {})).toEqual([{ id: 'calendar.family' }]);
  });

  it('marks a shortcut onto a marked tool with the same reader', () => {
    const lamp = markAsAffectingEntities(lampTool('affectedSpecUnderlying'), readLamp);
    const shortcut = createShortcut({
      id: 'affectedSpecShortcut',
      description: 'A shortcut',
      tool: lamp,
      execute: async () => ({ lamp: { id: 'light.hall', name: 'Hall' } }),
    });

    expect(affectedEntityReaderOf(shortcut.id)).toBe(readLamp);
    expect(readAffectedEntities(shortcut.id, {}, { lamp: { id: 'light.hall', name: 'Hall' } })).toEqual([
      { id: 'light.hall', name: 'Hall' },
    ]);
  });

  it('leaves a shortcut onto an unmarked tool unmarked', () => {
    const shortcut = createShortcut({
      id: 'affectedSpecPlainShortcut',
      description: 'A shortcut',
      tool: lampTool('affectedSpecPlainUnderlying'),
      execute: async () => ({ lamp: { id: 'light.hall', name: 'Hall' } }),
    });

    expect(affectedEntityReaderOf(shortcut.id)).toBeUndefined();
  });
});

/**
 * A lookup a tool makes only to name what it touched runs alongside the call sir is waiting on, so it
 * must never hold that call up for long, nor fail it.
 */
describe('a lookup made only to name what a tool touched', () => {
  it('answers with what it found when it is quick', async () => {
    expect(await lookUpWithinTimeLimit('the sofa lamp', async () => ({ id: 'light.sofa_lamp' }), undefined)).toEqual({
      id: 'light.sofa_lamp',
    });
  });

  it('answers with the fallback when it fails, even before it has returned a promise', async () => {
    const failing = async (): Promise<string> => {
      throw new Error('Service Unavailable');
    };
    const throwing = (): Promise<string> => {
      throw new Error('no client');
    };

    expect(await lookUpWithinTimeLimit('a calendar', failing, 'as asked')).toBe('as asked');
    expect(await lookUpWithinTimeLimit('a calendar', throwing, 'as asked')).toBe('as asked');
  });

  it(`gives up after ${AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS} ms, answering with the fallback`, async () => {
    const startedAt = Date.now();

    expect(await lookUpWithinTimeLimit('a calendar', () => new Promise<string>(() => {}), 'as asked')).toBe('as asked');

    const elapsedMs = Date.now() - startedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS - 50);
    expect(elapsedMs).toBeLessThan(AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS + 1_000);
  });
});

describe('cleaning entities before they are handed on', () => {
  it('trims them, and reports each id once with the first name given for it', () => {
    expect(
      cleanAffectedEntities([
        { id: ' light.sofa_lamp ', name: ' Sofa lamp ' },
        { id: 'light.sofa_lamp', name: 'Another name' },
        { id: 'light.porch' },
        { id: 'light.porch', name: 'Porch' },
      ]),
    ).toEqual([
      { id: 'light.sofa_lamp', name: 'Sofa lamp' },
      { id: 'light.porch', name: 'Porch' },
    ]);
  });

  it('drops an empty id or one too long to be an id, and leaves out an empty name', () => {
    expect(cleanAffectedEntities([{ id: '   ' }, { id: 'x'.repeat(201) }, { id: 'light.porch', name: '  ' }])).toEqual([
      { id: 'light.porch' },
    ]);
  });

  it('cuts a name too long to label anything', () => {
    const [entity] = cleanAffectedEntities([{ id: 'light.porch', name: 'n'.repeat(500) }]);

    expect(entity.name).toHaveLength(120);
  });
});
