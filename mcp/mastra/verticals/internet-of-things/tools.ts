import { getDistance } from 'geolib';
import { chunk } from 'lodash-es';
import { z } from 'zod';
import {
  type AffectedEntity,
  affectedEntitySchema,
  cleanAffectedEntities,
  lookUpWithinTimeLimit,
  markAsAffectingEntities,
} from '../../utils/affected-entities.js';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';
import { createTtlCache } from '../../utils/ttl-cache.js';
import {
  areasInSnapshot,
  changedSinceInSnapshot,
  describeDevicesInSnapshot,
  domainsInSnapshot,
  entityIdsInSnapshot,
  getHomeSnapshot,
  peopleAndZonesInSnapshot,
  serviceTargetsInSnapshot,
  summarizeEntitiesInSnapshot,
} from './home-state-cache.js';

// Interface for Home Assistant logbook entry
interface LogbookEntry {
  when: string;
  name: string;
  message?: string;
  domain: string;
  entity_id?: string;
  state?: string;
  context_user_id?: string;
}

// Interface for Home Assistant service definition
interface ServiceDefinition {
  name?: string;
  description?: string;
  fields?: Record<
    string,
    {
      description?: string;
      example?: unknown;
      required?: boolean;
      selector?: unknown;
    }
  >;
}

// Interface for Home Assistant device/entity state
export interface DeviceState {
  id: string;
  name: string;
  labels: string[];
  area: string | null;
  last_changed: string;
  entities: Array<{
    id: string;
    domain: string;
    area: string | null;
    labels: string[];
    state: string;
    attributes: Record<string, unknown>;
    last_changed: string;
  }>;
}

// Interface for changed device state (n8n format with device info)
export interface ChangedDeviceState {
  device_id: string;
  device_name: string;
  device_label_ids: string[];
  entity_id: string;
  entity_label_ids: string[];
  state: string;
  last_changed: number;
}

// Interface for Home Assistant services API response
interface ServicesApiResponse {
  domain: string;
  services: Record<string, ServiceDefinition>;
}

// Type for services grouped by domain
type ServicesByDomain = Record<string, Record<string, ServiceDefinition>>;

/**
 * Where Home Assistant is and how to authenticate against it, for both the REST calls here and
 * the websocket the event monitor holds open.
 */
export const getHomeAssistantConfig = () => {
  let url = process.env.HEY_JARVIS_HOME_ASSISTANT_URL;
  let token = process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN;

  // SUPERVISOR_TOKEN is provided when running within Home Assistant
  // We use it to connect to the local Home Assistant instance
  if (!url || !token) {
    const supervisorToken = process.env.SUPERVISOR_TOKEN;
    if (supervisorToken) {
      // When running as addon, Home Assistant is available at supervisor's core API
      url = 'http://supervisor/core';
      token = supervisorToken;
    }
  }

  if (!url || !token) {
    throw new Error(
      'Home Assistant configuration not found. Please set HEY_JARVIS_HOME_ASSISTANT_URL and HEY_JARVIS_HOME_ASSISTANT_TOKEN environment variables, or provide SUPERVISOR_TOKEN.',
    );
  }

  return { url, token };
};

/**
 * Makes a Home Assistant REST API call.
 *
 * Exported so sibling verticals that talk to the same instance -- the notification vertical
 * renders presence templates and calls announce/notify services -- go through one place that
 * knows how the add-on, the tunnel and the supervisor token fit together.
 */
export async function callHomeAssistantApi(endpoint: string, method = 'GET', body?: unknown) {
  const { url, token } = getHomeAssistantConfig();
  const apiUrl = `${url}/api/${endpoint}`;

  const response = await fetch(apiUrl, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Home Assistant puts the actual reason in the body — a template rendering
    // error, an unknown entity, a malformed filter. Reporting only statusText
    // turns every one of those into an unactionable "Bad Request".
    const detail = await response.text().catch(() => '');
    const suffix = detail ? ` — ${detail.slice(0, 500)}` : '';
    throw new Error(`Home Assistant API error calling ${method} ${endpoint}: ${response.statusText}${suffix}`);
  }

  return response.json();
}

/**
 * Makes a Home Assistant domain safe to write into a template.
 *
 * Domains are lower-case words joined by underscores. The model sometimes capitalises one
 * ("Light"), which used to match nothing at all rather than fail, so it is normalised first;
 * anything still not domain-shaped is refused, because it is written into template source
 * where it would be syntax rather than a name.
 *
 * @throws If the value is not a domain name
 */
export function normalizeDomain(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error(`"${domain}" is not a Home Assistant domain; expected something like "light" or "switch"`);
  }
  return normalized;
}

/** One target field of a service call: an id, a comma-separated string of them, or a list. */
const serviceTargetIdsSchema = z.union([z.string(), z.array(z.string())]).optional();

/** The target fields of a service call's data, which is otherwise free-form. */
const serviceTargetSchema = z.object({
  entity_id: serviceTargetIdsSchema,
  area_id: serviceTargetIdsSchema,
  device_id: serviceTargetIdsSchema,
});

/**
 * The words Home Assistant reads in `entity_id` as "every entity" or "no entity" rather than as ids.
 *
 * Neither is resolved: every light in the house is a survey rather than something being worked on,
 * and no entity is nothing to report.
 */
const ENTITY_ID_KEYWORDS = new Set(['all', 'none']);

function idsOf(value: z.infer<typeof serviceTargetIdsSchema>): string[] {
  const ids = typeof value === 'string' ? value.split(',') : (value ?? []);
  return ids.map((id) => id.trim()).filter((id) => id.length > 0);
}

/**
 * Renders the entities a service call targets, each with its name: the ids given, and every entity
 * of the service's domain in the areas and devices given.
 *
 * Areas and devices are narrowed to the domain because that is what the service reaches --
 * `light.turn_off` on the living room switches off its lights, not its speaker. The one domain that
 * reaches everything is `homeassistant`, so it is not narrowed. Ids Home Assistant does not know are
 * left out, since nothing was done to them.
 *
 * @param domain - Already passed through {@link normalizeDomain}, since it is written into the template
 */
