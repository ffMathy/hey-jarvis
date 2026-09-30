/**
 * The mark routing reads to know what a tool call touched, so sir's headset can light it up.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  affectedEntityReaderOf,
  cleanAffectedEntities,
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

    expect(readAffectedEntities('affectedSpecMalformed', {}, { error: true, message: 'validation failed' })).toEqual(
      [],
    );
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
