import { z } from 'zod';
import { extractErrorMessage } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { callHomeAssistantApi } from '../internet-of-things/tools.js';
import { getPrimaryUserName, getPrimaryUserPhoneDeviceSlug, slugify } from '../presence/index.js';

/** A Home Assistant service, split into the two halves its API path is built from. */
export interface HomeAssistantService {
  domain: string;
  service: string;
}

/** Home Assistant's `/api/services` response: each domain, and the services it offers. */
const servicesApiResponseSchema = z.array(
  z.object({
    domain: z.string(),
    services: z.record(z.string(), z.unknown()).catch({}),
  }),
);

/** One entry of Home Assistant's `/api/services` response: a domain and the services it offers. */
export type ServicesApiEntry = z.infer<typeof servicesApiResponseSchema>[number];

/**
 * The ESPHome service the Hey Jarvis voice firmware exposes for proactive announcements.
 *
 * The device is flashed with `name_add_mac_suffix: true`, so its services are named
 * `esphome.hass_elevenlabs_<mac>_announce` — the MAC part differs per device and cannot be
 * hardcoded, which is why announcements are sent to whatever Home Assistant's list of services
 * says exists.
 */
const ANNOUNCE_SERVICE_SUFFIX = '_announce';

/** The prefix Home Assistant gives every companion-app notify service. */
const MOBILE_APP_SERVICE_PREFIX = 'mobile_app_';

/** How long the announcement leaves the microphone open for a reply before hanging up. */
export const DEFAULT_ANNOUNCE_SILENCE_SECONDS = 3;

/**
 * How long Home Assistant's list of services is trusted before it is fetched again.
 *
 * Every push notification, alarm and announcement starts by working out which service reaches
 * the phone or the speakers, and the list that answers it holds every service of every
 * integration -- a large response, fetched for an answer that only changes when a phone or a
 * speaker is added. So the list is kept, and once this has passed it is still used while a fresh
 * copy is fetched behind the request. What a kept list can get wrong is handled where it is used:
 * see {@link callSelectedServices}.
 */
const SERVICES_CACHE_TTL_MS = 10 * 60_000;

let cachedServices: { entries: ServicesApiEntry[]; fetchedAt: number } | undefined;
let servicesRefresh: Promise<ServicesApiEntry[]> | undefined;

/** Forgets the kept list of services, for tests. */
export function resetServicesCacheForTest(): void {
  cachedServices = undefined;
  servicesRefresh = undefined;
}

/** Everything Home Assistant can do right now, as domains and their services. */
async function fetchServices(): Promise<ServicesApiEntry[]> {
  return servicesApiResponseSchema.parse(await callHomeAssistantApi('services'));
}

/** Fetches the list into the cache, sharing one request between concurrent callers. */
function refreshServices(): Promise<ServicesApiEntry[]> {
  if (servicesRefresh) {
    return servicesRefresh;
  }

  const refresh = fetchServices()
    .then((entries) => {
      cachedServices = { entries, fetchedAt: Date.now() };
      return entries;
    })
    .finally(() => {
      if (servicesRefresh === refresh) {
        servicesRefresh = undefined;
      }
    });

  servicesRefresh = refresh;
  return refresh;
}

/** The kept list, if there is one, with a refresh started behind it once it is stale. */
function readCachedServices(): ServicesApiEntry[] | undefined {
  if (cachedServices && Date.now() - cachedServices.fetchedAt >= SERVICES_CACHE_TTL_MS) {
    refreshServices().catch((error: unknown) => {
      logger.warn('Could not refresh the Home Assistant services', { error: extractErrorMessage(error) });
    });
  }

  return cachedServices?.entries;
}

function isSameService(left: HomeAssistantService, right: HomeAssistantService): boolean {
  return left.domain === right.domain && left.service === right.service;
}

/** What `select` picks from a kept list, or nothing when it cannot pick from it. */
function selectFromCachedServices(
  select: (entries: ServicesApiEntry[]) => HomeAssistantService[],
  entries: ServicesApiEntry[],
): HomeAssistantService[] {
  try {
    return select(entries);
  } catch {
    return [];
  }
}

/**
 * Calls every service `select` picks out of Home Assistant's services, all at once, with `data`.
 *
 * The services are picked from the kept list (see {@link SERVICES_CACHE_TTL_MS}), which can only
 * be wrong about a phone or speaker that has since been added, renamed or removed. So the list is
 * fetched afresh whenever the kept one picks nothing, or picks a service that then fails. A
 * service that failed and is still offered failed for real, and that failure is thrown; one that
 * is no longer offered is dropped, and whatever the fresh list offers in its place that has not
 * been called yet is called instead. Nothing is called twice, so nobody hears a message twice.
 *
 * @returns The services that were called
 * @throws Whatever `select` throws on a fresh list, or the first service that failed for real
 */
