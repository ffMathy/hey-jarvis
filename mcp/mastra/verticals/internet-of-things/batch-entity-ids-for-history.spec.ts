import { describe, expect, it } from 'bun:test';
import { batchEntityIdsForHistory } from './tools';

describe('batchEntityIdsForHistory', () => {
  it('returns no batches for no entities', () => {
    expect(batchEntityIdsForHistory([])).toEqual([]);
  });

  it('keeps everything in one batch when the filter fits', () => {
    const entityIds = ['sensor.a', 'sensor.b', 'light.kitchen'];

    expect(batchEntityIdsForHistory(entityIds)).toEqual([entityIds]);
  });

  it('splits on the encoded filter length and preserves order', () => {
    // Each ID encodes to 8 characters, so with the separating "%2C" a batch of
    // two costs 19 and a batch of three costs 30.
    const entityIds = ['sensor.a', 'sensor.b', 'sensor.c', 'sensor.d', 'sensor.e'];

    expect(batchEntityIdsForHistory(entityIds, 20)).toEqual([
      ['sensor.a', 'sensor.b'],
      ['sensor.c', 'sensor.d'],
      ['sensor.e'],
    ]);
  });

  it('accounts for the encoded separator rather than the raw comma', () => {
    // Two 8-character IDs joined by a raw comma measure 17, but 19 once the
    // comma is percent-encoded — so a limit of 18 has to split them.
    expect(batchEntityIdsForHistory(['sensor.a', 'sensor.b'], 18)).toEqual([['sensor.a'], ['sensor.b']]);
    expect(batchEntityIdsForHistory(['sensor.a', 'sensor.b'], 19)).toEqual([['sensor.a', 'sensor.b']]);
  });

  it('gives an oversized entity a batch of its own instead of dropping it', () => {
    const long = `sensor.${'x'.repeat(50)}`;
    const entityIds = ['sensor.a', long, 'sensor.b'];

    expect(batchEntityIdsForHistory(entityIds, 20)).toEqual([['sensor.a'], [long], ['sensor.b']]);
  });

  it('never emits an empty batch', () => {
    const entityIds = Array.from({ length: 500 }, (_, i) => `sensor.entity_number_${i}`);

    for (const batch of batchEntityIdsForHistory(entityIds)) {
      expect(batch.length).toBeGreaterThan(0);
    }
  });

  it('covers every entity exactly once across batches', () => {
    const entityIds = Array.from({ length: 500 }, (_, i) => `sensor.entity_number_${i}`);

    expect(batchEntityIdsForHistory(entityIds).flat()).toEqual(entityIds);
  });

  it('keeps each batch within the request line Home Assistant accepts', () => {
    const entityIds = Array.from({ length: 500 }, (_, i) => `sensor.a_rather_long_entity_name_number_${i}`);

    for (const batch of batchEntityIdsForHistory(entityIds)) {
      const encoded = new URLSearchParams({ filter_entity_id: batch.join(',') }).toString();

      expect(encoded.length).toBeLessThan(8000);
    }
  });
});
