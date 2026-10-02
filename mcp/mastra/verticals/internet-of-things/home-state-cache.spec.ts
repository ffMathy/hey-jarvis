/**
 * The copy of the house the IoT lookups answer from instead of rendering templates over REST.
 *
 * The readers are pinned against what the templates they replace render, so the agent cannot tell
 * which answered; the lookups are pinned to make no request at all while there is a copy; and the
 * cache itself is driven through a fake connection to pin when it may be trusted.
 */

import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { createConnection, createLongLivedTokenAuth, type HassEntity } from 'home-assistant-js-websocket';
import { executeTool } from '../../utils/tool-factory.js';
import {
  areasInSnapshot,
  changedSinceInSnapshot,
  describeDevicesInSnapshot,
  domainsInSnapshot,
  getHomeSnapshot,
  type HomeSnapshot,
  peopleAndZonesInSnapshot,
  serviceTargetsInSnapshot,
  setHomeSnapshotForTest,
  startHomeStateCache,
  summarizeEntitiesInSnapshot,
  trimAttributeValue,
} from './home-state-cache.js';
import { findEntities, getAllDevices, getHomeAreas, inferUserLocation } from './tools.js';

function state(
  entityId: string,
  value: string,
  attributes: Record<string, unknown> = {},
  lastChanged = '2026-09-30T10:00:00.000Z',
): HassEntity {
  return {
    entity_id: entityId,
    state: value,
    attributes,
    last_changed: lastChanged,
    last_updated: lastChanged,
    context: { id: 'context', parent_id: null, user_id: null },
  };
}

function snapshotOf(states: HassEntity[]): HomeSnapshot {
  return {
    states: Object.fromEntries(states.map((entity) => [entity.entity_id, entity])),
    entities: new Map([
      ['light.sofa_lamp', { deviceId: 'lamp', areaId: null, labels: ['cosy'] }],
      ['sensor.lamp_power', { deviceId: 'lamp', areaId: null, labels: [] }],
      ['light.ceiling', { deviceId: 'ceiling', areaId: 'kitchen', labels: [] }],
      ['switch.ceiling_child_lock', { deviceId: 'ceiling', areaId: null, labels: [] }],
      ['light.porch', { deviceId: null, areaId: null, labels: [] }],
      ['light.disabled', { deviceId: 'lamp', areaId: null, labels: [] }],
    ]),
    devices: new Map([
      ['lamp', { name: 'Sofa lamp', areaId: 'living_room', labels: ['furniture'] }],
      ['ceiling', { name: null, areaId: 'living_room', labels: [] }],
    ]),
    areas: new Map([
      ['living_room', 'Living Room'],
      ['kitchen', 'Kitchen'],
    ]),
  };
}

const house = snapshotOf([
  state('light.sofa_lamp', 'on', { friendly_name: 'Sofa lamp' }, '2026-09-30T09:00:00.000Z'),
  state(
    'sensor.lamp_power',
    '12',
    { friendly_name: 'Lamp power', unit_of_measurement: 'W' },
    '2026-09-30T11:00:00.000Z',
  ),
  state('light.ceiling', 'off', { friendly_name: 'Ceiling' }),
  state('switch.ceiling_child_lock', 'off'),
  state('light.porch', 'off', { friendly_name: 'Porch' }),
  state('person.sir', 'home', {
    friendly_name: 'Sir',
    latitude: 55.6,
    longitude: 12.5,
    gps_accuracy: 10,
    source: 'device_tracker.phone',
  }),
  state('zone.home', 'zoning', { friendly_name: 'Home', latitude: 55.6, longitude: 12.5, radius: 50 }),
]);

afterEach(() => {
  setHomeSnapshotForTest(undefined);
});