export async function callSelectedServices(
  select: (entries: ServicesApiEntry[]) => HomeAssistantService[],
  data: Record<string, unknown>,
): Promise<HomeAssistantService[]> {
  const cachedEntries = readCachedServices();
  const cachedSelection = cachedEntries ? selectFromCachedServices(select, cachedEntries) : [];

  if (cachedSelection.length === 0) {
    const services = select(await refreshServices());
    await Promise.all(services.map((service) => callService(service, data)));
    return services;
  }

  const outcomes = await Promise.allSettled(cachedSelection.map((service) => callService(service, data)));
  const succeeded = cachedSelection.filter((_service, index) => outcomes[index]?.status === 'fulfilled');
  const failures = cachedSelection.flatMap((service, index) => {
    const outcome = outcomes[index];
    return outcome?.status === 'rejected' ? [{ service, reason: outcome.reason }] : [];
  });

  const [firstFailure] = failures;
  if (!firstFailure) {
    return succeeded;
  }

  const freshEntries = await refreshServices().catch(() => undefined);
  if (!freshEntries) {
    throw firstFailure.reason;
  }

  const freshSelection = select(freshEntries);
  const genuineFailure = failures.find(({ service }) =>
    freshSelection.some((candidate) => isSameService(candidate, service)),
  );
  if (genuineFailure) {
    throw genuineFailure.reason;
  }

  const replacements = freshSelection.filter(
    (candidate) => !cachedSelection.some((called) => isSameService(called, candidate)),
  );
  await Promise.all(replacements.map((service) => callService(service, data)));

  return [...succeeded, ...replacements];
}

function servicesInDomain(entries: ServicesApiEntry[], domain: string): string[] {
  const entry = entries.find((candidate) => candidate.domain === domain);
  return entry ? Object.keys(entry.services) : [];
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
  const pinned = getPinnedNotifyService();
  if (pinned) {
    return pinned;
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

/** The notify service pinned by `HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE`, if one is. */
function getPinnedNotifyService(): HomeAssistantService | undefined {
  const configured = process.env.HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE?.trim();
  if (!configured) {
    return undefined;
  }

  const separatorIndex = configured.indexOf('.');
  return separatorIndex === -1
    ? { domain: 'notify', service: configured }
    : { domain: configured.slice(0, separatorIndex), service: configured.slice(separatorIndex + 1) };
}

/**
 * Announces on every Hey Jarvis voice device, or just the one whose name was asked for.
 *
 * @returns The announce services that were called; empty when no device matched
 */
export async function announceOnVoiceDevices(
  data: Record<string, unknown>,
  deviceName?: string,
): Promise<HomeAssistantService[]> {
  return await callSelectedServices((entries) => selectAnnounceServices(entries, deviceName), data);
}

/**
 * Sends `data` to the companion-app notify service for the primary user's phone.
 *
 * A pinned service is called straight away, without asking Home Assistant which services exist.
 *
 * @returns The service that was called
 */
export async function callPrimaryUserNotifyService(
  data: Record<string, unknown>,
  userName: string = getPrimaryUserName(),
): Promise<HomeAssistantService> {
  const pinned = getPinnedNotifyService();
  if (pinned) {
    await callService(pinned, data);
    return pinned;
  }

  const [service] = await callSelectedServices((entries) => [selectMobileAppNotifyService(entries, userName)], data);
  if (!service) {
    // Unreachable: a selection of one either throws or is called. Kept so the type says so.
    throw new Error("No companion-app notify service was called for the primary user's phone.");
  }
  return service;
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
 *
 * A URL makes tapping the notification open it in the phone's browser. The companion apps disagree
 * on the key — Android reads `clickAction`, iOS reads `url` — and each ignores the other's, so both
 * are sent rather than guessing which phone this is.
 */
export function buildPushPayload(input: {
  message: string;
  title?: string;
  isUrgent: boolean;
  url?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { message: input.message };

  if (input.title) {
    payload.title = input.title;
  }

  const data: Record<string, unknown> = {};

  if (input.isUrgent) {
    Object.assign(data, {
      ttl: 0,
      priority: 'high',
      push: { 'interruption-level': 'time-sensitive' },
    });
  }

  const url = input.url?.trim();
  if (url) {
    Object.assign(data, { clickAction: url, url });
  }

  if (Object.keys(data).length > 0) {
    payload.data = data;
  }

  return payload;
}

/** What `SET_ALARM` needs to know: when, and optionally what to call it. */
export interface PhoneAlarm {
  /** 0-23, in the phone's own time zone. */
  hour: number;
  /** 0-59. */
  minute: number;
  /** Shown in the clock app beside the alarm and when it rings. */
  label?: string;
}

/**
 * Builds the companion-app command that sets an alarm on the phone.
 *
 * Android has no way to be told to set an alarm from outside, but the Home Assistant companion
 * app can launch any activity on command (`message: command_activity`), and Android's clock apps
 * all answer `android.intent.action.SET_ALARM`. `SKIP_UI` sets it without opening the clock app
 * over whatever the user is doing.
 *
 * The extras are the companion app's own string format: comma-separated `name:value:type`. The
 * types are spelled out because the alarm's hour and minute must arrive as integers, and the label
 * is URL-encoded because it is free text and may contain the very commas and colons the format is
 * split on.
 */
export function buildSetAlarmCommand({ hour, minute, label }: PhoneAlarm) {
  const extras = [
    `android.intent.extra.alarm.HOUR:${hour}:int`,
    `android.intent.extra.alarm.MINUTES:${minute}:int`,
    'android.intent.extra.alarm.SKIP_UI:true:boolean',
  ];
  const trimmedLabel = label?.trim();
  if (trimmedLabel) {
    extras.push(`android.intent.extra.alarm.MESSAGE:${encodeURIComponent(trimmedLabel)}:urlencoded`);
  }

  return {
    message: 'command_activity',
    data: {
      intent_action: 'android.intent.action.SET_ALARM',
      intent_extras: extras.join(','),
    },
  };
}
