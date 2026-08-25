import { getDistance } from 'geolib';
import { createShortcut } from '../../utils/shortcut-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { type DeviceState, getAllDevices, inferUserLocation, type UserLocation } from '../internet-of-things/tools.js';

/**
 * Shortcuts are tools that piggy-back on other verticals' capabilities.
 *
 * Everything this vertical knows comes out of the Internet of Things vertical: Home Assistant is
 * the only thing that can see a person, a phone or a car. What lives here is the reading of it —
 * turning person entities, device trackers and a Tesla's gear selector into the two answers the
 * rest of the house asks for: is the user home, and is the user in the car.
 */

type Entity = DeviceState['entities'][number];

/**
 * How close the user has to be to the car before the two are treated as travelling together.
 *
 * Phone GPS is good to a few tens of metres, and a car that is being driven moves far enough
 * between samples that a tighter radius would flip in and out. 150m is wide enough to survive
 * that and still far short of "somewhere on the same street".
 */
export const CAR_PROXIMITY_METERS = 150;

/** Entity id fragments that identify the household car, when no car name is configured. */
const DEFAULT_CAR_PATTERNS = ['tesla', 'tessie'];

/** Entities only a car has. Their presence is enough to recognise a car nobody has named. */
const CAR_ENTITY_PATTERNS = ['_shift_state', '_user_present'];

/** Entities only the Home Assistant companion app creates. Their presence marks a device as a phone. */
const PHONE_ENTITY_PATTERNS = [
  '_ringer_mode',
  '_do_not_disturb',
  '_interruption_filter',
  '_focus',
  '_activity',
  '_android_auto',
  '_car_bluetooth',
  '_battery_level',
];

/** Activity-recognition states that mean the phone is riding in a vehicle. */
const IN_VEHICLE_ACTIVITIES = ['automotive', 'in_vehicle', 'in vehicle', 'driving'];

/** Tesla shift states that mean the car is not parked. */
const MOVING_SHIFT_STATES = new Set(['d', 'r', 'n', 'drive', 'reverse', 'neutral']);

/** The answer to one presence question, and why it came out that way. */
export interface PresenceAnswer {
  answer: boolean;
  /** One sentence of reasoning. Carried through to the notification routing so a surprising route can be traced. */
  reason: string;
}

/** Everything the presence questions are answered from, fetched once. */
export interface PresenceSources {
  location: UserLocation | undefined;
  devices: DeviceState[];
}

/** Turns a display name into the shape Home Assistant uses inside entity ids. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * The person the house means by "the user".
 *
 * Lives here because this is the vertical that has to find them: the name is what person entities
 * and companion-app devices are matched against. Read through a function rather than captured in a
 * module constant so a household with a different primary user needs no reload.
 */
export function getPrimaryUserName(): string {
  return process.env.HEY_JARVIS_PRIMARY_USER_NAME?.trim() || 'Mathias';
}

/**
 * The device slug of the primary user's phone, if it has been configured.
 *
 * Companion-app devices are named after the *phone* ("Pixel 9"), not after its owner, so in a
 * two-phone household there is no reliable way to tell whose is whose. Setting
 * `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` to the device name removes the guesswork.
 */
export function getPrimaryUserPhoneDeviceSlug(): string | undefined {
  const configured = process.env.HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE?.trim();
  return configured ? slugify(configured) : undefined;
}

/** Name fragments that identify the household car. */
export function getCarPatterns(): string[] {
  const configured = process.env.HEY_JARVIS_CAR_NAME?.trim();
  return configured ? [slugify(configured)] : DEFAULT_CAR_PATTERNS;
}

/** Every searchable name a device goes by: its own, and each of its entity ids. */
function deviceIdentifiers(device: DeviceState): string[] {
  return [slugify(device.name), ...device.entities.map((entity) => entity.id.toLowerCase())];
}

function hasEntityMatching(device: DeviceState, patterns: string[]): boolean {
  return device.entities.some((entity) => patterns.some((pattern) => entity.id.toLowerCase().includes(pattern)));
}

/**
 * Whether a device is the household car.
 *
 * Matched by name first — a car that has been named in configuration, or the Tesla integrations
 * that put "tesla"/"tessie" in their entity ids — and otherwise by the entities only a car has.
 */
