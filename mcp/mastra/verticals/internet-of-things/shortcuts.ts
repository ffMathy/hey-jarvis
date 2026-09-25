import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { setPhoneAlarm } from '../notification/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 *
 * Setting an alarm on the user's phone is a Home Assistant action — the companion app carries it
 * out on command — but the command rides the phone's notify service, and finding that service is
 * the notification vertical's job. So the tool lives there, and this is how the agent that
 * requests reach for anything done through Home Assistant gets at it.
 */
export const setUserPhoneAlarm = createShortcut({
  id: 'setUserPhoneAlarm',
  description:
    "Set an alarm in the clock app on the primary user's Android phone, through the Home Assistant companion app. Takes the time as hour and minute in 24-hour form and an optional label.",
  tool: setPhoneAlarm,
  execute: async (inputData, context) => await executeTool(setPhoneAlarm, inputData, context),
});

export const internetOfThingsShortcuts = {
  setUserPhoneAlarm,
};
