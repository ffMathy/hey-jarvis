import { getDistance } from 'geolib';
import { callHomeAssistantApi } from '../internet-of-things/tools.js';
import { getPrimaryUserName } from './targets.js';

/**
 * How close the user has to be to the car before the two are treated as travelling together.
 *
 * Phone GPS is good to a few tens of metres, and a car that is being driven moves far enough
 * between samples that a tighter radius would flip in and out. 150m is wide enough to survive
 * that and still far short of "somewhere on the same street".
 */
export const CAR_PROXIMITY_METERS = 150;

/** A person or device_tracker entity, with its GPS fix if it has one. */
export interface PresenceEntity {
  entityId: string;
  friendlyName: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
}

/** A sensor or binary_sensor whose state says something about a phone or a car. */
export interface PresenceSignal {
  entityId: string;
  friendlyName: string;
  state: string;
}

/** Everything one Home Assistant template render tells us about where people and cars are. */
export interface PresenceSnapshot {
  persons: PresenceEntity[];
  trackers: PresenceEntity[];
  signals: PresenceSignal[];
}

/** The three questions the notification router asks about the primary user. */
export interface UserPresence {
  userName: string;
  isHome: boolean;
  isInCar: boolean;
  isPhoneSilenced: boolean;
  /** Why each verdict came out the way it did. Reported by the tools so a surprising route can be traced. */
  reasons: {
    home: string;
    car: string;
    phone: string;
  };
}

/**
 * Entity id fragments that mark a state as interesting to presence.
 *
 * Kept in the Jinja template so Home Assistant does the filtering: a household has thousands of
 * sensors and only a handful of them say anything about a phone's ringer or a car's gear.
 *
 * - Home Assistant companion (Android): `_ringer_mode`, `_do_not_disturb_sensor`,
 *   `_interruption_filter`, `_detected_activity`, `_android_auto`, `_car_bluetooth`
 * - Home Assistant companion (iOS): `_focus`, `_activity`
 * - Tessie (Tesla): `_user_present`, `_shift_state`, `_speed`
 */
const SIGNAL_PATTERNS = [
  '_ringer_mode',
  '_do_not_disturb',
  '_interruption_filter',
  '_focus',
  '_activity',
  '_android_auto',
  '_car_bluetooth',
  '_user_present',
  '_shift_state',
  '_speed',
];

/** Ringer modes that mean the phone will not make a sound. */
const SILENT_RINGER_MODES = new Set(['silent', 'vibrate']);

/** States that mean "no do-not-disturb / no focus mode is active". Anything else is a filter of some kind. */
const DISTURBABLE_STATES = new Set(['off', 'false', 'none', 'unknown', 'unavailable', '']);

/** Android's interruption filter in its "let everything through" position. */
const UNFILTERED_INTERRUPTION_STATES = new Set(['all', 'unknown', 'unavailable', '']);

/** Activity-recognition states that mean the phone is riding in a vehicle. */
const IN_VEHICLE_ACTIVITIES = ['automotive', 'in_vehicle', 'in vehicle', 'driving'];

/** Tesla shift states that mean the car is not parked. */
const MOVING_SHIFT_STATES = new Set(['d', 'r', 'n', 'drive', 'reverse', 'neutral']);

/** Entity id fragments that mark an entity as belonging to the car, when no car name is configured. */
const DEFAULT_CAR_PATTERNS = ['tesla', 'tessie'];

/** Turns a display name into the shape Home Assistant uses inside entity ids. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The device slug of the primary user's phone, if it has been configured.
 *
 * Companion-app entities are named after the *device* (`sensor.mathias_iphone_ringer_mode`), not
 * after the person, so in a two-phone household there is no reliable way to tell whose ringer is
 * whose. Setting `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` to the device slug removes the guesswork.
 */
export function getPrimaryUserPhoneDeviceSlug(): string | undefined {
  const configured = process.env.HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE?.trim();
  return configured ? slugify(configured) : undefined;
}

