import { createShortcut } from '../../utils/shortcut-factory.js';
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
 * Get the current navigation destination from a connected Tesla via Tessie.
 * This shortcut uses the IoT vertical's getAllDevices tool to query
 * the car's navigation system state using Tessie-specific entity patterns.
 *
 * The shortcut searches all domains to find Tessie devices, then filters
 * to only return navigation-related entities.
 */
export const getCarNavigationDestination = createShortcut({
  id: 'getCarNavigationDestination',
  description:
    "Get the current navigation destination from a connected Tesla via Tessie integration. Uses IoT device integration to query the car's navigation system for destination, distance to arrival, time to arrival, and traffic delay.",
  tool: getAllDevices,
  execute: async (inputData): Promise<{ devices: DeviceState[] }> => {
    if (!getAllDevices.execute) {
      throw new Error('getAllDevices.execute is not defined');
    }
    const devicesResult = await getAllDevices.execute({}, {});

    // Handle ValidationError case - check for error property that ValidationError has
    if ('error' in devicesResult) {
      return {
        devices: [],
      };
    }

    // TypeScript now knows this is not a ValidationError
    const allDevices: Device[] = devicesResult.devices;
    const carDevices = allDevices.filter(isTessieCarDevice);

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
