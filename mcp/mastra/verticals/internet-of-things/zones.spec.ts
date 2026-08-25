/**
 * Zone conversion tests.
 *
 * Home Assistant's template renders zones in its own snake_case; everything downstream of it —
 * `inferUserLocation`'s zone comparison and its output schema — is written in camelCase. Getting
 * that boundary wrong reads `undefined` where a zone name should be, which throws for any house
 * that has zones at all, and it only shows up against a real instance. Hence a test.
 */

import { describe, expect, it } from 'bun:test';
import { toZoneData } from './tools.js';

const home = { entity_id: 'zone.home', friendly_name: 'Home', latitude: 56.1629, longitude: 10.2039, radius: 100 };

describe('toZoneData', () => {
  it('renames the fields Home Assistant spells differently', () => {
    expect(toZoneData([home])).toEqual([
      { entityId: 'zone.home', friendlyName: 'Home', latitude: 56.1629, longitude: 10.2039, radius: 100 },
    ]);
  });

  it('gives every zone a name to compare a person against', () => {
    // The comparison calls .toLowerCase() on this, so undefined here is a crash rather than a
    // wrong answer.
    const work = { ...home, entity_id: 'zone.work', friendly_name: 'Work' };

    for (const zone of toZoneData([home, work])) {
      expect(typeof zone.friendlyName).toBe('string');
      expect(typeof zone.entityId).toBe('string');
    }
  });

  it('handles a house with no zones', () => {
    expect(toZoneData([])).toEqual([]);
  });
});