/** Entity id fragments that identify the household car. */
export function getCarPatterns(): string[] {
  const configured = process.env.HEY_JARVIS_CAR_NAME?.trim();
  return configured ? [slugify(configured)] : DEFAULT_CAR_PATTERNS;
}

/**
 * Fetches the presence-relevant slice of Home Assistant's state in a single template render.
 *
 * One render rather than a state-per-entity walk: the interesting entities are spread over four
 * domains, and rendering them together keeps this to one round trip no matter how many devices
 * the house grows.
 */
export async function fetchPresenceSnapshot(): Promise<PresenceSnapshot> {
  const template = `
{%- set signal_patterns = ${JSON.stringify(SIGNAL_PATTERNS)} -%}
{%- set candidates = (states.sensor | list) + (states.binary_sensor | list) -%}
{%- set ns = namespace(signals=[]) -%}
{%- for entity in candidates -%}
{%- if signal_patterns | select('in', entity.entity_id) | list | length > 0 -%}
{%- set ns.signals = ns.signals + [entity] -%}
{%- endif -%}
{%- endfor -%}
{
  "persons": [
    {%- for p in states.person -%}
    {
      "entityId": {{ p.entity_id | to_json }},
      "friendlyName": {{ (p.attributes.friendly_name | default(p.entity_id)) | to_json }},
      "state": {{ p.state | to_json }},
      "latitude": {{ p.attributes.latitude | default('null') }},
      "longitude": {{ p.attributes.longitude | default('null') }}
    }{%- if not loop.last -%},{%- endif -%}
    {%- endfor -%}
  ],
  "trackers": [
    {%- for t in states.device_tracker -%}
    {
      "entityId": {{ t.entity_id | to_json }},
      "friendlyName": {{ (t.attributes.friendly_name | default(t.entity_id)) | to_json }},
      "state": {{ t.state | to_json }},
      "latitude": {{ t.attributes.latitude | default('null') }},
      "longitude": {{ t.attributes.longitude | default('null') }}
    }{%- if not loop.last -%},{%- endif -%}
    {%- endfor -%}
  ],
  "signals": [
    {%- for s in ns.signals -%}
    {
      "entityId": {{ s.entity_id | to_json }},
      "friendlyName": {{ (s.attributes.friendly_name | default(s.entity_id)) | to_json }},
      "state": {{ s.state | to_json }}
    }{%- if not loop.last -%},{%- endif -%}
    {%- endfor -%}
  ]
}
  `
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  const response = await callHomeAssistantApi('template', 'POST', { template });
  const data = (typeof response === 'string' ? JSON.parse(response) : response) as Partial<PresenceSnapshot>;

  return {
    persons: data.persons ?? [],
    trackers: data.trackers ?? [],
    signals: data.signals ?? [],
  };
}

/** Finds the person entity for a user, matching on friendly name first and entity id second. */
export function findPerson(snapshot: PresenceSnapshot, userName: string): PresenceEntity | undefined {
  const name = userName.trim().toLowerCase();
  const slug = slugify(userName);

  return snapshot.persons.find(
    (person) => person.friendlyName.toLowerCase().includes(name) || person.entityId.includes(slug),
  );
}

/**
 * Whether the user is at home.
 *
 * Home Assistant already answers this: a person entity's state is the zone they are in, and
 * `home` is the zone the house is in. No distance maths needed.
 */
export function evaluateHome(
  person: PresenceEntity | undefined,
  userName: string,
): { isHome: boolean; reason: string } {
  if (!person) {
    return { isHome: false, reason: `No person entity found for ${userName}, so home cannot be confirmed.` };
  }

  const isHome = person.state.toLowerCase() === 'home';
  return {
    isHome,
    reason: `${person.friendlyName} is ${isHome ? 'home' : `away (${person.state})`} according to ${person.entityId}.`,
  };
}

/**
 * The phone signals that belong to the primary user.
 *
 * With `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` set this is exact. Without it, entities are matched
 * against the user's own name, which works when the phone is named after its owner and returns
 * nothing when it is not — deliberately nothing rather than everybody's phones, since another
 * person's silent phone must never silence the user's announcements.
 */