function buildServiceTargetTemplate(
  domain: string,
  targets: { entityIds: string[]; areaIds: string[]; deviceIds: string[] },
): string {
  const inDomain = domain === 'homeassistant' ? 'true' : `e.startswith('${domain}.')`;

  return `
{%- set ns = namespace(ids=${JSON.stringify(targets.entityIds)}, items=[]) -%}
{%- for a in ${JSON.stringify(targets.areaIds)} -%}
  {%- for e in area_entities(a) if ${inDomain} -%}{%- set ns.ids = ns.ids + [e] -%}{%- endfor -%}
{%- endfor -%}
{%- for d in ${JSON.stringify(targets.deviceIds)} -%}
  {%- for e in device_entities(d) if ${inDomain} -%}{%- set ns.ids = ns.ids + [e] -%}{%- endfor -%}
{%- endfor -%}
{%- for e in ns.ids|unique -%}
  {%- set st = states[e] -%}
  {%- if st -%}{%- set ns.items = ns.items + [{"id":e,"name":st.name|string}] -%}{%- endif -%}
{%- endfor -%}
{{ ns.items | to_json }}
    `
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

async function renderServiceTargets(domain: string, data: Record<string, unknown>): Promise<AffectedEntity[]> {
  const target = serviceTargetSchema.parse(data);
  const entityIds = idsOf(target.entity_id).filter((id) => !ENTITY_ID_KEYWORDS.has(id.toLowerCase()));
  const areaIds = idsOf(target.area_id);
  const deviceIds = idsOf(target.device_id);
  if (entityIds.length + areaIds.length + deviceIds.length === 0) {
    return [];
  }

  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return cleanAffectedEntities(
      serviceTargetsInSnapshot(snapshot, normalizeDomain(domain), { entityIds, areaIds, deviceIds }),
    );
  }

  const template = buildServiceTargetTemplate(normalizeDomain(domain), { entityIds, areaIds, deviceIds });
  const response = await callHomeAssistantApi('template', 'POST', { template });
  const parsed: unknown = typeof response === 'string' ? JSON.parse(response) : response;

  return cleanAffectedEntities(z.array(affectedEntitySchema).parse(parsed));
}

/**
 * The entities a service call reaches, for sir's headset to light up. Never rejects.
 *
 * Asked for alongside the call rather than after it, and given up on at the lookup's time limit (see
 * `lookUpWithinTimeLimit`): an area's lights are only known to Home Assistant, and the call must
 * never wait long on the answer, let alone fail over it.
 */
async function resolveServiceTargets(domain: string, data: Record<string, unknown>): Promise<AffectedEntity[]> {
  return await lookUpWithinTimeLimit(
    `the targets of a ${domain} service call`,
    () => renderServiceTargets(domain, data),
    [],
  );
}

const serviceCallResultSchema = z.object({ targets: z.array(affectedEntitySchema) });

// Tool to call an IoT service
export const callIoTService = createTool({
  id: 'callIoTService',
  description:
    'Call an IoT service to control devices or trigger actions. Use this to turn devices on/off, adjust settings, or perform any IoT service action. Target a whole room with "area_id", or several entities at once by passing "entity_id" as a list, in a single call.',
  inputSchema: z.object({
    domain: z
      .string()
      .describe(
        'The domain where the service is located (e.g., "light", "switch", "media_player", "climate", "scene")',
      ),
    serviceId: z
      .string()
      .describe('The ID of the service to be called (e.g., "turn_on", "turn_off", "toggle", "set_temperature")'),
    data: z
      .record(z.string(), z.unknown())
      .describe(
        'A parameter object containing the service data: the target, and any service-specific parameters like "brightness_pct", "temperature", "rgb_color", etc. The target is "area_id" (every matching entity in that area, e.g. {"area_id": "living_room"}), "entity_id" (one id or a list of ids), or "device_id".',
      ),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether Home Assistant accepted the call'),
    domain: z.string().describe('The domain the service is in'),
    service: z.string().describe('The service that was called'),
    data: z.record(z.string(), z.unknown()).describe('The service data it was called with'),
    message: z.string().describe('What happened, in a sentence'),
    targets: z
      .array(affectedEntitySchema)
      .describe('The entities the call reached, each with its name; empty when Home Assistant could not say in time'),
  }),
  execute: async (inputData) => {
    const endpoint = `services/${inputData.domain}/${inputData.serviceId}`;
    const calledAt = Date.now();
    const [, targets] = await Promise.all([
      callHomeAssistantApi(endpoint, 'POST', inputData.data),
      resolveServiceTargets(inputData.domain, inputData.data),
    ]);
    // The moment the house actually changes, which is what a slow request is measured against.
    logger.info('Called a Home Assistant service', {
      service: `${inputData.domain}.${inputData.serviceId}`,
      durationMs: Date.now() - calledAt,
    });

    return {
      success: true,
      domain: inputData.domain,
      service: inputData.serviceId,
      data: inputData.data,
      message: `Successfully called ${inputData.domain}.${inputData.serviceId}`,
      targets,
    };
  },
});

markAsAffectingEntities(
  callIoTService,
  (_toolArguments, toolResult) => serviceCallResultSchema.parse(toolResult).targets,
);

// Tool to get logbook entries for an entity
export const getEntityLogbook = createTool({
  id: 'getEntityLogbook',
  description:
    'Fetches the logbook entries for a given entity and time range. Use this to see how an entity has changed state over time. Only use this when you need historical data - never use it for current values.',
  inputSchema: z.object({
    entityId: z
      .string()
      .describe('The entity ID to fetch logbook entries for (e.g., "light.living_room", "switch.bedroom")'),
    startTime: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp for the start of the time range (optional, defaults to 24 hours ago)'),
    endTime: z
      .string()
      .optional()
      .describe('ISO 8601 timestamp for the end of the time range (optional, defaults to now)'),
  }),
  outputSchema: z.object({
    entityId: z.string().describe('The entity the entries are for'),
    entries: z
      .array(
        z.object({
          when: z.string().describe('When it happened, as an ISO 8601 timestamp'),
          name: z.string().describe('The name of the entity it happened to'),
          message: z.string().optional().describe('What happened, as the logbook words it'),
          domain: z.string().describe('The domain of the entity'),
          state: z.string().optional().describe('The state it changed to'),
        }),
      )
      .describe('What happened to the entity in the time range, oldest first'),
  }),
  execute: async (inputData) => {
    const endTime = inputData.endTime || new Date().toISOString();
    const startTime = inputData.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const endpoint = `logbook/${startTime}?entity=${inputData.entityId}&end_time=${endTime}`;
    const entries = (await callHomeAssistantApi(endpoint)) as LogbookEntry[];

    return {
      entityId: inputData.entityId,
      entries: entries.map((entry) => ({
        when: entry.when,
        name: entry.name,
        message: entry.message,
        domain: entry.domain,
        state: entry.state,
      })),
    };
  },
});

