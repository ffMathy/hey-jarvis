import { describe, expect, it } from 'bun:test';
import { describeStateChange } from './state-change.js';

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
