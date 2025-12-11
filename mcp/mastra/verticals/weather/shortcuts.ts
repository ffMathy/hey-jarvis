import { createShortcut } from '../../utils/shortcut-factory.js';
import { isValidationError } from '../../utils/validation-error.js';
import { inferUserLocation } from '../internet-of-things/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 * They allow a vertical to leverage tools from other domains while maintaining
 * its own domain-specific interface.
 *
 * Shortcuts use createShortcut which automatically reuses the input and output
 * schemas from the underlying tool they wrap.
 */

/**
 * Get the user's current location for weather-related queries.
 * This shortcut uses the IoT vertical's inferUserLocation tool to determine
 * where the user is located, enabling location-aware weather features.
 */
export const getUserCurrentLocation = createShortcut({
  id: 'getUserCurrentLocation',
  description:
    "Get the current location of a user for weather purposes. Uses IoT device tracking to determine the user's GPS coordinates and zone information.",
  tool: inferUserLocation,
  execute: async (input) => {
    const result = await inferUserLocation.execute(input);

    // Handle ValidationError case - throw so caller can handle
    if (isValidationError(result)) {
      throw new Error(`Failed to infer user location: ${result.message}`);
    }

    return result;
  },
});

export const weatherShortcuts = {
  getUserCurrentLocation,
};