const logbookResultSchema = z.object({
  entityId: z.string(),
  entries: z.array(z.object({ name: z.string() })),
});

// Reading an entity's history is working on that entity, and the entries carry its name.
markAsAffectingEntities(getEntityLogbook, (_toolArguments, toolResult) => {
  const { entityId, entries } = logbookResultSchema.parse(toolResult);
  return [{ id: entityId, name: entries.find((entry) => entry.name.length > 0)?.name }];
});

// Tool to get all devices (entities/states)
export const getAllDevices = createTool({
  id: 'getAllDevices',
  description:
    'Get all devices and their entities from the IoT system. Returns devices grouped with their entities, including state, attributes, area, and labels. Use this to discover available devices and get comprehensive device information.',
  inputSchema: z.object({
    domain: z
      .string()
      .optional()
      .describe(
        'Optional domain filter to only get devices with entities from a specific domain (e.g., "light", "switch", "sensor", "climate")',
      ),
  }),
  outputSchema: z.object({
    devices: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        labels: z.array(z.string()),
        area: z.string().nullable(),
        last_changed: z.string(),
        entities: z.array(
          z.object({
            id: z.string(),
            domain: z.string(),
            area: z.string().nullable(),
            labels: z.array(z.string()),
            state: z.string(),
            attributes: z.record(z.string(), z.unknown()),
            last_changed: z.string(),
          }),
        ),
      }),
    ),
  }),
  execute: async (inputData) => {
    const domain = inputData.domain ? normalizeDomain(inputData.domain) : undefined;
    const snapshot = getHomeSnapshot();
    if (snapshot) {
      return { devices: describeDevicesInSnapshot(snapshot, { domain }) };
    }

    const deviceIds = await fetchDeviceIds(domain);
    const devices = await fetchDevicesInBatches(deviceIds, domain);

    return { devices };
  },
});

/**
 * Fragment of the error Home Assistant returns when a template renders more
 * output than it allows (256 KB at the time of writing). Matched so an
 * oversized batch can be split and retried rather than failing the whole call.
 */
const HA_TEMPLATE_OUTPUT_LIMIT_MESSAGE = 'exceeded maximum size';

/**
 * Devices requested per template render. Chosen well below the point where a
 * typical batch approaches Home Assistant's output cap; batches that still
 * overflow are split automatically.
 */
const DEVICE_BATCH_SIZE = 25;

/**
 * Renders the given devices, exactly as `getAllDevices` would, without looking up the rest of the
 * house.
 *
 * For callers that already know which devices they want -- presence remembers the car and the
 * phone once it has found them -- and would otherwise pay for rendering every device to read two.
 * Devices Home Assistant no longer knows, or that have no entity left, are absent from the result.
 */
export async function renderDevicesById(deviceIds: string[]): Promise<DeviceState[]> {
  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return describeDevicesInSnapshot(snapshot, { deviceIds });
  }
  return await fetchDevicesInBatches(deviceIds);
}

/**
 * How many batch renders are in flight at once.
 *
 * Home Assistant renders templates on its own event loop, so this does not make the rendering
 * itself parallel -- what it removes is a network round trip per batch spent waiting for the
 * previous one. Kept small so a large installation cannot queue dozens of heavy renders at once.
 */
const RENDER_CONCURRENCY = 4;

/**
 * How long a list of device IDs is reused.
 *
 * Devices are added and removed rarely, while the list is fetched on every `getAllDevices` call
 * -- and every presence and commute lookup goes through that tool. Only the IDs are reused;
 * states and attributes are always rendered fresh.
 */
const DEVICE_ID_CACHE_TTL_MS = 60_000;

/** Keyed by domain, with the empty key for every device. There are a few dozen domains at most. */
const deviceIdsByDomain = createTtlCache<string[]>({ ttlMs: DEVICE_ID_CACHE_TTL_MS, maxEntries: 50 });

/**
 * Fetches just the device IDs, which is cheap enough to always fit in one render.
 *
 * With a domain, only devices that have an entity in it: the device template drops every other
 * device anyway, so rendering them was pure cost -- a request about lights used to render every
 * sensor, plug and phone in the house first.
 */
async function fetchDeviceIds(domain?: string): Promise<string[]> {
  return await deviceIdsByDomain.get(domain ?? '', async () => {
    const source = domain ? `states.${domain}` : 'states';
    return await renderStringList(
      `{{ ${source}|map(attribute='entity_id')|map('device_id')|unique|reject('eq',None)|list|to_json }}`,
    );
  });
}