export function findUserPhoneSignals(signals: PresenceSignal[], userName: string): PresenceSignal[] {
  const deviceSlug = getPrimaryUserPhoneDeviceSlug();
  const slug = deviceSlug ?? slugify(userName);
  const name = userName.trim().toLowerCase();

  return signals.filter(
    (signal) => signal.entityId.includes(slug) || (!deviceSlug && signal.friendlyName.toLowerCase().includes(name)),
  );
}

/**
 * Whether the user's phone is on silent or has a do-not-disturb / focus mode running.
 *
 * A phone whose state we cannot see counts as *not* silenced: the only thing this gates is
 * speaking an urgent message out loud in a house the user is standing in, and staying quiet
 * because a sensor is missing is the worse failure of the two.
 */
export function evaluatePhoneSilence(phoneSignals: PresenceSignal[]): { isPhoneSilenced: boolean; reason: string } {
  for (const signal of phoneSignals) {
    const state = signal.state.trim().toLowerCase();

    if (signal.entityId.includes('_ringer_mode') && SILENT_RINGER_MODES.has(state)) {
      return { isPhoneSilenced: true, reason: `The ringer is set to ${state} (${signal.entityId}).` };
    }

    if (signal.entityId.includes('_do_not_disturb') && !DISTURBABLE_STATES.has(state)) {
      return { isPhoneSilenced: true, reason: `Do not disturb is ${state} (${signal.entityId}).` };
    }

    if (signal.entityId.includes('_focus') && !DISTURBABLE_STATES.has(state)) {
      return { isPhoneSilenced: true, reason: `A focus mode is active (${signal.entityId}).` };
    }

    if (signal.entityId.includes('_interruption_filter') && !UNFILTERED_INTERRUPTION_STATES.has(state)) {
      return { isPhoneSilenced: true, reason: `Notifications are filtered to ${state} (${signal.entityId}).` };
    }
  }

  if (phoneSignals.length === 0) {
    return {
      isPhoneSilenced: false,
      reason:
        "No ringer, do-not-disturb or focus sensor was found for this phone, so it is assumed to be audible. Set HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE to the phone's device slug to make this exact.",
    };
  }

  return { isPhoneSilenced: false, reason: 'The phone is not on silent and no do-not-disturb mode is active.' };
}

/** True when an activity-recognition sensor says the phone is riding in a vehicle. */
function reportsVehicleActivity(signal: PresenceSignal): boolean {
  if (!signal.entityId.includes('_activity')) {
    return false;
  }

  const state = signal.state.trim().toLowerCase();
  return IN_VEHICLE_ACTIVITIES.some((activity) => state.includes(activity));
}

/** True when the phone says it is plugged into the car — Android Auto, or the car's Bluetooth. */
function reportsCarConnection(signal: PresenceSignal): boolean {
  const isCarConnection = signal.entityId.includes('_android_auto') || signal.entityId.includes('_car_bluetooth');
  return isCarConnection && signal.state.trim().toLowerCase() === 'on';
}

/** Signals belonging to the household car. */
function findCarSignals(signals: PresenceSignal[]): PresenceSignal[] {
  const patterns = getCarPatterns();
  return signals.filter((signal) => patterns.some((pattern) => signal.entityId.includes(pattern)));
}

/** Trackers belonging to the household car. Tessie exposes the car's GPS as `device_tracker.<car>_location`. */
function findCarTrackers(trackers: PresenceEntity[]): PresenceEntity[] {
  const patterns = [...getCarPatterns(), '_location'];
  return trackers.filter((tracker) => patterns.some((pattern) => tracker.entityId.includes(pattern)));
}

/**
 * Whether somebody is sitting in the car and it is not parked.
 *
 * Occupancy on its own is not enough — a car parked in the driveway is within GPS range of a user
 * standing in the kitchen, and without this check every message sent at home would turn into a
 * phone call.
 */
