import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { getAllDevices } from '../internet-of-things/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 * They allow a vertical to leverage tools from other domains while maintaining
 * its own domain-specific interface.
 */

const CAR_DEVICE_KEYWORDS = [
  'car',
  'vehicle',
  'auto',
  'tesla',
  'bmw',
  'audi',
  'mercedes',
  'volvo',
  'ford',
  'toyota',
  'honda',
  'nissan',
  'hyundai',
  'kia',
  'chevrolet',
  'volkswagen',
  'porsche',
  'lexus',
  'mazda',
  'subaru',
  'jeep',
  'rivian',
  'lucid',
  'polestar',
];

function safeGetNumber(attributes: Record<string, unknown>, key: string): number | undefined {
  const value = attributes[key];
  return typeof value === 'number' ? value : undefined;
}

function safeGetString(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Get the current navigation destination from a car's infotainment system.
 * This shortcut uses the IoT vertical's getAllDevices tool to query
 * the car's navigation system state.
 */
export const getCarNavigationDestination = createTool({
  id: 'getCarNavigationDestination',
  description:
    "Get the current navigation destination from a connected car. Uses IoT device integration to query the car's navigation system for its current destination.",
  inputSchema: z.object({
    carDeviceName: z
      .string()
      .optional()
      .describe('Optional name of the car device to query. If not provided, searches for any car/vehicle device.'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    carName: z.string().optional(),
    destination: z
      .object({
        address: z.string().optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
      .optional(),
    navigationState: z.string().optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const devicesResult = await getAllDevices.execute({ domain: 'device_tracker' });

    const carDevices = devicesResult.devices.filter((device) => {
      const deviceNameLower = device.name.toLowerCase();

      if (inputData.carDeviceName) {
        return deviceNameLower.includes(inputData.carDeviceName.toLowerCase());
      }

      return CAR_DEVICE_KEYWORDS.some((keyword) => deviceNameLower.includes(keyword));
    });

    if (carDevices.length === 0) {
      return {
        found: false,
        message: inputData.carDeviceName
          ? `No car device found matching "${inputData.carDeviceName}"`
          : 'No car/vehicle devices found in IoT system',
      };
    }

    const carDevice = carDevices[0];
    const navigationEntity = carDevice.entities.find(
      (entity) =>
        entity.id.includes('destination') ||
        entity.id.includes('navigation') ||
        entity.id.includes('nav') ||
        entity.id.includes('route'),
    );

    if (!navigationEntity) {
      const locationEntity = carDevice.entities.find(
        (entity) => entity.domain === 'device_tracker' || entity.id.includes('location'),
      );

      return {
        found: true,
        carName: carDevice.name,
        navigationState: 'no_active_navigation',
        destination: locationEntity
          ? {
              latitude: safeGetNumber(locationEntity.attributes, 'latitude'),
              longitude: safeGetNumber(locationEntity.attributes, 'longitude'),
            }
          : undefined,
        message: `Found car "${carDevice.name}" but no active navigation destination is set. Current location may be available.`,
      };
    }

    return {
      found: true,
      carName: carDevice.name,
      destination: {
        address: navigationEntity.state !== 'unknown' ? navigationEntity.state : undefined,
        latitude: safeGetNumber(navigationEntity.attributes, 'destination_latitude'),
        longitude: safeGetNumber(navigationEntity.attributes, 'destination_longitude'),
      },
      navigationState: 'active',
      message: `Found navigation destination for "${carDevice.name}"`,
    };
  },
});

export const commuteShortcuts = {
  getCarNavigationDestination,
};