export function isCarDevice(device: DeviceState): boolean {
  const carPatterns = getCarPatterns();
  const matchesName = deviceIdentifiers(device).some((identifier) =>
    carPatterns.some((pattern) => identifier.includes(pattern)),
  );

  return matchesName || hasEntityMatching(device, CAR_ENTITY_PATTERNS);
}

/**
 * Whether a device is the primary user's phone.
 *
 * A device only counts as a phone if it carries companion-app entities at all, so a laptop or a
 * tablet named after its owner is not mistaken for one. Which phone is *his* comes from the
 * configured device slug, or from his own name when the phone is named after him. Neither
 * matching means no phone is found — deliberately none rather than everybody's, since another
 * person's phone must never answer questions about his.
 */
export function isUserPhoneDevice(device: DeviceState, userName: string = getPrimaryUserName()): boolean {
  if (!hasEntityMatching(device, PHONE_ENTITY_PATTERNS)) {
    return false;
  }

  const slug = getPrimaryUserPhoneDeviceSlug() ?? slugify(userName);
  return deviceIdentifiers(device).some((identifier) => identifier.includes(slug));
}

/** The primary user's phone, if Home Assistant can see one. */
export function findUserPhoneDevice(
  devices: DeviceState[],
  userName: string = getPrimaryUserName(),
): DeviceState | undefined {
  return devices.find((device) => isUserPhoneDevice(device, userName));
}

