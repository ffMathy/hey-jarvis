import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { inferUserLocation } from '../internet-of-things/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 * They allow a vertical to leverage tools from other domains while maintaining
 * its own domain-specific interface.
 */

interface UserLocationInfo {
  userId: string;
  userName: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracy: number | null;
  lastChanged: string;
  source: string;
  distancesFromZones: Array<{
    zoneName: string;
    zoneId: string;
    distanceMeters: number | null;
    isInZone: boolean;
  }>;
}

/**
 * Get the user's current location for weather-related queries.
 * This shortcut uses the IoT vertical's inferUserLocation tool to determine
 * where the user is located, enabling location-aware weather features.
 */
export const getUserCurrentLocation = createTool({
  id: 'getUserCurrentLocation',
  description:
    "Get the current location of a user for weather purposes. Uses IoT device tracking to determine the user's GPS coordinates and zone information.",
  inputSchema: z.object({
    userName: z
      .string()
      .optional()
      .describe('Optional name of the user to locate. If not provided, returns all known user locations.'),
  }),
  outputSchema: z.object({
    found: z.boolean(),
    location: z
      .object({
        userName: z.string(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        zoneName: z.string().optional(),
        state: z.string(),
      })
      .optional(),
    allUsers: z
      .array(
        z.object({
          userName: z.string(),
          latitude: z.number().nullable(),
          longitude: z.number().nullable(),
          zoneName: z.string().optional(),
          state: z.string(),
        }),
      )
      .optional(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const locationResult = await inferUserLocation.execute({
      userName: inputData.userName,
    });

    if (locationResult.users.length === 0) {
      return {
        found: false,
        message: inputData.userName
          ? `No user found matching "${inputData.userName}"`
          : 'No user location data available in IoT system',
      };
    }

    const mapUserToLocation = (user: UserLocationInfo) => {
      const currentZone = user.distancesFromZones.find((zone) => zone.isInZone);
      return {
        userName: user.userName,
        latitude: user.latitude,
        longitude: user.longitude,
        zoneName: currentZone?.zoneName,
        state: user.state,
      };
    };

    if (inputData.userName) {
      const user = locationResult.users[0];
      return {
        found: true,
        location: mapUserToLocation(user),
        message:
          user.latitude !== null
            ? `Found location for "${user.userName}"`
            : `Found "${user.userName}" but GPS coordinates are not available`,
      };
    }

    return {
      found: true,
      allUsers: locationResult.users.map(mapUserToLocation),
      message: `Found location data for ${locationResult.users.length} user(s)`,
    };
  },
});

export const weatherShortcuts = {
  getUserCurrentLocation,
};
