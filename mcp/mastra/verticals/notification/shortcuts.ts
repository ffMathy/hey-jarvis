import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { type DeviceState, getAllDevices } from '../internet-of-things/tools.js';
import { findUserPhoneDevice, getPrimaryUserName, isUserPhoneDevice, type PresenceAnswer } from '../presence/index.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 *
 * Whether the user's phone would make a sound is a notification question — it is the difference
 * between announcing a message out loud in the room he is standing in and pushing it silently —
 * but only the Internet of Things vertical can see the phone, so the reading is done here on top
 * of its devices.
 */

/** Ringer modes that mean the phone will not make a sound. */
const SILENT_RINGER_MODES = new Set(['silent', 'vibrate']);

/** States that mean no do-not-disturb or focus mode is running. Anything else is a filter of some kind. */
const DISTURBABLE_STATES = new Set(['off', 'false', 'none', 'unknown', 'unavailable', '']);

/** Android's interruption filter in its "let everything through" position. */
const UNFILTERED_INTERRUPTION_STATES = new Set(['all', 'unknown', 'unavailable', '']);

/**
 * The primary user's phone, with the sensors that say whether it would ring.
 *
 * A shortcut onto the IoT vertical's `getAllDevices`, filtered to the one device that matters
 * here. The companion app is what puts the ringer, do-not-disturb and focus state into Home
 * Assistant in the first place, so there is nowhere else to read it from.
 */
export const getUserPhoneDevices = createShortcut({
  id: 'getUserPhoneDevices',
  description:
    "Get the primary user's phone as Home Assistant sees it, including the companion app's ringer mode, do-not-disturb and focus sensors.",
  tool: getAllDevices,
  execute: async (_inputData, context) => {
    const { devices } = await executeTool(getAllDevices, {}, context);
    const userName = getPrimaryUserName();

    return { devices: devices.filter((device) => isUserPhoneDevice(device, userName)) };
  },
});

/**
 * Whether the primary user's phone is on silent or has a do-not-disturb or focus mode running.
 *
 * A phone whose state cannot be seen counts as *not* silenced. The only thing this gates is
 * speaking an urgent message out loud in a house the user is standing in, and staying quiet
 * because a sensor is missing is the worse failure of the two.
 *
 * @param devices - Devices already fetched by a caller asking several presence questions at once.
 *   Fetched here when omitted.
 */
export async function isUserPhoneSilenced(devices?: DeviceState[]): Promise<PresenceAnswer> {
  const resolved = devices ?? (await executeTool(getUserPhoneDevices, {})).devices;

  return readPhoneSilenceAnswer(resolved);
}

/** The pure half of {@link isUserPhoneSilenced}. */
export function readPhoneSilenceAnswer(devices: DeviceState[]): PresenceAnswer {
  const phone = findUserPhoneDevice(devices);

  if (!phone) {
    return {
      answer: false,
      reason:
        "No phone of the user's was found in Home Assistant, so it is assumed to be audible. Set HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE to the phone's device name to make this exact.",
    };
  }

  for (const entity of phone.entities) {
    const entityId = entity.id.toLowerCase();
    const state = entity.state.trim().toLowerCase();

    if (entityId.includes('_ringer_mode') && SILENT_RINGER_MODES.has(state)) {
      return { answer: true, reason: `The ringer is set to ${state} (${entity.id}).` };
    }

    if (entityId.includes('_do_not_disturb') && !DISTURBABLE_STATES.has(state)) {
      return { answer: true, reason: `Do not disturb is ${state} (${entity.id}).` };
    }

    if (entityId.includes('_focus') && !DISTURBABLE_STATES.has(state)) {
      return { answer: true, reason: `A focus mode is active (${entity.id}).` };
    }

    if (entityId.includes('_interruption_filter') && !UNFILTERED_INTERRUPTION_STATES.has(state)) {
      return { answer: true, reason: `Notifications are filtered to ${state} (${entity.id}).` };
    }
  }

  return { answer: false, reason: `${phone.name} is not on silent and no do-not-disturb mode is active.` };
}

export const notificationShortcuts = {
  getUserPhoneDevices,
};
