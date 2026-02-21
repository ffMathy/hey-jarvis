import { getDistance } from 'geolib';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

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
interface ChangedDeviceState {
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

// Get Home Assistant configuration from environment
const getHomeAssistantConfig = () => {
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

// Helper function to make Home Assistant API calls
async function callHomeAssistantApi(endpoint: string, method = 'GET', body?: unknown) {
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
    throw new Error(`Home Assistant API error: ${response.statusText}`);
  }

  return response.json();
}

// Tool to call an IoT service
export const callIoTService = createTool({
  id: 'callIoTService',
  description:
    'Call an IoT service to control devices or trigger actions. Use this to turn devices on/off, adjust settings, or perform any IoT service action.',
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
        'A parameter object containing the service data. Typically includes "entity_id" and service-specific parameters like "brightness_pct", "temperature", "rgb_color", etc.',
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    domain: z.string(),
    service: z.string(),
    data: z.record(z.string(), z.unknown()),
    message: z.string(),
  }),
  execute: async (inputData) => {
    try {
      const endpoint = `services/${inputData.domain}/${inputData.serviceId}`;
      await callHomeAssistantApi(endpoint, 'POST', inputData.data);

      return {
        success: true,
        domain: inputData.domain,
        service: inputData.serviceId,
        data: inputData.data,
        message: `Successfully called ${inputData.domain}.${inputData.serviceId}`,
      };
    } catch (error) {
      return {
        success: false,
        domain: inputData.domain,
        service: inputData.serviceId,
        data: inputData.data,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
});

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
    entityId: z.string(),
    entries: z.array(
      z.object({
        when: z.string(),
        name: z.string(),
        message: z.string().optional(),
        domain: z.string(),
        state: z.string().optional(),
      }),
    ),
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
    const domainFilter = inputData.domain ? `and st.domain == '${inputData.domain}'` : '';

    const template = `
{%- set MAX_STR = 160 -%}
{%- set MAX_LIST = 20 -%}
{%- set devices = states|map(attribute='entity_id')|map('device_id')|unique|reject('eq',None)|list -%}
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

    const response = await callHomeAssistantApi('template', 'POST', { template });
    const devices: DeviceState[] = typeof response === 'string' ? JSON.parse(response) : response;

    return {
      devices: Array.isArray(devices) ? devices : [],
    };
  },
});

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
    const domainFilter = inputData.domain ? `and s.domain == '${inputData.domain}'` : '';

    const template = `
{%- set nowts = as_timestamp(now()) -%}
[
{%- for s in states if (nowts - as_timestamp(s.last_changed)) <= ${inputData.sinceSeconds} ${domainFilter} -%}
  {%- set did = device_id(s.entity_id) -%}
  {"device_id":"{{ did }}","device_name":"{{ device_name(s.entity_id) }}","device_label_ids":{{ labels(did)|list|to_json }},"entity_id":"{{ s.entity_id }}","entity_label_ids":{{ labels(s.entity_id)|list|to_json }},"state":"{{ s.state }}","last_changed":{{ as_timestamp(s.last_changed)|int }}}
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

// Interface for zone data
interface ZoneData {
  entityId: string;
  friendlyName: string;
  latitude: number;
  longitude: number;
  radius: number;
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
    // Fetch all person entities and zones using a Jinja template
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
    const data = typeof response === 'string' ? JSON.parse(response) : response;

    const persons = data.persons || [];
    const zones: ZoneData[] = data.zones || [];

    // Calculate distances from each person to each zone
    const users: UserLocation[] = persons
      .filter((person: { friendly_name: string }) => {
        if (!inputData.userName) return true;
        return person.friendly_name.toLowerCase().includes(inputData.userName.toLowerCase());
      })
      .map(
        (person: {
          entity_id: string;
          friendly_name: string;
          state: string;
          latitude: number | null;
          longitude: number | null;
          gps_accuracy: number | null;
          source: string;
          last_changed: string;
        }) => {
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
        },
      );

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
 * Fetch historical state data for all entities from Home Assistant over a specified time period.
 * Returns the full state history with timestamps, useful for analyzing state fluctuations and patterns.
 * This function is used internally by workflows to establish noise baselines for filtering insignificant state changes.
 *
 * @param options - Configuration options for fetching historical states
 * @returns Historical state data keyed by entity ID
 */
export async function fetchHistoricalStates(options: HistoricalStatesOptions = {}): Promise<HistoricalStatesResult> {
  const endTime = options.endTime || new Date().toISOString();
  const startTime = options.startTime || new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const minimalResponse = options.minimalResponse ?? true;

  // Build the endpoint URL
  let endpoint = `history/period/${startTime}`;

  // Add query parameters
  const params = new URLSearchParams();
  params.append('end_time', endTime);
  if (minimalResponse) {
    params.append('minimal_response', '');
  }
  if (options.entityIds && options.entityIds.length > 0) {
    params.append('filter_entity_id', options.entityIds.join(','));
  }

  endpoint += `?${params.toString()}`;

  const response = (await callHomeAssistantApi(endpoint)) as Array<HistoricalStateEntry[]>;

  // Convert array response to a record keyed by entity_id
  const history: Record<string, HistoricalStateEntry[]> = {};
  let entityCount = 0;

  for (const entityHistory of response) {
    if (Array.isArray(entityHistory) && entityHistory.length > 0) {
      const entityId = entityHistory[0].entity_id;
      history[entityId] = entityHistory;
      entityCount++;
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
  getEntityLogbook,
  getAllDevices,
  getAllServices,
  getChangedDevicesSince,
  inferUserLocation,
};