/** Renders a template that emits a JSON list of strings. */
async function renderStringList(template: string): Promise<string[]> {
  const response = await callHomeAssistantApi('template', 'POST', { template });
  const ids: unknown = typeof response === 'string' ? JSON.parse(response) : response;

  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

/**
 * Fetches full device payloads in batches, halving any batch that still exceeds
 * Home Assistant's template output limit.
 *
 * Home Assistant caps template output at 256 KB, so rendering every device with
 * all of its entity attributes in a single template fails outright once an
 * installation grows past that — and it fails for the whole call, not just the
 * excess. Batching keeps each render small and makes the tool scale with the
 * number of devices.
 */
async function fetchDevicesInBatches(deviceIds: string[], domain?: string): Promise<DeviceState[]> {
  return await renderInBatches(deviceIds, DEVICE_BATCH_SIZE, async (batch) => {
    const response = await callHomeAssistantApi('template', 'POST', {
      template: buildDeviceTemplate(batch, domain),
    });
    const parsed: unknown = typeof response === 'string' ? JSON.parse(response) : response;

    // The template emits exactly the DeviceState shape, and the tool's
    // outputSchema validates the assembled result before it reaches a caller.
    return Array.isArray(parsed) ? (parsed as DeviceState[]) : [];
  });
}

/**
 * Splits `items` into batches of `batchSize` and concatenates what `render`
 * returns for each, halving any batch that `render` rejects because Home
 * Assistant's template output limit was exceeded.
 *
 * Up to `concurrency` batches are rendered at a time, and the results keep the
 * order of `items` whatever order the renders finish in.
 *
 * Exported for testing: the halving behaviour only shows up against an
 * installation large enough to overflow, which no test can rely on.
 *
 * @param items - Items to render, in order
 * @param batchSize - Items per render attempt
 * @param render - Renders one batch; may reject with an output-limit error
 * @param concurrency - How many batches may be rendering at once
 * @throws Whatever `render` throws, if it is not an output-limit error or if a
 * single item still overflows on its own
 */
export async function renderInBatches<TItem, TResult>(
  items: TItem[],
  batchSize: number,
  render: (batch: TItem[]) => Promise<TResult[]>,
  concurrency: number = RENDER_CONCURRENCY,
): Promise<TResult[]> {
  const results: TResult[] = [];

  for (const wave of chunk(chunk(items, batchSize), concurrency)) {
    const rendered = await Promise.all(wave.map((batch) => renderBatch(batch, render)));
    for (const batchResults of rendered) {
      results.push(...batchResults);
    }
  }

  return results;
}

async function renderBatch<TItem, TResult>(
  batch: TItem[],
  render: (batch: TItem[]) => Promise<TResult[]>,
): Promise<TResult[]> {
  if (batch.length === 0) {
    return [];
  }

  try {
    return await render(batch);
  } catch (error) {
    const overflowed = error instanceof Error && error.message.includes(HA_TEMPLATE_OUTPUT_LIMIT_MESSAGE);

    // A single item that cannot be rendered on its own is not something
    // splitting can solve — surface it rather than looping forever.
    if (!overflowed || batch.length === 1) {
      throw error;
    }

    const middle = Math.ceil(batch.length / 2);

    return [
      ...(await renderBatch(batch.slice(0, middle), render)),
      ...(await renderBatch(batch.slice(middle), render)),
    ];
  }
}

/** @param domain - Already passed through {@link normalizeDomain}, since it is written into the template */
function buildDeviceTemplate(deviceIds: string[], domain?: string): string {
  const domainFilter = domain ? `and st.domain == '${domain}'` : '';

  return `
{%- set MAX_STR = 160 -%}
{%- set MAX_LIST = 20 -%}
{%- set devices = ${JSON.stringify(deviceIds)} -%}
{%- set ns = namespace(devices=[]) -%}
{%- for d in devices -%}
  {%- set ents = device_entities(d)|list -%}
  {%- if ents -%}
    {%- set latest = namespace(dt=none) -%}
    {%- set ea = namespace(items=[]) -%}
    {%- for e in ents -%}
      {%- set st = states[e] -%}
      {%- if st ${domainFilter} -%}
        {%- set lc = st.last_changed -%}
        {%- if latest.dt is none or lc > latest.dt -%}
          {%- set latest.dt = lc -%}
        {%- endif -%}
        {%- set ad = namespace(obj={}) -%}
        {%- for k in st.attributes|list -%}
          {%- set v = state_attr(e,k) -%}
          {%- if v is datetime -%}
            {%- set v = v.isoformat() -%}
          {%- elif v is set -%}
            {%- set v = v|list -%}
          {%- elif v is sequence and v is not string -%}
            {%- set v = (v|list)[:MAX_LIST] -%}
            {%- set tmp = [] -%}
            {%- for it in v -%}
              {%- set it = it.isoformat() if (it is datetime) else (it|list if (it is set) else (it|string if (it is not number and it is not boolean and it is not string and it is not none and (it is not sequence or it is string)) else it)) -%}
              {%- if it is string and it|length > MAX_STR -%}
                {%- set it = it[:MAX_STR] ~ '…' -%}
              {%- endif -%}
              {%- set tmp = tmp + [it] -%}
            {%- endfor -%}
            {%- set v = tmp -%}
          {%- elif v is mapping -%}
            {%- set v = v|string -%}
          {%- elif v is not number and v is not boolean and v is not string and v is not none -%}
            {%- set v = v|string -%}
          {%- endif -%}
          {%- if v is string and v|length > MAX_STR -%}
            {%- set v = v[:MAX_STR] ~ '…' -%}
          {%- endif -%}
          {%- set ad.obj = ad.obj|combine({k:v}) -%}
        {%- endfor -%}
        {%- set state_val = st.state -%}
        {%- if state_val is string and state_val|length > MAX_STR -%}
          {%- set state_val = state_val[:MAX_STR] ~ '…' -%}
        {%- endif -%}
        {%- set ea.items = ea.items + [{"id":e,"domain":st.domain,"area":area_name(e),"labels":labels(e)|list,"state":state_val,"attributes":ad.obj,"last_changed":lc.isoformat()}] -%}
      {%- endif -%}
    {%- endfor -%}
    {%- if ea.items|length > 0 -%}
      {%- set ns.devices = ns.devices + [{"id":d,"name":device_name(d),"labels":labels(d)|list,"area":area_name(d),"last_changed":(latest.dt if latest.dt else now()).isoformat(),"entities":ea.items}] -%}
    {%- endif -%}
  {%- endif -%}
{%- endfor -%}
{{ ns.devices | to_json }}
    `
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

// Tool to get all available services
export const getAllServices = createTool({
  id: 'getAllServices',
  description:
    'Get all available services in the IoT system grouped by domain. Use this to discover what actions you can perform on devices. Services define the operations available for each domain (e.g., turn_on, turn_off for lights; set_temperature for climate).',
  inputSchema: z.object({
    domain: z
      .string()
      .optional()
      .describe(
        'Optional domain filter to only get services from a specific domain (e.g., "light", "switch", "climate")',
      ),
  }),
  outputSchema: z.object({
    services_by_domain: z.record(
      z.string(),
      z.record(
        z.string(),
        z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          fields: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    ),
  }),
  execute: async (inputData) => {
    const response: ServicesApiResponse[] = await callHomeAssistantApi('services');

    const excludedDomains = ['update', 'hassio', 'frontend', 'logger', 'system_log'];
    const filteredServices: ServicesByDomain = {};

    for (const item of response) {
      if (
        item.domain &&
        item.services &&
        !excludedDomains.includes(item.domain) &&
        (!inputData.domain || item.domain === inputData.domain)
      ) {
        filteredServices[item.domain] = item.services;
      }
    }

    return {
      services_by_domain: filteredServices,
    };
  },
});

/** One entity as `findEntities` lists it: enough to target it, and nothing else. */
export interface EntitySummary {
  id: string;
  name: string;
  area: string | null;
  state: string;
  /** What the state is measured in, for a sensor: "°C", "%", "kWh". */
  unit?: string | null;
}

/**
 * Entities per template render in `findEntities`. Each one renders to well under a hundred
 * characters, so this stays far below Home Assistant's output cap.
 */
const ENTITY_SUMMARY_BATCH_SIZE = 250;

/**
 * The most entities a `findEntities` lookup can match and still count as the things a request is
 * working on.
 *
 * "What lights are on in the kitchen" matches a handful, and those are what the answer is about.
 * A lookup that matched more was a survey to choose from -- every light in the house -- and the
 * entities then acted on are reported by the service call that acts on them.
 */
export const MOST_ENTITIES_A_LOOKUP_AFFECTS = 10;

/**
 * What a look at the house's entities touched: the ones it found, unless it matched more than
 * {@link MOST_ENTITIES_A_LOOKUP_AFFECTS}, which makes it a survey that touched nothing.
 *
 * Shared by `findEntities` and a question about the house answered without the agent (see
 * `home-commands.ts`), so the same question lights up the same things whichever way it is answered.
 */
export function entitiesALookupAffects(
  found: { id: string; name: string }[],
  totalMatches = found.length,
): AffectedEntity[] {
  return totalMatches > MOST_ENTITIES_A_LOOKUP_AFFECTS ? [] : found.map(({ id, name }) => ({ id, name }));
}

/**
 * The most entities `findEntities` hands back.
 *
 * Every entity listed is input the agent's next step has to read, and that is the step the
 * action waits on. A list longer than this means the search was too broad to act on anyway.
 */
const MAX_ENTITIES_FOUND = 150;

function buildEntitySummaryTemplate(entityIds: string[]): string {
  return `
{%- set ns = namespace(items=[]) -%}
{%- for e in ${JSON.stringify(entityIds)} -%}
  {%- set st = states[e] -%}
  {%- if st -%}
    {%- set ns.items = ns.items + [{"id":e,"name":st.name|string,"area":area_name(e),"state":st.state|string,"unit":st.attributes.get('unit_of_measurement')}] -%}
  {%- endif -%}
{%- endfor -%}
{{ ns.items | to_json }}
    `
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
}

/**
 * Narrows entities to those in an area and matching a search, both case-insensitive substrings.
 *
 * Substrings rather than exact matches because the words arrive from speech: "living room" has
 * to find the area named "Living Room", and "lamp" the entity "Sofa lamp".
 */
export function filterEntities(
  entities: EntitySummary[],
  { area, search }: { area?: string; search?: string },
): EntitySummary[] {
  const wantedArea = area?.trim().toLowerCase();
  const wantedText = search?.trim().toLowerCase();

  return entities.filter((entity) => {
    if (wantedArea && !entity.area?.toLowerCase().includes(wantedArea)) {
      return false;
    }
    if (wantedText && !`${entity.id} ${entity.name}`.toLowerCase().includes(wantedText)) {
      return false;
    }
    return true;
  });
}

const entitySummariesSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    area: z.string().nullable(),
    state: z.string(),
    // Only ever descriptive, so a unit in a shape this does not expect is read as none.
    unit: z.string().nullish().catch(undefined),
  }),
);