/** Reads a numeric entity attribute, without trusting Home Assistant to have sent a number. */
function readNumberAttribute(entity: Entity, attribute: string): number | null {
  const value = entity.attributes[attribute];

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * The primary user's own location, as Home Assistant tracks it.
 *
 * A shortcut onto the IoT vertical's `inferUserLocation`, narrowed to the one person this vertical
 * is about so callers never have to know which of the household's people that is.
 */
export const getUserLocation = createShortcut({
  id: 'getUserLocation',
  description:
    "Get the primary user's current location from Home Assistant: the zone they are in, their GPS fix, and how far they are from every configured zone.",
  tool: inferUserLocation,
  execute: async (inputData, context) =>
    await executeTool(inferUserLocation, { userName: inputData.userName ?? getPrimaryUserName() }, context),
});

/**
 * The devices that say where the user is: the car, and his phone.
 *
 * A shortcut onto the IoT vertical's `getAllDevices`, filtered down to the two devices any
 * presence question turns on. Everything else in the house is noise here.
 */
export const getPresenceDevices = createShortcut({
  id: 'getPresenceDevices',
  description:
    "Get the devices that report on where the primary user is: the household car, and the user's phone with its motion and connection sensors.",
  tool: getAllDevices,
  execute: async (_inputData, context) => {
    const { devices } = await executeTool(getAllDevices, {}, context);
    const userName = getPrimaryUserName();

    return { devices: devices.filter((device) => isCarDevice(device) || isUserPhoneDevice(device, userName)) };
  },
});

/**
 * Fetches everything the presence questions are answered from, in one go.
 *
 * Both questions read the same two sources, and asking them separately would fetch each twice, so
 * a caller asking more than one presence question fetches once and passes the result along.
 */
export async function fetchPresenceSources(userName: string = getPrimaryUserName()): Promise<PresenceSources> {
  const [locations, devices] = await Promise.all([
    executeTool(getUserLocation, { userName }),
    executeTool(getPresenceDevices, {}),
  ]);

  return { location: locations.users[0], devices: devices.devices };
}

/**
 * Whether the primary user is at home.
 *
 * Home Assistant already answers this: a person entity's state is the zone they are in, and `home`
 * is the zone the house is in. The zone list is checked as well, because a person whose state is a
 * named sub-zone of the property is still home.
 */
export async function isUserHome(sources?: PresenceSources): Promise<PresenceAnswer> {
  const { location } = sources ?? (await fetchPresenceSources());

  return readHomeAnswer(location);
}

/** The pure half of {@link isUserHome}. */
export function readHomeAnswer(location: UserLocation | undefined): PresenceAnswer {
  if (!location) {
    return {
      answer: false,
      reason: 'Home Assistant knows of no person entity for the user, so home cannot be confirmed.',
    };
  }

  const isInHomeZone = location.distancesFromZones.some(
    (zone) => zone.zoneName.trim().toLowerCase() === 'home' && zone.isInZone,
  );
  const answer = location.state.trim().toLowerCase() === 'home' || isInHomeZone;

  return {
    answer,
    reason: `${location.userName} is ${answer ? 'home' : `away (${location.state})`} according to ${location.userId}.`,
  };
}

/**
 * Whether the primary user is in the car right now.
 *
 * Two independent signals, either of which is enough:
 *
 * 1. The phone says so — activity recognition reporting "in vehicle", or a live Android Auto or
 *    car Bluetooth connection. This works in any car, including one the house cannot see.
 * 2. The car says so — it is occupied or moving, and the user's GPS is on top of it.
 *
 * The occupancy half of the second signal is what makes it usable: a car parked in the driveway
 * sits within GPS range of somebody standing in the kitchen, so proximity on its own would put the
 * user in the car every time he is home.
 */
export async function isUserInCar(sources?: PresenceSources): Promise<PresenceAnswer> {
  const resolved = sources ?? (await fetchPresenceSources());

  return readCarAnswer(resolved);
}

/** The pure half of {@link isUserInCar}. */
export function readCarAnswer({ location, devices }: PresenceSources): PresenceAnswer {
  const phone = findUserPhoneDevice(devices);

  const phoneSignal = phone && readPhoneVehicleSignal(phone);
  if (phoneSignal) {
    return { answer: true, reason: phoneSignal };
  }

  const cars = devices.filter(isCarDevice);
  const occupied = cars.find(isCarOccupied);
  if (!occupied) {
    return { answer: false, reason: 'The car reports nobody on board and is not moving.' };
  }

  if (!location || location.latitude === null || location.longitude === null) {
    return { answer: false, reason: 'The car is occupied, but there is no GPS fix to place the user in it.' };
  }

  const distanceMeters = distanceToCar(occupied, location);
  if (distanceMeters === null) {
    return { answer: false, reason: `${occupied.name} is occupied, but reports no location of its own.` };
  }

  const answer = distanceMeters <= CAR_PROXIMITY_METERS;
  return {
    answer,
    reason: answer
      ? `${occupied.name} is occupied and the user is ${distanceMeters}m from it.`
      : `${occupied.name} is occupied, but the user is ${distanceMeters}m away from it — further than the ${CAR_PROXIMITY_METERS}m needed to be inside it.`,
  };
}

/** What the phone itself says about riding in a vehicle, if anything. */
function readPhoneVehicleSignal(phone: DeviceState): string | undefined {
  for (const entity of phone.entities) {
    const entityId = entity.id.toLowerCase();
    const state = entity.state.trim().toLowerCase();

    if (entityId.includes('_activity') && IN_VEHICLE_ACTIVITIES.some((activity) => state.includes(activity))) {
      return `${phone.name} reports vehicle activity: ${entity.state} (${entity.id}).`;
    }

    if ((entityId.includes('_android_auto') || entityId.includes('_car_bluetooth')) && state === 'on') {
      return `${phone.name} is connected to the car (${entity.id}).`;
    }
  }

  return undefined;
}

/** Whether somebody is sitting in the car, or it is not parked. */
function isCarOccupied(car: DeviceState): boolean {
  return car.entities.some((entity) => {
    const entityId = entity.id.toLowerCase();
    const state = entity.state.trim().toLowerCase();

    if (entityId.includes('_user_present')) {
      return state === 'on';
    }

    if (entityId.includes('_shift_state')) {
      return MOVING_SHIFT_STATES.has(state);
    }

    if (entityId.includes('_speed')) {
      const speed = Number.parseFloat(state);
      return Number.isFinite(speed) && speed > 0;
    }

    return false;
  });
}

/** How far the user is from the car, or null when the car reports no position. */
function distanceToCar(car: DeviceState, location: UserLocation): number | null {
  const userPosition = { latitude: location.latitude as number, longitude: location.longitude as number };

  let closest: number | null = null;
  for (const entity of car.entities) {
    const latitude = readNumberAttribute(entity, 'latitude');
    const longitude = readNumberAttribute(entity, 'longitude');

    if (latitude === null || longitude === null) {
      continue;
    }

    const distanceMeters = getDistance(userPosition, { latitude, longitude });
    if (closest === null || distanceMeters < closest) {
      closest = distanceMeters;
    }
  }

  return closest;
}

export const presenceShortcuts = {
  getPresenceDevices,
  getUserLocation,
};
