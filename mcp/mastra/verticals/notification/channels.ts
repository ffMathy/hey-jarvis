import { callHomeAssistantApi } from '../internet-of-things/tools.js';
import { getPrimaryUserPhoneDeviceSlug, slugify } from './presence.js';
import { getPrimaryUserName } from './targets.js';

/** A Home Assistant service, split into the two halves its API path is built from. */
export interface HomeAssistantService {
  domain: string;
  service: string;
}

/** One entry of Home Assistant's `/api/services` response: a domain and the services it offers. */
export interface ServicesApiEntry {
  domain: string;
  services: Record<string, unknown>;
}

/**
 * The ESPHome service the Hey Jarvis voice firmware exposes for proactive announcements.
 *
 * The device is flashed with `name_add_mac_suffix: true`, so its services are named
 * `esphome.hass_elevenlabs_<mac>_announce` — the MAC part differs per device and cannot be
 * hardcoded, which is why every announcement starts by asking Home Assistant what exists.
 */
const ANNOUNCE_SERVICE_SUFFIX = '_announce';

/** The prefix Home Assistant gives every companion-app notify service. */
const MOBILE_APP_SERVICE_PREFIX = 'mobile_app_';

/** How long the announcement leaves the microphone open for a reply before hanging up. */
export const DEFAULT_ANNOUNCE_SILENCE_SECONDS = 3;

/** Everything Home Assistant can do right now, as domains and their services. */
export async function fetchServices(): Promise<ServicesApiEntry[]> {
  const response = (await callHomeAssistantApi('services')) as ServicesApiEntry[];
  return Array.isArray(response) ? response : [];
}

function servicesInDomain(entries: ServicesApiEntry[], domain: string): string[] {
  const entry = entries.find((candidate) => candidate.domain === domain);
  return entry ? Object.keys(entry.services ?? {}) : [];
}

/**
 * Picks the Hey Jarvis voice devices that can announce.
 *
 * @param deviceName - Optional device name or fragment (e.g. "kitchen") to narrow the
 *   announcement to one speaker instead of the whole house.
 */
export function selectAnnounceServices(entries: ServicesApiEntry[], deviceName?: string): HomeAssistantService[] {
  const slug = deviceName ? slugify(deviceName) : undefined;

  return servicesInDomain(entries, 'esphome')
    .filter((service) => service.endsWith(ANNOUNCE_SERVICE_SUFFIX))
    .filter((service) => !slug || service.includes(slug))
    .map((service) => ({ domain: 'esphome', service }));
}

/**
 * Picks the companion-app notify service for the primary user's phone.
 *
 * Resolution order:
 *
 * 1. `HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE`, when the service name is pinned in configuration.
 * 2. The `notify.mobile_app_*` service matching the configured phone device slug, or the user's
 *    own name when no device is configured.
 * 3. The only `notify.mobile_app_*` service there is, if the household has exactly one phone.
 *
 * Anything else throws: pushing a private message to the wrong person's phone is worse than
 * failing loudly.
 */
export function selectMobileAppNotifyService(
  entries: ServicesApiEntry[],
  userName: string = getPrimaryUserName(),
): HomeAssistantService {
  const configured = process.env.HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE?.trim();
  if (configured) {
    const separatorIndex = configured.indexOf('.');
    return separatorIndex === -1
      ? { domain: 'notify', service: configured }
      : { domain: configured.slice(0, separatorIndex), service: configured.slice(separatorIndex + 1) };
  }

  const mobileAppServices = servicesInDomain(entries, 'notify').filter((service) =>
    service.startsWith(MOBILE_APP_SERVICE_PREFIX),
  );

  if (mobileAppServices.length === 0) {
    throw new Error(
      'No Home Assistant companion app (notify.mobile_app_*) service is available, so no push notification can be sent. Install the companion app on the phone, or set HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE.',
    );
  }

  const slug = getPrimaryUserPhoneDeviceSlug() ?? slugify(userName);
  const matching = mobileAppServices.find((service) => service.includes(slug));

  if (matching) {
    return { domain: 'notify', service: matching };
  }

  if (mobileAppServices.length === 1) {
    return { domain: 'notify', service: mobileAppServices[0] };
  }

  throw new Error(
    `Several phones are registered with the Home Assistant companion app (${mobileAppServices.join(', ')}) and none of them matches "${slug}". Set HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE to the right one.`,
  );
}

/** Every Hey Jarvis voice device that can announce, or just the one whose name was asked for. */
export async function findAnnounceServices(deviceName?: string): Promise<HomeAssistantService[]> {
  return selectAnnounceServices(await fetchServices(), deviceName);
}

/** The companion-app notify service for the primary user's phone. */
export async function findMobileAppNotifyService(
  userName: string = getPrimaryUserName(),
): Promise<HomeAssistantService> {
  return selectMobileAppNotifyService(await fetchServices(), userName);
}

/** Calls a Home Assistant service. */
export async function callService(
  { domain, service }: HomeAssistantService,
  data: Record<string, unknown>,
): Promise<void> {
  await callHomeAssistantApi(`services/${domain}/${service}`, 'POST', data);
}

/**
 * Builds the companion-app payload.
 *
 * An urgent notification is pushed straight through instead of being batched, and asks iOS for a
 * time-sensitive interruption — that is the level that surfaces through a focus mode, which is
 * exactly the case that routes here: something urgent for a user whose phone is silenced.
 */
export function buildPushPayload(input: {
  message: string;
  title?: string;
  isUrgent: boolean;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { message: input.message };

  if (input.title) {
    payload.title = input.title;
  }

  if (input.isUrgent) {
    payload.data = {
      ttl: 0,
      priority: 'high',
      push: { 'interruption-level': 'time-sensitive' },
    };
  }

  return payload;
}
