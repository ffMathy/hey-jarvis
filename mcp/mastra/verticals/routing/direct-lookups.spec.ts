import { describe, expect, it } from 'bun:test';
import { getPublicAgents } from '..';
import { DIRECT_LOOKUPS, findDirectLookup } from './direct-lookups.js';

describe('DIRECT_LOOKUPS', () => {
  it('names every lookup once', () => {
    const ids = DIRECT_LOOKUPS.map((lookup) => lookup.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only answers for agents routing can send a request to', async () => {
    const routable = new Set((await getPublicAgents()).map((agent) => agent.id));

    for (const lookup of DIRECT_LOOKUPS) {
      expect(routable.has(lookup.agentId)).toBe(true);
    }
  });

  it('finds a lookup by its id', () => {
    expect(findDirectLookup('calendar.today')?.agentId).toBe('calendar');
    expect(findDirectLookup('calendar.yesterday')).toBeUndefined();
  });
});
