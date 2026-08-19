import { describe, expect, it } from 'bun:test';
import { describeStateChange, describeStateChangeFacets } from './state-change.js';

describe('describeStateChange', () => {
  it('renders source, type and data as a readable sentence', () => {
    const description = describeStateChange({
      source: 'weather',
      stateType: 'sun_position_changed',
      stateData: { event: 'sunset', temperature: 12 },
    });

    expect(description).toBe('weather sun position changed: event is sunset, temperature is 12');
  });

  it('omits the detail section when there is no data', () => {
    const description = describeStateChange({
      source: 'commute',
      stateType: 'arrived_home',
      stateData: {},
    });

    expect(description).toBe('commute arrived home');
  });

  it('flattens nested payloads into dotted-free readable paths', () => {
    const description = describeStateChange({
      source: 'internet-of-things',
      stateType: 'device_state_changed',
      stateData: {
        entity_id: 'light.living_room',
        attributes: { brightness: 200, friendly_name: 'Living room' },
      },
    });

    expect(description).toContain('entity id is light.living_room');
    expect(description).toContain('attributes brightness is 200');
    expect(description).toContain('attributes friendly name is Living room');
  });

  it('truncates very long values so one field cannot swamp the embedding', () => {
    const description = describeStateChange({
      source: 'email',
      stateType: 'email_received',
      stateData: { body: 'x'.repeat(500) },
    });

    expect(description.length).toBeLessThan(200);
    expect(description).toContain('…');
  });

  it('stops flattening at a bounded depth', () => {
    const description = describeStateChange({
      source: 'test',
      stateType: 'deep',
      stateData: { a: { b: { c: { d: 'value' } } } },
    });

    expect(description).toContain('a b c is {"d":"value"}');
  });
});

describe('describeStateChangeFacets', () => {
  it('always includes the whole description', () => {
    const change = {
      source: 'weather',
      stateType: 'sun_position_changed',
      stateData: { event: 'sunset', elevation: -0.5 },
    };

    expect(describeStateChangeFacets(change)).toContain(describeStateChange(change));
  });

  it('offers the heading, each detail, and each detail under its heading', () => {
    const facets = describeStateChangeFacets({
      source: 'internet-of-things',
      stateType: 'presence_changed',
      stateData: { person: 'Mathias', state: 'arrived home' },
    });

    expect(facets).toContain('internet-of-things presence changed');
    // The detail on its own is the fragment that rescues a match the full description
    // would have diluted past the score floor.
    expect(facets).toContain('state is arrived home');
    expect(facets).toContain('internet-of-things presence changed state is arrived home');
  });

  it('returns just the heading when there is no payload', () => {
    expect(describeStateChangeFacets({ source: 'weather', stateType: 'sun_position_changed', stateData: {} })).toEqual([
      'weather sun position changed',
    ]);
  });

  it('does not repeat a facet that renders identically to another', () => {
    const facets = describeStateChangeFacets({
      source: 'shopping',
      stateType: 'item_expiring',
      stateData: { item: 'milk' },
    });

    // With a single detail the "heading + detail" facet is the full description.
    expect(new Set(facets).size).toBe(facets.length);
  });

  it('stays small enough that embedding them together is cheap', () => {
    const facets = describeStateChangeFacets({
      source: 'internet-of-things',
      stateType: 'climate_changed',
      stateData: { device: 'thermostat', temperature: 21, humidity: 40, mode: 'heat' },
    });

    // Two per detail plus the heading and the whole thing: linear, not combinatorial.
    expect(facets.length).toBe(2 + 4 * 2);
  });
});