/**
 * Every entity in a domain, or in the house, with only its id, name, area and state.
 *
 * Shared by `findEntities` and the home commands carried out without the agent (see
 * `home-commands.ts`), which put the same list in front of a classifier.
 */
export async function listEntities(domain?: string): Promise<EntitySummary[]> {
  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return summarizeEntitiesInSnapshot(snapshot, domain);
  }

  const entityIds = await fetchEntityIds(domain);
  return await renderInBatches(entityIds, ENTITY_SUMMARY_BATCH_SIZE, async (batch) => {
    const response = await callHomeAssistantApi('template', 'POST', { template: buildEntitySummaryTemplate(batch) });
    const parsed: unknown = typeof response === 'string' ? JSON.parse(response) : response;
    return entitySummariesSchema.parse(Array.isArray(parsed) ? parsed : []);
  });
}

// Tool to find entities by domain, area and name, without their attributes
export const findEntities = createTool({
  id: 'findEntities',
  description:
    'Find entities to control, by domain, area and name. Returns only each entity\'s id, name, area and current state, so it is much faster than getAllDevices. Use it to find the entity ids a service call should target. Always pass a domain when you know it (e.g. "light").',
  inputSchema: z.object({
    domain: z.string().optional().describe('Only entities in this domain, e.g. "light", "switch", "cover", "climate"'),
    area: z.string().optional().describe('Only entities in an area whose name contains this, e.g. "living room"'),
    search: z.string().optional().describe('Only entities whose id or name contains this, e.g. "lamp"'),
  }),
  outputSchema: z.object({
    entities: z
      .array(
        z.object({
          id: z.string().describe('The entity id a service call targets it by'),
          name: z.string().describe('What the entity is called'),
          area: z.string().nullable().describe('The name of the area it is in, if any'),
          state: z.string().describe('Its current state'),
        }),
      )
      .describe('The entities that matched'),
    totalMatches: z
      .number()
      .describe('How many entities matched, which is more than were returned if the list was cut short'),
  }),
  execute: async (inputData) => {
    const entities = await listEntities(inputData.domain ? normalizeDomain(inputData.domain) : undefined);
    const matches = filterEntities(entities, inputData);
    return { entities: matches.slice(0, MAX_ENTITIES_FOUND), totalMatches: matches.length };
  },
});

const foundEntitiesSchema = z.object({
  entities: z.array(z.object({ id: z.string(), name: z.string() })),
  totalMatches: z.number(),
});