describe('reading the copy of the house', () => {
  it('summarises entities with the area they or their device are in, and their unit', () => {
    expect(summarizeEntitiesInSnapshot(house, 'light')).toEqual([
      { id: 'light.sofa_lamp', name: 'Sofa lamp', area: 'Living Room', state: 'on', unit: null },
      // Its own area wins over its device's.
      { id: 'light.ceiling', name: 'Ceiling', area: 'Kitchen', state: 'off', unit: null },
      { id: 'light.porch', name: 'Porch', area: null, state: 'off', unit: null },
    ]);
    expect(summarizeEntitiesInSnapshot(house, 'sensor')[0]?.unit).toBe('W');
  });

  it('names an entity without a friendly name the way Home Assistant does', () => {
    expect(summarizeEntitiesInSnapshot(house, 'switch')[0]?.name).toBe('ceiling child lock');
  });

  it('groups entities under their devices, narrowed to a domain', () => {
    const devices = describeDevicesInSnapshot(house, { domain: 'light' });

    expect(devices.map((device) => device.id)).toEqual(['lamp', 'ceiling']);
    expect(devices[0]).toMatchObject({
      name: 'Sofa lamp',
      area: 'Living Room',
      labels: ['furniture'],
      entities: [{ id: 'light.sofa_lamp', domain: 'light', area: 'Living Room', labels: ['cosy'], state: 'on' }],
    });
    // A device without a name in the registry is still named, by its id.
    expect(devices[1]?.name).toBe('ceiling');
  });

  it('dates a device by its most recently changed entity, and skips entities without a state', () => {
    const [lamp] = describeDevicesInSnapshot(house, { deviceIds: ['lamp'] });

    expect(lamp?.entities.map((entity) => entity.id)).toEqual(['light.sofa_lamp', 'sensor.lamp_power']);
    expect(lamp?.last_changed).toBe('2026-09-30T11:00:00.000Z');
  });

  it('leaves out devices that are unknown or have nothing in the domain', () => {
    expect(describeDevicesInSnapshot(house, { deviceIds: ['gone', 'lamp'], domain: 'switch' })).toEqual([]);
  });

  it('shortens long attributes as the device template does', () => {
    expect(trimAttributeValue('x'.repeat(200))).toBe(`${'x'.repeat(160)}…`);
    expect(trimAttributeValue(Array.from({ length: 30 }, (_, index) => index))).toHaveLength(20);
    expect(trimAttributeValue({ nested: true })).toBe('{"nested":true}');
    expect(trimAttributeValue([{ a: 1 }, 'b'])).toEqual(['{"a":1}', 'b']);
    expect(trimAttributeValue(42)).toBe(42);
    expect(trimAttributeValue(null)).toBeNull();
  });

  it('finds what a service call reaches through areas, devices and ids', () => {
    expect(
      serviceTargetsInSnapshot(house, 'light', { entityIds: [], areaIds: ['living_room'], deviceIds: [] }),
    ).toEqual([{ id: 'light.sofa_lamp', name: 'Sofa lamp' }]);
    expect(serviceTargetsInSnapshot(house, 'switch', { entityIds: [], areaIds: [], deviceIds: ['ceiling'] })).toEqual([
      { id: 'switch.ceiling_child_lock', name: 'ceiling child lock' },
    ]);
    expect(
      serviceTargetsInSnapshot(house, 'homeassistant', { entityIds: [], areaIds: [], deviceIds: ['lamp'] }).map(
        (target) => target.id,
      ),
    ).toEqual(['light.sofa_lamp', 'sensor.lamp_power']);
  });

  it('drops target ids Home Assistant does not know, and names each target once', () => {
    expect(
      serviceTargetsInSnapshot(house, 'light', {
        entityIds: ['light.porch', 'light.nowhere', 'light.ceiling'],
        areaIds: ['kitchen'],
        deviceIds: [],
      }),
    ).toEqual([
      { id: 'light.porch', name: 'Porch' },
      { id: 'light.ceiling', name: 'Ceiling' },
    ]);
  });

  it('lists what changed recently with its device', () => {
    const changed = changedSinceInSnapshot(house, 3600, undefined, Date.parse('2026-09-30T11:30:00.000Z'));

    expect(changed).toEqual([
      {
        device_id: 'lamp',
        device_name: 'Sofa lamp',
        device_label_ids: ['furniture'],
        entity_id: 'sensor.lamp_power',
        entity_label_ids: [],
        state: '12',
        last_changed: Date.parse('2026-09-30T11:00:00.000Z') / 1000,
      },
    ]);
  });

  it('lists people and zones, domains and areas', () => {
    const { persons, zones } = peopleAndZonesInSnapshot(house);

    expect(persons).toEqual([
      {
        entity_id: 'person.sir',
        state: 'home',
        friendly_name: 'Sir',
        latitude: 55.6,
        longitude: 12.5,
        gps_accuracy: 10,
        source: 'device_tracker.phone',
        last_changed: '2026-09-30T10:00:00.000Z',
      },
    ]);
    expect(zones).toEqual([
      { entity_id: 'zone.home', friendly_name: 'Home', latitude: 55.6, longitude: 12.5, radius: 50 },
    ]);
    expect(domainsInSnapshot(house)).toEqual(['light', 'sensor', 'switch', 'person', 'zone']);
    expect(areasInSnapshot(house)).toEqual([
      { id: 'living_room', name: 'Living Room' },
      { id: 'kitchen', name: 'Kitchen' },
    ]);
  });
});

