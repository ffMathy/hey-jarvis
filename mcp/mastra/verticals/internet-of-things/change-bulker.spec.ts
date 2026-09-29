import { describe, expect, it } from 'bun:test';
import { type BulkingPolicy, ChangeBulker, eventSourceId } from './change-bulker';

const POLICY: BulkingPolicy = {
  quietWindowMs: 1_000,
  spammyWindowMs: 10_000,
  spammyThreshold: 3,
  maxObservedValues: 4,
};

function change(entityId: string, oldState: string, newState: string, changedAt = '2026-01-01T00:00:00Z') {
  return { entityId, oldState, newState, changedAt };
}

describe('ChangeBulker', () => {
  it('holds a single change until the quiet window has elapsed, then releases it once', () => {
    const bulker = new ChangeBulker(POLICY);
    bulker.addStateChange(change('binary_sensor.door', 'off', 'on'), 0);

    expect(bulker.drain(999).states).toEqual([]);

    const { states } = bulker.drain(1_000);
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      entityId: 'binary_sensor.door',
      previousState: 'off',
      newState: 'on',
      changeCount: 1,
      spammy: false,
    });
    expect(bulker.drain(5_000).states).toEqual([]);
  });

  it('folds changes inside one window into a report that starts where the first one did', () => {
    const bulker = new ChangeBulker(POLICY);
    bulker.addStateChange(change('binary_sensor.door', 'off', 'on', 't1'), 0);
    bulker.addStateChange(change('binary_sensor.door', 'on', 'off', 't2'), 500);

    const [door] = bulker.drain(1_000).states;
    expect(door).toMatchObject({
      previousState: 'off',
      newState: 'off',
      observedStates: ['on', 'off'],
      changeCount: 2,
      firstChangedAt: 't1',
      lastChangedAt: 't2',
    });
  });

  it('holds a spammy entity for the long window and reports it as one bulk', () => {
    const bulker = new ChangeBulker(POLICY);
    for (let reading = 1; reading <= 6; reading++) {
      bulker.addStateChange(change('sensor.power', String(reading - 1), String(reading)), reading * 100);
    }

    // Past the quiet window, but the entity crossed the threshold, so it is still collecting.
    expect(bulker.drain(1_000).states).toEqual([]);

    const [power] = bulker.drain(10_100).states;
    expect(power).toMatchObject({
      previousState: '0',
      newState: '6',
      changeCount: 6,
      spammy: true,
    });
    expect(power.observedStates).toEqual(['1', '2', '3', '4']);
  });

  it('keeps entities in separate buckets with their own windows', () => {
    const bulker = new ChangeBulker(POLICY);
    bulker.addStateChange(change('light.kitchen', 'off', 'on'), 0);
    bulker.addStateChange(change('light.hall', 'off', 'on'), 800);

    expect(bulker.drain(1_000).states.map((state) => state.entityId)).toEqual(['light.kitchen']);
    expect(bulker.drain(1_800).states.map((state) => state.entityId)).toEqual(['light.hall']);
  });

  it('bulks bursts of the same event from the same source, but not from different sources', () => {
    const bulker = new ChangeBulker(POLICY);
    bulker.addEvent({ eventType: 'zha_event', data: { device_id: 'a', command: 'on' }, firedAt: 't1' }, 0);
    bulker.addEvent({ eventType: 'zha_event', data: { device_id: 'a', command: 'off' }, firedAt: 't2' }, 10);
    bulker.addEvent({ eventType: 'zha_event', data: { device_id: 'b', command: 'on' }, firedAt: 't3' }, 20);

    const { events } = bulker.drain(1_020);
    expect(events).toHaveLength(2);
    expect(events.find((event) => event.sourceId === 'a')).toMatchObject({
      occurrences: 2,
      firstFiredAt: 't1',
      lastFiredAt: 't2',
      lastData: { device_id: 'a', command: 'off' },
    });
    expect(events.find((event) => event.sourceId === 'b')).toMatchObject({ occurrences: 1 });
  });

  it('releases everything when forced, whatever its age', () => {
    const bulker = new ChangeBulker(POLICY);
    bulker.addStateChange(change('light.kitchen', 'off', 'on'), 0);
    bulker.addEvent({ eventType: 'tag_scanned', data: { tag_id: 'x' }, firedAt: 't' }, 0);

    const drained = bulker.drain(1, true);
    expect(drained.states).toHaveLength(1);
    expect(drained.events).toHaveLength(1);
    expect(bulker.pendingCount).toBe(0);
  });
});

describe('eventSourceId', () => {
  it('prefers the entity, then the device', () => {
    expect(eventSourceId({ entity_id: 'event.doorbell', device_id: 'd' })).toBe('event.doorbell');
    expect(eventSourceId({ device_id: 'd' })).toBe('d');
    expect(eventSourceId({ command: 'on' })).toBeUndefined();
  });
});