markAsAffectingEntities(findEntities, (_toolArguments, toolResult) => {
  const { entities, totalMatches } = foundEntitiesSchema.parse(toolResult);
  return entitiesALookupAffects(entities, totalMatches);
});

const homeAreasSchema = z.array(z.object({ id: z.string(), name: z.string() }));

/** An area Home Assistant knows, as a service call targets it. */
export type HomeArea = z.infer<typeof homeAreasSchema>[number];

/**
 * How long the list of areas is reused before it is refreshed.
 *
 * Areas change about as often as furniture moves. The list is put in front of the IoT agent on
 * every request, so it is served from here and refreshed in the background once stale.
 */
const AREA_CACHE_TTL_MS = 10 * 60_000;

/**
 * The longest a request waits for the areas when none have been fetched yet.
 *
 * The list saves the agent a lookup, so waiting long for it would defeat the purpose -- past
 * this the agent is given its instructions without it and finds what it needs with a tool.
 */
const AREA_LOOKUP_TIMEOUT_MS = 2_000;

/** How long a failed lookup is left alone before trying again, so an outage is not paid per request. */
const AREA_RETRY_AFTER_MS = 60_000;

let cachedAreas: { areas: HomeArea[]; fetchedAt: number } | undefined;
let areaLookupFailedAt: number | undefined;
let areaRefresh: Promise<HomeArea[]> | undefined;

/** Forgets the cached device IDs and areas, for tests. */
export function resetHomeAssistantCachesForTest(): void {
  deviceIdsByDomain.clear();
  cachedAreas = undefined;
  areaLookupFailedAt = undefined;
  areaRefresh = undefined;
}

async function fetchAreas(): Promise<HomeArea[]> {
  const template =
    '{%- set ns = namespace(items=[]) -%}' +
    '{%- for a in areas() -%}{%- set ns.items = ns.items + [{"id":a,"name":area_name(a)}] -%}{%- endfor -%}' +
    '{{ ns.items | to_json }}';
  const response = await callHomeAssistantApi('template', 'POST', { template });
  const parsed: unknown = typeof response === 'string' ? JSON.parse(response) : response;

  return homeAreasSchema.parse(parsed);
}

/** Fetches the areas into the cache, sharing one lookup between concurrent callers. Never rejects. */
function refreshAreas(): Promise<HomeArea[]> {
  areaRefresh ??= fetchAreas()
    .then((areas) => {
      cachedAreas = { areas, fetchedAt: Date.now() };
      areaLookupFailedAt = undefined;
      return areas;
    })
    .catch((error: unknown) => {
      areaLookupFailedAt = Date.now();
      logger.warn('Could not list the Home Assistant areas', {
        error: error instanceof Error ? error.message : String(error),
      });
      return cachedAreas?.areas ?? [];
    })
    .finally(() => {
      areaRefresh = undefined;
    });

  return areaRefresh;
}

/**
 * The areas a service call can target, or an empty list when they cannot be had quickly.
 *
 * Served from the cache whenever there is one, stale or not -- a stale list is refreshed in the
 * background rather than waited for -- so only the very first request after boot waits on Home
 * Assistant, and then for {@link AREA_LOOKUP_TIMEOUT_MS} at most.
 */