function isCarOccupied(carSignals: PresenceSignal[]): boolean {
  return carSignals.some((signal) => {
    const state = signal.state.trim().toLowerCase();

    if (signal.entityId.includes('_user_present')) {
      return state === 'on';
    }

    if (signal.entityId.includes('_shift_state')) {
      return MOVING_SHIFT_STATES.has(state);
    }

    if (signal.entityId.includes('_speed')) {
      const speed = Number.parseFloat(state);
      return Number.isFinite(speed) && speed > 0;
    }

    return false;
  });
}

/** The car tracker closest to the user, and how far away it is. */
function findClosestCar(
  person: PresenceEntity,
  carTrackers: PresenceEntity[],
): { tracker: PresenceEntity; distanceMeters: number } | undefined {
  if (person.latitude === null || person.longitude === null) {
    return undefined;
  }

  const located = carTrackers.filter((tracker) => tracker.latitude !== null && tracker.longitude !== null);

  let closest: { tracker: PresenceEntity; distanceMeters: number } | undefined;
  for (const tracker of located) {
    const distanceMeters = getDistance(
      { latitude: person.latitude, longitude: person.longitude },
      { latitude: tracker.latitude as number, longitude: tracker.longitude as number },
    );

    if (!closest || distanceMeters < closest.distanceMeters) {
      closest = { tracker, distanceMeters };
    }
  }

  return closest;
}

/**
 * Whether the user is in the car right now.
 *
 * Two independent signals, either of which is enough:
 *
 * 1. The phone says so — activity recognition reporting "in vehicle", or a live Android Auto /
 *    car Bluetooth connection. This works in any car, including one that is not the Tesla.
 * 2. The car says so — it is occupied or moving, and the user's GPS is on top of it.
 */
export function evaluateCarPresence(
  person: PresenceEntity | undefined,
  snapshot: PresenceSnapshot,
  phoneSignals: PresenceSignal[],
): { isInCar: boolean; reason: string } {
  const vehicleActivity = phoneSignals.find(reportsVehicleActivity);
  if (vehicleActivity) {
    return {
      isInCar: true,
      reason: `The phone reports vehicle activity: ${vehicleActivity.state} (${vehicleActivity.entityId}).`,
    };
  }

  const carConnection = phoneSignals.find(reportsCarConnection);
  if (carConnection) {
    return { isInCar: true, reason: `The phone is connected to the car (${carConnection.entityId}).` };
  }

  if (!person) {
    return { isInCar: false, reason: "No person entity to compare against the car's location." };
  }

  const carSignals = findCarSignals(snapshot.signals);
  if (!isCarOccupied(carSignals)) {
    return { isInCar: false, reason: 'The car reports nobody on board and is not moving.' };
  }

  const closest = findClosestCar(person, findCarTrackers(snapshot.trackers));
  if (!closest) {
    return { isInCar: false, reason: 'The car is occupied, but there is no GPS fix to place the user in it.' };
  }

  const isInCar = closest.distanceMeters <= CAR_PROXIMITY_METERS;
  return {
    isInCar,
    reason: isInCar
      ? `The car is occupied and the user is ${closest.distanceMeters}m from it (${closest.tracker.entityId}).`
      : `The car is occupied, but the user is ${closest.distanceMeters}m away from it, which is further than the ${CAR_PROXIMITY_METERS}m needed to be inside it.`,
  };
}

/** Answers all three presence questions from one snapshot. Pure, so the routing tests never need Home Assistant. */
export function derivePresence(snapshot: PresenceSnapshot, userName: string): UserPresence {
  const person = findPerson(snapshot, userName);
  const phoneSignals = findUserPhoneSignals(snapshot.signals, userName);

  const { isHome, reason: home } = evaluateHome(person, userName);
  const { isInCar, reason: car } = evaluateCarPresence(person, snapshot, phoneSignals);
  const { isPhoneSilenced, reason: phone } = evaluatePhoneSilence(phoneSignals);

  return {
    userName,
    isHome,
    isInCar,
    isPhoneSilenced,
    reasons: { home, car, phone },
  };
}

/** Where the primary user is, and whether his phone would make a sound. */
export async function getUserPresence(userName: string = getPrimaryUserName()): Promise<UserPresence> {
  return derivePresence(await fetchPresenceSnapshot(), userName);
}