describe('the lookups, while there is a copy of the house', () => {
  it('answer without asking Home Assistant', async () => {
    setHomeSnapshotForTest(house);
    const fetchSpy = spyOn(globalThis, 'fetch');

    expect(await executeTool(findEntities, { domain: 'light', area: 'kitchen' })).toEqual({
      entities: [{ id: 'light.ceiling', name: 'Ceiling', area: 'Kitchen', state: 'off' }],
      totalMatches: 1,
    });
    expect((await executeTool(getAllDevices, { domain: 'Light' })).devices).toHaveLength(2);
    expect(await getHomeAreas()).toHaveLength(2);
    expect((await executeTool(inferUserLocation, {})).users[0]?.distancesFromZones[0]?.isInZone).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

interface CompressedState {
  s: string;
  a: Record<string, unknown>;
  lc: number;
}

/**
 * A Home Assistant on a local port that speaks just enough of the websocket API for the cache:
 * the auth handshake, `subscribe_entities`, event subscriptions and the three registry lists.
 * The real client library connects to it, so reconnects behave as they do against the real thing.
 */
function serveFakeHomeAssistant(states: Record<string, CompressedState>) {
  const requested: string[] = [];
  let accepting = true;
  const entitySubscriptions = new Map<ServerWebSocket<unknown>, number>();
  const registries: Record<string, unknown[]> = {
    'config/entity_registry/list': [{ entity_id: 'light.porch', device_id: null, area_id: 'garden', labels: [] }],
    'config/device_registry/list': [],
    'config/area_registry/list': [{ area_id: 'garden', name: 'Garden' }],
  };

  const server = Bun.serve({
    port: 0,
    fetch: (request, httpServer) =>
      accepting && httpServer.upgrade(request) ? undefined : new Response('Unavailable', { status: 503 }),
    websocket: {
      open: (socket) => {
        socket.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.9.0' }));
      },
      close: (socket) => {
        entitySubscriptions.delete(socket);
      },
      message: (socket, raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === 'auth') {
          socket.send(JSON.stringify({ type: 'auth_ok', ha_version: '2026.9.0' }));
          return;
        }
        requested.push(message.type);
        const result = message.type in registries ? registries[message.type] : null;
        socket.send(JSON.stringify({ id: message.id, type: 'result', success: true, result }));
        if (message.type === 'subscribe_entities') {
          entitySubscriptions.set(socket, message.id);
          socket.send(JSON.stringify({ id: message.id, type: 'event', event: { a: states } }));
        }
      },
    },
  });

  return {
    url: `http://localhost:${server.port}`,
    requested,
    pushChanges: (changes: Record<string, { '+': Partial<CompressedState> }>) => {
      for (const [socket, id] of entitySubscriptions) {
        socket.send(JSON.stringify({ id, type: 'event', event: { c: changes } }));
      }
    },
    /** Closes every socket and refuses new ones until {@link comeBack}, like a restart. */
    goDown: () => {
      accepting = false;
      for (const socket of entitySubscriptions.keys()) {
        socket.close();
      }
    },
    comeBack: () => {
      accepting = true;
    },
    stop: () => server.stop(true),
  };
}

/** Waits for `condition` to hold, since the cache fills from messages that arrive in their own time. */
async function eventually(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  for (let attempt = 0; attempt < timeoutMs / 10 && !condition(); attempt++) {
    await Bun.sleep(10);
  }
  expect(condition()).toBe(true);
}

describe('the cache', () => {
  it('is trusted only while it has the states and the registries, and not across a drop', async () => {
    const homeAssistant = serveFakeHomeAssistant({
      'light.porch': { s: 'on', a: { friendly_name: 'Porch' }, lc: 1_790_000_000 },
    });
    const connection = await createConnection({ auth: createLongLivedTokenAuth(homeAssistant.url, 'token') });
    const stop = startHomeStateCache(connection);

    try {
      expect(getHomeSnapshot()).toBeUndefined();
      await eventually(() => getHomeSnapshot() !== undefined);
      expect(await executeTool(findEntities, { domain: 'light' })).toEqual({
        entities: [{ id: 'light.porch', name: 'Porch', area: 'Garden', state: 'on' }],
        totalMatches: 1,
      });

      homeAssistant.pushChanges({ 'light.porch': { '+': { s: 'off', lc: 1_790_000_100 } } });
      await eventually(() => getHomeSnapshot()?.states['light.porch']?.state === 'off');

      homeAssistant.goDown();
      await eventually(() => getHomeSnapshot() === undefined);
      homeAssistant.comeBack();

      // Back once the client has reconnected and resubscribed -- with the registries fetched
      // again, since their events may have been missed while the socket was down.
      await eventually(() => getHomeSnapshot() !== undefined);
      expect(homeAssistant.requested.filter((type) => type === 'config/area_registry/list')).toHaveLength(2);
    } finally {
      stop();
      connection.close();
      homeAssistant.stop();
    }

    expect(getHomeSnapshot()).toBeUndefined();
  });

  it('fetches everything again on its resync, mending a change it never heard of', async () => {
    const states = { 'light.porch': { s: 'on', a: { friendly_name: 'Porch' }, lc: 1_790_000_000 } };
    const homeAssistant = serveFakeHomeAssistant(states);
    const connection = await createConnection({ auth: createLongLivedTokenAuth(homeAssistant.url, 'token') });
    const stop = startHomeStateCache(connection, { resyncEveryMs: 50 });

    try {
      await eventually(() => getHomeSnapshot() !== undefined);

      // Home Assistant's state moves on without a delta reaching the cache.
      states['light.porch'].s = 'off';

      // The old copy keeps answering while the subscription is reopened...
      await eventually(() => homeAssistant.requested.filter((type) => type === 'config/area_registry/list').length > 1);
      expect(getHomeSnapshot()?.states['light.porch']?.state).toBe('on');

      // ...until Home Assistant has sent every state afresh.
      await eventually(() => getHomeSnapshot()?.states['light.porch']?.state === 'off', 10_000);
      expect(homeAssistant.requested.filter((type) => type === 'subscribe_entities')).toHaveLength(2);
    } finally {
      stop();
      connection.close();
      homeAssistant.stop();
    }
  }, 15_000);
});
