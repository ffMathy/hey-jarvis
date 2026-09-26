import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { type DeviceState, getAllDevices } from '../internet-of-things/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 * They allow a vertical to leverage tools from other domains while maintaining
 * its own domain-specific interface.
 *
 * Shortcuts use createShortcut which automatically reuses the input and output
 * schemas from the underlying tool they wrap.
 */

// Reuse the exported DeviceState interface from IoT tools
type Device = DeviceState;
type Entity = Device['entities'][number];

/**
 * Tessie integration entity patterns for Tesla vehicles in Home Assistant.
 * These are the specific entity suffixes used by the Tessie addon.
 */
const TESSIE_NAVIGATION_ENTITIES = {
  destination: '_destination',
  distanceToArrival: '_distance_to_arrival',
  timeToArrival: '_time_to_arrival',
  stateOfChargeAtArrival: '_state_of_charge_at_arrival',
  trafficDelay: '_traffic_delay',
};

const TESSIE_LOCATION_ENTITIES = {
  location: '_location',
  destinationLocation: '_destination_location',
};

/**
 * Detects if a device is a car by checking for Tessie integration patterns.
 * Tessie devices have specific entity naming patterns for Tesla vehicles.
 */
function isTessieCarDevice(device: Device): boolean {
  return device.entities.some((entity: Entity) => {
    const entityId = entity.id.toLowerCase();
    return (
      entityId.includes('tessie') ||
      Object.values(TESSIE_NAVIGATION_ENTITIES).some((suffix) => entityId.endsWith(suffix)) ||
      Object.values(TESSIE_LOCATION_ENTITIES).some((suffix) => entityId.endsWith(suffix))
    );
  });
}

/**
 * Checks if an entity is navigation-related for Tessie vehicles.
 */
function isNavigationEntity(entity: Entity): boolean {
  const entityId = entity.id.toLowerCase();
  return (
    Object.values(TESSIE_NAVIGATION_ENTITIES).some((suffix) => entityId.endsWith(suffix)) ||
    Object.values(TESSIE_LOCATION_ENTITIES).some((suffix) => entityId.endsWith(suffix)) ||
    entity.domain === 'device_tracker'
  );
}

/**
 * The domains a Tessie car's navigation lives in: the arrival sensors, and the trackers for
 * where the car is and where it is heading.
 */
const NAVIGATION_DOMAINS = ['sensor', 'device_tracker'];

/**
 * Joins the per-domain views of the same devices back into one device each.
 *
 * A device's `last_changed` is its latest entity's, so the joined device takes the later one.
 * Exported for testing.
 */
export function mergeDevicesAcrossDomains(devicesPerDomain: Device[][]): Device[] {
  const devicesById = new Map<string, Device>();

  for (const device of devicesPerDomain.flat()) {
    const seen = devicesById.get(device.id);
    if (!seen) {
      devicesById.set(device.id, device);
      continue;
    }

    devicesById.set(device.id, {
      ...seen,
      entities: [...seen.entities, ...device.entities],
      last_changed:
        Date.parse(device.last_changed) > Date.parse(seen.last_changed) ? device.last_changed : seen.last_changed,
    });
  }

  return Array.from(devicesById.values());
}

/**
 * Get the current navigation destination from a connected Tesla via Tessie.
 * This shortcut uses the IoT vertical's getAllDevices tool to query
 * the car's navigation system state using Tessie-specific entity patterns.
 *
 * Every entity it returns is a sensor or a device tracker, so it asks for those two domains --
 * at the same time -- rather than rendering every light, switch and media player in the house
 * with all their attributes only to throw them away.
 */
export const getCarNavigationDestination = createShortcut({
  id: 'getCarNavigationDestination',
  description:
    "Get the current navigation destination from a connected Tesla via Tessie integration. Uses IoT device integration to query the car's navigation system for destination, distance to arrival, time to arrival, and traffic delay.",
  tool: getAllDevices,
  execute: async (_inputData, context): Promise<{ devices: DeviceState[] }> => {
    const devicesPerDomain = await Promise.all(
      NAVIGATION_DOMAINS.map(async (domain) => (await executeTool(getAllDevices, { domain }, context)).devices),
    );
    const carDevices = mergeDevicesAcrossDomains(devicesPerDomain).filter(isTessieCarDevice);

    if (carDevices.length === 0) {
      return {
        devices: [],
      };
    }

    return {
      devices: carDevices.map((device) => ({
        ...device,
        entities: device.entities.filter(isNavigationEntity),
      })),
    };
  },
});

export const commuteShortcuts = {
  getCarNavigationDestination,
};
