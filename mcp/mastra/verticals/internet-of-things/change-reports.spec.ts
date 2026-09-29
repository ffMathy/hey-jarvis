import { describe, expect, it } from 'bun:test';
import type { EntityNoiseBaseline } from '../../storage/entity-noise-baseline';
import type { BulkedBusEvent, BulkedStateChange } from './change-bulker';
import { describeEntity, type HomeRegistry, planEventReports, planStateReports } from './change-reports';

const registry: HomeRegistry = {
  entities: new Map([
    ['binary_sensor.front_door', { deviceId: 'door', labels: [] }],
    ['sensor.power', { deviceId: 'meter', labels: [] }],
    ['lock.safe', { deviceId: 'safe', labels: [] }],
    ['camera.bedroom', { deviceId: null, labels: ['sensitive'] }],
  ]),
  devices: new Map([
    ['door', { name: 'Front Door', labels: [] }],
    ['meter', { name: 'Power Meter', labels: [] }],
    ['safe', { name: 'Safe', labels: ['sensitive'] }],
  ]),
};

function bulked(overrides: Partial<BulkedStateChange> & Pick<BulkedStateChange, 'entityId'>): BulkedStateChange {
  return {
    previousState: 'off',
    newState: 'on',
    observedStates: ['on'],
    changeCount: 1,
    firstChangedAt: 't1',
    lastChangedAt: 't1',
    spammy: false,
    ...overrides,
  };
}

const powerBaseline: EntityNoiseBaseline = {
  entityId: 'sensor.power',
  stateType: 'numeric',
  numericThreshold: 50,
  sampleCount: 10,
  lastCalculated: 't',
  historicalStates: [],
};

describe('describeEntity', () => {
  it('names the device and inherits its sensitive label', () => {
    expect(describeEntity(registry, 'binary_sensor.front_door')).toEqual({
      deviceId: 'door',
      deviceName: 'Front Door',
      sensitive: false,
    });
    expect(describeEntity(registry, 'lock.safe').sensitive).toBe(true);
    expect(describeEntity(registry, 'camera.bedroom').sensitive).toBe(true);
    expect(describeEntity(registry, 'light.unregistered')).toEqual({
      deviceId: 'unknown',
      deviceName: 'Unknown Device',
      sensitive: false,
    });
  });
});

describe('planStateReports', () => {
  it('reports a single change in the shape the reactor has always received', () => {
    const { reports } = planStateReports(
      [bulked({ entityId: 'binary_sensor.front_door' })],
      registry,
      new Map(),
      'now',
    );

    expect(reports).toEqual([
      {
        stateType: 'device_state_change',
        stateData: {
          deviceId: 'door',
          deviceName: 'Front Door',
          entityId: 'binary_sensor.front_door',
          previousState: 'off',
          newState: 'on',
          lastChanged: 't1',
          detectedAt: 'now',
        },
      },
    ]);
  });

  it('adds the bulk details when a bucket folded several changes', () => {
    const { reports } = planStateReports(
      [
        bulked({
          entityId: 'binary_sensor.front_door',
          newState: 'off',
          observedStates: ['on', 'off'],
          changeCount: 2,
          lastChangedAt: 't2',
        }),
      ],
      registry,
      new Map(),
      'now',
    );

    expect(reports[0].stateData).toMatchObject({
      previousState: 'off',
      newState: 'off',
      changeCount: 2,
      observedStates: ['on', 'off'],
      firstChanged: 't1',
    });
  });

  it('drops sensitive entities and changes within the noise baseline', () => {
    const result = planStateReports(
      [
        bulked({ entityId: 'lock.safe' }),
        bulked({ entityId: 'camera.bedroom' }),
        bulked({ entityId: 'sensor.power', previousState: '100', newState: '120', observedStates: ['110', '120'] }),
      ],
      registry,
      new Map([['sensor.power', powerBaseline]]),
      'now',
    );

    expect(result.reports).toEqual([]);
    expect(result.filteredAsSensitive).toBe(2);
    expect(result.filteredAsNoise).toBe(1);
  });

  it('keeps a noisy entity whose excursion was significant even though it ended near where it began', () => {
    const { reports } = planStateReports(
      [bulked({ entityId: 'sensor.power', previousState: '100', newState: '110', observedStates: ['400', '110'] })],
      registry,
      new Map([['sensor.power', powerBaseline]]),
      'now',
    );

    expect(reports).toHaveLength(1);
  });
});

describe('planEventReports', () => {
  function event(overrides: Partial<BulkedBusEvent>): BulkedBusEvent {
    return {
      eventType: 'zha_event',
      sourceId: undefined,
      lastData: {},
      occurrences: 1,
      firstFiredAt: 't1',
      lastFiredAt: 't1',
      spammy: false,
      ...overrides,
    };
  }

  it('reports an event with the device it came from', () => {
    const { reports } = planEventReports(
      [event({ lastData: { device_id: 'door', command: 'ring' }, occurrences: 3, lastFiredAt: 't3' })],
      registry,
      'now',
    );

    expect(reports).toEqual([
      {
        stateType: 'home_assistant_event',
        stateData: {
          eventType: 'zha_event',
          deviceId: 'door',
          deviceName: 'Front Door',
          data: { device_id: 'door', command: 'ring' },
          lastFired: 't3',
          detectedAt: 'now',
          occurrences: 3,
          firstFired: 't1',
        },
      },
    ]);
  });

  it('drops events from sensitive entities and devices', () => {
    const result = planEventReports(
      [event({ lastData: { device_id: 'safe' } }), event({ lastData: { entity_id: 'camera.bedroom' } })],
      registry,
      'now',
    );

    expect(result.reports).toEqual([]);
    expect(result.filteredAsSensitive).toBe(2);
  });

  it('summarises a payload too large to pass on', () => {
    const { reports } = planEventReports([event({ lastData: { blob: 'x'.repeat(5_000) } })], registry, 'now');

    expect(reports[0].stateData.data).toEqual({ truncated: true, keys: ['blob'] });
  });
});
