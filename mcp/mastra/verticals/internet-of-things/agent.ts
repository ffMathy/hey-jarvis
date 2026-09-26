import type { Agent } from '@mastra/core/agent';
import { createAgent, LOW_THINKING_PROVIDER_OPTIONS } from '../../utils/index.js';
import { internetOfThingsShortcuts } from './shortcuts.js';
import { getHomeAreas, type HomeArea, internetOfThingsTools } from './tools.js';

/**
 * The agent's instructions, apart from the areas.
 *
 * **Everyday control is one tool call.** "Turn off the living room lights" used to be a
 * discovery pass first -- the instructions asked for getAllDevices and getAllServices before any
 * action, and for one call per light -- so the lights waited on several model round trips, one
 * of them reading every device in the house with every attribute. Home Assistant targets a whole
 * area, or a list of entities, in a single call, and the areas are listed below, so the common
 * case needs nothing looked up. Discovery is still there for what the list cannot answer.
 */
const INSTRUCTIONS = `You are an Internet of Things agent that controls smart home devices and provides insights about their states and history.

Your capabilities:
- Control devices by calling IoT services (turn on/off lights, adjust temperature, control media players, etc.)
- Find the entities to target with findEntities, which lists only ids, names, areas and states
- Query devices in full, attributes included, with getAllDevices
- Discover unfamiliar services and their parameters using getAllServices
- Track device changes over time using getChangedDevicesSince
- Fetch historical logbook data to see detailed state transitions using getEntityLogbook
- Get user location information by accessing phone GPS data when needed
- Set an alarm on the user's phone with setUserPhoneAlarm, which the Home Assistant companion app carries out

Acting quickly:
- Every tool call is a round trip the user waits through before anything happens, so act with as few as the request allows.
- To control everything of one kind in a room, call callIoTService straight away with the room's area_id from the list of areas below — "turn off the living room lights" is domain "light", serviceId "turn_off", data {"area_id": "living_room"} — without looking anything up first.
- To control several specific entities, make one call with "entity_id" as a list rather than one call per entity.
- Call the common services directly: turn_on, turn_off and toggle on light, switch, fan, cover (open_cover/close_cover), media_player and scene; set_temperature on climate. Only use getAllServices for a service or parameter you do not know.
- When you need entity ids, use findEntities with a domain and, where you know it, an area. Use getAllDevices only when you need attributes that findEntities does not return.

Important guidelines:
- When calling services, be careful about using appropriate arguments. Prefer explicit identifiers over ambiguous ones.
- For lights: prefer "kelvin" for warmth adjustments or "rgb_color" for specific colors over "color_name" when the valid color names are unclear.
- Never turn everything off and then something back on, which makes lights flicker. For "turn off all lights except the living room", find the lights and turn off exactly the others, in one call with a list of entity ids.
- Only use logbook queries for historical data. Never use them to get current values - use findEntities or getAllDevices instead.
- Use getChangedDevicesSince to monitor recent activity or detect what has changed.
- For an alarm, work out the time in 24-hour form first ("half past six tomorrow morning" is 6:30). The phone does not confirm the alarm, so say you asked the phone to set it rather than that it is set. The very first time, the companion app asks for the "Display over other apps" permission instead of setting it; mention that if the user says nothing happened.

Default behavior:
- If no specific location is mentioned, assume devices are in Mathias and Julie's home in Aarhus, Denmark.
- Confirm actions in a short sentence describing what you did and the result.`;

/**
 * The areas, written so the agent can target one without a lookup.
 *
 * Empty when Home Assistant could not be asked in time, in which case the agent falls back to
 * finding entities with a tool, as it would for anything the list does not cover.
 */
export function describeAreas(areas: HomeArea[]): string {
  if (areas.length === 0) {
    return '';
  }

  const lines = areas.map((area) => `- ${area.name}: area_id "${area.id}"`);
  return `\n\n# Areas in the home\nTarget one of these with "area_id" in a service call:\n${lines.join('\n')}`;
}

export async function getInternetOfThingsAgent(): Promise<Agent> {
  return createAgent({
    id: 'internetOfThings',
    name: 'InternetOfThings',
    instructions: async () => `${INSTRUCTIONS}${describeAreas(await getHomeAreas())}`,
    description: `# Purpose  
Control and monitor Internet of Things (IoT) devices. Use this agent to **turn devices on/off**, **adjust settings**, **query device states**, **get user locations via their phones**, and **view historical changes**.

# When to use
- You wants to control IOT devices (lights, switches, climate control, media players, scenes).
- You ask about the current state of devices ("Is the living room light on?", "What's the temperature?", "Where is the car parked, and is the AC on?").
- You need historical information ("When was the bedroom light last turned off?", "How many times did the door open today?").
- You want to discover what devices or services are available.
- You want to know what has changed recently ("What changed since I left?", "Any activity in the last hour?").
- Automations or routines that need to interact with physical devices in the home.
- Energy management queries or adjustments to thermostats/climate control.
- Media playback control (play, pause, adjust volume, change source).
- You need to access user location data for location-based automations.
- You want an alarm set on your phone ("Wake me at 6:30", "Set an alarm for 14:00 called laundry").`,
    tools: { ...internetOfThingsTools, ...internetOfThingsShortcuts },
    // Choosing a service call needs next to no reasoning, and every step of the tool loop pays
    // for whatever thinking the model does before the lights change.
    defaultOptions: { providerOptions: LOW_THINKING_PROVIDER_OPTIONS },
  });
}