export async function getHomeAreas(): Promise<HomeArea[]> {
  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return areasInSnapshot(snapshot);
  }

  const now = Date.now();

  if (cachedAreas) {
    if (now - cachedAreas.fetchedAt >= AREA_CACHE_TTL_MS) {
      void refreshAreas();
    }
    return cachedAreas.areas;
  }

  if (areaLookupFailedAt !== undefined && now - areaLookupFailedAt < AREA_RETRY_AFTER_MS) {
    return [];
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<HomeArea[]>((resolve) => {
    timer = setTimeout(() => resolve([]), AREA_LOOKUP_TIMEOUT_MS);
  });

  try {
    return await Promise.race([refreshAreas(), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

// Tool to get devices that have changed since a specific time
export const getChangedDevicesSince = createTool({
  id: 'getChangedDevicesSince',
  description:
    'Get all devices (entities) that have changed state since a specific number of seconds ago. Useful for monitoring recent activity or detecting what has changed in the home. This tool tracks state changes over time.',
  inputSchema: z.object({
    sinceSeconds: z
      .number()
      .describe(
        'Number of seconds to look back (e.g., 60 for last minute, 3600 for last hour). Only devices changed within this time window will be returned.',
      ),
    domain: z
      .string()
      .optional()
      .describe(
        'Optional domain filter to only check devices from a specific domain (e.g., "light", "switch", "sensor")',
      ),
  }),
  outputSchema: z.object({
    changed_devices: z.array(
      z.object({
        device_id: z.string(),
        device_name: z.string(),
        device_label_ids: z.array(z.string()),
        entity_id: z.string(),
        entity_label_ids: z.array(z.string()),
        state: z.string(),
        last_changed: z.number(),
      }),
    ),
    since_seconds: z.number(),
    total_changed: z.number(),
  }),
  execute: async (inputData) => {
    const domain = inputData.domain ? normalizeDomain(inputData.domain) : undefined;
    const snapshot = getHomeSnapshot();
    if (snapshot) {
      const changedDevices = changedSinceInSnapshot(snapshot, inputData.sinceSeconds, domain);
      return {
        changed_devices: changedDevices,
        since_seconds: inputData.sinceSeconds,
        total_changed: changedDevices.length,
      };
    }

    const domainFilter = domain ? `and s.domain == '${domain}'` : '';

    const template = `
{%- set nowts = as_timestamp(now()) -%}
[
{%- for s in states if (nowts - as_timestamp(s.last_changed)) <= ${inputData.sinceSeconds} ${domainFilter} -%}
  {%- set did = device_id(s.entity_id) -%}
  {"device_id":"{{ did }}","device_name":{{ (device_name(s.entity_id) or '')|to_json }},"device_label_ids":{{ labels(did)|list|to_json }},"entity_id":"{{ s.entity_id }}","entity_label_ids":{{ labels(s.entity_id)|list|to_json }},"state":{{ s.state|to_json }},"last_changed":{{ as_timestamp(s.last_changed)|int }}}
  {%- if not loop.last -%},{%- endif -%}
{%- endfor -%}
]
    `
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    const response = await callHomeAssistantApi('template', 'POST', { template });
    const changedDevices: ChangedDeviceState[] = typeof response === 'string' ? JSON.parse(response) : response;

    return {
      changed_devices: Array.isArray(changedDevices) ? changedDevices : [],
      since_seconds: inputData.sinceSeconds,
      total_changed: Array.isArray(changedDevices) ? changedDevices.length : 0,
    };
  },
});

// Interface for user location data
export interface UserLocation {
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

const renderedPersonSchema = z.object({
  entity_id: z.string(),
  state: z.string(),
  friendly_name: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  gps_accuracy: z.number().nullable(),
  source: z.string(),
  last_changed: z.string(),
});

const renderedZoneSchema = z.object({
  entity_id: z.string(),
  friendly_name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  radius: z.number(),
});

const renderedPeopleAndZonesSchema = z.object({
  persons: z.array(renderedPersonSchema),
  zones: z.array(renderedZoneSchema),
});

/**
 * A person as the presence template renders it: Home Assistant's own snake_case, straight out of
 * the JSON.
 */
export type RenderedPerson = z.infer<typeof renderedPersonSchema>;

/** A zone as the presence template renders it, in the same snake_case. */
export type RenderedZone = z.infer<typeof renderedZoneSchema>;

// Interface for zone data
interface ZoneData {
  entityId: string;
  friendlyName: string;
  latitude: number;
  longitude: number;
  radius: number;
}

/**
 * Converts rendered zones into the camelCase shape the rest of the tool — and its output schema —
 * is written against.
 *
 * Without this step `zone.friendlyName` reads `undefined` off a payload that spells it
 * `friendly_name`, and comparing a person's state against it throws for any house that has zones
 * at all. Exported so the naming boundary between Home Assistant's JSON and this codebase stays
 * covered by a test.
 */
export function toZoneData(rendered: RenderedZone[]): ZoneData[] {
  return rendered.map((zone) => ({
    entityId: zone.entity_id,
    friendlyName: zone.friendly_name,
    latitude: zone.latitude,
    longitude: zone.longitude,
    radius: zone.radius,
  }));
}

/** Every person and zone, from the cached copy of the house when there is one. */
async function fetchPeopleAndZones(): Promise<{ persons: RenderedPerson[]; zones: RenderedZone[] }> {
  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return peopleAndZonesInSnapshot(snapshot);
  }

  const template = `
{%- set persons = states.person | list -%}
{%- set zones_list = states.zone | list -%}
{
  "persons": [
    {%- for p in persons -%}
    {
      "entity_id": "{{ p.entity_id }}",
      "state": "{{ p.state }}",
      "friendly_name": "{{ p.attributes.friendly_name | default(p.entity_id) }}",
      "latitude": {{ p.attributes.latitude | default('null') }},
      "longitude": {{ p.attributes.longitude | default('null') }},
      "gps_accuracy": {{ p.attributes.gps_accuracy | default('null') }},
      "source": "{{ p.attributes.source | default('') }}",
      "last_changed": "{{ p.last_changed.isoformat() }}"
    }{%- if not loop.last -%},{%- endif -%}
    {%- endfor -%}
  ],
  "zones": [
    {%- for z in zones_list -%}
    {
      "entity_id": "{{ z.entity_id }}",
      "friendly_name": "{{ z.attributes.friendly_name | default(z.entity_id) }}",
      "latitude": {{ z.attributes.latitude | default(0) }},
      "longitude": {{ z.attributes.longitude | default(0) }},
      "radius": {{ z.attributes.radius | default(100) }}
    }{%- if not loop.last -%},{%- endif -%}
    {%- endfor -%}
  ]
}
    `
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  const response = await callHomeAssistantApi('template', 'POST', { template });
  return renderedPeopleAndZonesSchema.parse(typeof response === 'string' ? JSON.parse(response) : response);
}

/**
 * Tool to infer user locations from Home Assistant.
 *
 * This tool fetches the current locations of all users from Home Assistant by looking at
 * person entities (which aggregate device trackers) and calculating their distances from
 * all configured zones on the map.
 */
export const inferUserLocation = createTool({
  id: 'inferUserLocation',
  description:
    'Fetch current user locations from Home Assistant. Returns all person entities with their GPS coordinates (if available), current zone/state, and distances from all configured zones. Use this to determine if users are home, at work, or elsewhere for location-based automations and notifications.',
  inputSchema: z.object({
    userName: z
      .string()
      .optional()
      .describe('Optional: Filter to a specific user name. If not provided, returns all users.'),
  }),
  outputSchema: z.object({
    users: z.array(
      z.object({
        userId: z.string(),
        userName: z.string(),
        state: z.string(),
        latitude: z.number().nullable(),
        longitude: z.number().nullable(),
        gpsAccuracy: z.number().nullable(),
        lastChanged: z.string(),
        source: z.string(),
        distancesFromZones: z.array(
          z.object({
            zoneName: z.string(),
            zoneId: z.string(),
            distanceMeters: z.number().nullable(),
            isInZone: z.boolean(),
          }),
        ),
      }),
    ),
    zones: z.array(
      z.object({
        entityId: z.string(),
        friendlyName: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        radius: z.number(),
      }),
    ),
    timestamp: z.string(),
  }),
  execute: async (inputData) => {
    const { persons, zones: renderedZones } = await fetchPeopleAndZones();
    const zones = toZoneData(renderedZones);

    // Calculate distances from each person to each zone
    const users: UserLocation[] = persons
      .filter((person) => {
        if (!inputData.userName) return true;
        return person.friendly_name.toLowerCase().includes(inputData.userName.toLowerCase());
      })
      .map((person) => {
        const distancesFromZones = zones.map((zone) => {
          let distanceMeters: number | null = null;
          let isInZone = false;

          if (person.latitude !== null && person.longitude !== null) {
            distanceMeters = getDistance(
              { latitude: person.latitude, longitude: person.longitude },
              { latitude: zone.latitude, longitude: zone.longitude },
            );

            isInZone = distanceMeters <= zone.radius;
          }

          // Also check if the person's state matches the zone name
          if (person.state.toLowerCase() === zone.friendlyName.toLowerCase()) {
            isInZone = true;
          }

          return {
            zoneName: zone.friendlyName,
            zoneId: zone.entityId,
            distanceMeters,
            isInZone,
          };
        });

        return {
          userId: person.entity_id,
          userName: person.friendly_name,
          state: person.state,
          latitude: person.latitude,
          longitude: person.longitude,
          gpsAccuracy: person.gps_accuracy,
          lastChanged: person.last_changed,
          source: person.source,
          distancesFromZones,
        };
      });

    return {
      users,
      zones: zones.map((z) => ({
        entityId: z.entityId,
        friendlyName: z.friendlyName,
        latitude: z.latitude,
        longitude: z.longitude,
        radius: z.radius,
      })),
      timestamp: new Date().toISOString(),
    };
  },
});

// Interface for historical state entry
export interface HistoricalStateEntry {
  entity_id: string;
  state: string;
  last_changed: string;
  last_updated: string;
  attributes: Record<string, unknown>;
}

// Interface for historical states result
export interface HistoricalStatesResult {
  history: Record<string, HistoricalStateEntry[]>;
  startTime: string;
  endTime: string;
  entityCount: number;
}

// Interface for historical states options
export interface HistoricalStatesOptions {
  startTime?: string;
  endTime?: string;
  entityIds?: string[];
  minimalResponse?: boolean;
}

/**
 * Longest `filter_entity_id` value a single history request may carry, measured
 * after URL encoding.
 *
 * Home Assistant takes the filter in the query string, and aiohttp rejects a
 * request line longer than 8 KB outright. Staying well under that leaves room
 * for the base URL, the timestamps and the remaining parameters.
 */
const MAX_HISTORY_FILTER_LENGTH = 3500;

/**
 * Splits entity IDs into batches whose encoded `filter_entity_id` value stays
 * within `maxLength`.
 *
 * An installation with a few hundred entities produces a filter far longer than
 * a request line allows, so asking for every entity at once fails on the
 * transport before Home Assistant ever looks at the query. An ID that exceeds
 * the limit on its own still gets a batch of its own — dropping it silently
 * would hide the entity from every baseline it belongs to.
 *
 * Exported for testing: the batching only kicks in against an installation
 * large enough to overflow, which no test can rely on.
 *
 * @param entityIds - Entity IDs to split, in order
 * @param maxLength - Maximum encoded filter length per batch
 * @returns Batches of entity IDs, in order, with no empty batch
 */
export function batchEntityIdsForHistory(entityIds: string[], maxLength = MAX_HISTORY_FILTER_LENGTH): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const entityId of entityIds) {
    // URLSearchParams percent-encodes the separating comma, so every ID after
    // the first costs its own encoded length plus three characters for "%2C".
    const encodedLength = encodeURIComponent(entityId).length;
    const cost = current.length === 0 ? encodedLength : encodedLength + 3;

    if (current.length > 0 && currentLength + cost > maxLength) {
      batches.push(current);
      current = [entityId];
      currentLength = encodedLength;
      continue;
    }

    current.push(entityId);
    currentLength += cost;
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/**
 * Fetches the entity IDs known to Home Assistant -- every one, or those in one domain -- which
 * is cheap enough for one render.
 *
 * @param domain - Already passed through {@link normalizeDomain}, since it is written into the template
 */
/** Every domain the house has an entity in: "light", "lock", "sensor", ... */
export async function listDomains(): Promise<string[]> {
  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return domainsInSnapshot(snapshot);
  }
  return await renderStringList("{{ states | map(attribute='domain') | unique | list | to_json }}");
}

async function fetchEntityIds(domain?: string): Promise<string[]> {
  const snapshot = getHomeSnapshot();
  if (snapshot) {
    return entityIdsInSnapshot(snapshot, domain);
  }

  const source = domain ? `states.${domain}` : 'states';
  return await renderStringList(`{{ ${source}|map(attribute='entity_id')|list|to_json }}`);
}

/** Requests the history of one batch of entities. */
async function fetchHistoryBatch(
  entityIds: string[],
  startTime: string,
  endTime: string,
  minimalResponse: boolean,
): Promise<Array<HistoricalStateEntry[]>> {
  const params = new URLSearchParams();
  params.append('end_time', endTime);
  if (minimalResponse) {
    params.append('minimal_response', '');
  }
  params.append('filter_entity_id', entityIds.join(','));

  const response = await callHomeAssistantApi(`history/period/${startTime}?${params.toString()}`);

  return Array.isArray(response) ? (response as Array<HistoricalStateEntry[]>) : [];
}

/**
 * Fetch historical state data for all entities from Home Assistant over a specified time period.
 * Returns the full state history with timestamps, useful for analyzing state fluctuations and patterns.
 * This function is used internally by workflows to establish noise baselines for filtering insignificant state changes.
 *
 * Home Assistant rejects a history query that leaves out `filter_entity_id` — it
 * answers `filter_entity_id is missing` with a 400 — so "every entity" has to be
 * spelled out as an explicit list. It is resolved here when the caller supplies
 * none, and split across as many requests as the query string needs.
 *
 * @param options - Configuration options for fetching historical states
 * @returns Historical state data keyed by entity ID
 */
export async function fetchHistoricalStates(options: HistoricalStatesOptions = {}): Promise<HistoricalStatesResult> {
  const endTime = options.endTime || new Date().toISOString();
  const startTime = options.startTime || new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const minimalResponse = options.minimalResponse ?? true;

  const entityIds = options.entityIds?.length ? options.entityIds : await fetchEntityIds();

  // Convert array responses to a record keyed by entity_id
  const history: Record<string, HistoricalStateEntry[]> = {};
  let entityCount = 0;

  for (const batch of batchEntityIdsForHistory(entityIds)) {
    const response = await fetchHistoryBatch(batch, startTime, endTime, minimalResponse);

    for (const entityHistory of response) {
      if (Array.isArray(entityHistory) && entityHistory.length > 0) {
        const entityId = entityHistory[0].entity_id;
        history[entityId] = entityHistory;
        entityCount++;
      }
    }
  }

  return {
    history,
    startTime,
    endTime,
    entityCount,
  };
}

// Export all tools together for convenience
export const internetOfThingsTools = {
  callIoTService,
  findEntities,
  getEntityLogbook,
  getAllDevices,
  getAllServices,
  getChangedDevicesSince,
  inferUserLocation,
};
