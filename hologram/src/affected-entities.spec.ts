import { describe, expect, it } from 'bun:test';
import {
  AFFECTED_ENTITIES_PER_MESSAGE,
  AFFECTED_ENTITY_ID_MAX_LENGTH,
  AFFECTED_ENTITY_NAME_MAX_LENGTH,
  affectedEntitiesOf,
} from './affected-entities';

/**
 * What an `affectedEntities` message from the Jarvis server is taken to name. It comes over the
 * network from outside the device, so both its shape and its values are read strictly — see
 * `affected-entities.ts` for why.
 */
describe('reading the entities an affectedEntities message names', () => {
  it('takes each entity as declared, with its name when it has one', () => {
    expect(
      affectedEntitiesOf({
        entities: [{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }, { id: 'inbox:work' }],
      }),
    ).toEqual([{ id: 'light.kitchen_ceiling', name: 'Kitchen ceiling' }, { id: 'inbox:work' }]);
  });

  it('treats an id as opaque, from whichever agent reported it', () => {
    const ids = [
      'light.kitchen_ceiling',
      'calendar/primary',
      'gmail:thread:18c2f0a9d3',
      'b7c1e2d4-0f9a-4c3e-9d2b-7a1f6e5c4b3a',
      'Shopping list',
      '42',
    ];

    expect(affectedEntitiesOf({ entities: ids.map((id) => ({ id })) }).map((entity) => entity.id)).toEqual(ids);
  });

  it('trims both halves, and leaves out an entity whose id is blank or missing', () => {
    expect(
      affectedEntitiesOf({
        entities: [{ id: '  light.hall  ', name: '  Hall  ' }, { id: '   ' }, { name: 'No id at all' }, { id: '' }],
      }),
    ).toEqual([{ id: 'light.hall', name: 'Hall' }]);
  });

  it('keeps an entity whose name is unusable, without the name', () => {
    expect(
      affectedEntitiesOf({
        entities: [
          { id: 'light.hall', name: '   ' },
          { id: 'light.porch', name: 7 },
          { id: 'light.attic', name: 'x'.repeat(AFFECTED_ENTITY_NAME_MAX_LENGTH + 1) },
          { id: 'light.cellar', name: 'y'.repeat(AFFECTED_ENTITY_NAME_MAX_LENGTH) },
        ],
      }),
    ).toEqual([
      { id: 'light.hall' },
      { id: 'light.porch' },
      { id: 'light.attic' },
      { id: 'light.cellar', name: 'y'.repeat(AFFECTED_ENTITY_NAME_MAX_LENGTH) },
    ]);
  });

  it('leaves out an id longer than any agent hands out, rather than cutting it into another one', () => {
    const longest = 'a'.repeat(AFFECTED_ENTITY_ID_MAX_LENGTH);

    expect(affectedEntitiesOf({ entities: [{ id: `${longest}b` }, { id: longest }] })).toEqual([{ id: longest }]);
  });

  it('names each id once, with the first name any mention of it gave', () => {
    expect(
      affectedEntitiesOf({
        entities: [
          { id: 'light.hall' },
          { id: 'light.porch', name: 'Porch' },
          { id: 'light.hall', name: 'Hall' },
          { id: 'light.porch', name: 'Front porch' },
        ],
      }),
    ).toEqual([
      { id: 'light.hall', name: 'Hall' },
      { id: 'light.porch', name: 'Porch' },
    ]);
  });

  it(`marks no more than ${AFFECTED_ENTITIES_PER_MESSAGE} at once`, () => {
    const many = Array.from({ length: AFFECTED_ENTITIES_PER_MESSAGE + 10 }, (_, index) => ({ id: `light.${index}` }));

    const marked = affectedEntitiesOf({ entities: many });

    expect(marked).toHaveLength(AFFECTED_ENTITIES_PER_MESSAGE);
    expect(marked.at(-1)?.id).toBe(`light.${AFFECTED_ENTITIES_PER_MESSAGE - 1}`);
  });

  it('takes only the declared shape, and guesses at nothing else', () => {
    expect(
      affectedEntitiesOf({
        entities: ['light.hall', { entityId: 'light.porch', name: 'Porch' }, { id: 'light.attic' }],
      }),
    ).toEqual([{ id: 'light.attic' }]);
    expect(affectedEntitiesOf({ entities: JSON.stringify([{ id: 'inbox:work' }]) })).toEqual([]);
    expect(affectedEntitiesOf({ entities: { id: 'calendar/primary' } })).toEqual([]);
  });

  it('ignores junk, and never throws over it', () => {
    const junk: unknown[] = [
      undefined,
      null,
      'light.hall',
      42,
      [],
      {},
      { entities: null },
      { entities: 42 },
      { entities: 'light.hall, light.porch' },
      { entities: '{"id":"light.hall"}' },
      { entities: '[not json' },
      { entities: [null, 42, true, [], ['light.hall'], { id: 42 }, { id: { nested: 'light.hall' } }] },
    ];

    for (const message of junk) {
      expect(affectedEntitiesOf(message)).toEqual([]);
    }
  });
});
