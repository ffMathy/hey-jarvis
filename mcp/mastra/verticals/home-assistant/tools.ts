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
  fields?: Record<string, {
    description?: string;
    example?: unknown;
    required?: boolean;
    selector?: unknown;
  }>;
}

// Get Home Assistant configuration from environment
const getHomeAssistantConfig = () => {
  const url = process.env.HEY_JARVIS_HOME_ASSISTANT_URL;
  const token = process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN;
  
  if (!url || !token) {
    throw new Error('Home Assistant configuration not found. Please set HEY_JARVIS_HOME_ASSISTANT_URL and HEY_JARVIS_HOME_ASSISTANT_TOKEN environment variables.');
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
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    throw new Error(`Home Assistant API error: ${response.statusText}`);
  }
  
  return response.json();
}

// Tool to call a Home Assistant service
export const callHomeAssistantService = createTool({
  id: 'callHomeAssistantService',
  description: 'Call a Home Assistant service to control devices or trigger actions. Use this to turn devices on/off, adjust settings, or perform any Home Assistant service action.',
  inputSchema: z.object({
    domain: z.string().describe('The domain where the service is located (e.g., "light", "switch", "media_player", "climate", "scene")'),
    serviceId: z.string().describe('The ID of the service to be called (e.g., "turn_on", "turn_off", "toggle", "set_temperature")'),
    data: z.record(z.unknown()).describe('A parameter object containing the service data. Typically includes "entity_id" and service-specific parameters like "brightness_pct", "temperature", "rgb_color", etc.')
  }),
  outputSchema: z.object({
    success: z.boolean(),
    domain: z.string(),
    service: z.string(),
    data: z.record(z.unknown()),
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
  description: 'Fetches the logbook entries for a given entity and time range. Use this to see how an entity has changed state over time. Only use this when you need historical data - never use it for current values.',
  inputSchema: z.object({
    entityId: z.string().describe('The entity ID to fetch logbook entries for (e.g., "light.living_room", "switch.bedroom")'),
    startTime: z.string().optional().describe('ISO 8601 timestamp for the start of the time range (optional, defaults to 24 hours ago)'),
    endTime: z.string().optional().describe('ISO 8601 timestamp for the end of the time range (optional, defaults to now)'),
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
      })
    ),
  }),
  execute: async (inputData) => {
    const endTime = inputData.endTime || new Date().toISOString();
    const startTime = inputData.startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const endpoint = `logbook/${startTime}?entity=${inputData.entityId}&end_time=${endTime}`;
    const entries = await callHomeAssistantApi(endpoint) as LogbookEntry[];
    
    return {
      entityId: inputData.entityId,
      entries: entries.map(entry => ({
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
  description: 'Get the current state of all devices (entities) in Home Assistant. Use this to discover available devices and their current states. Returns comprehensive device information including state, attributes, and timing information.',
  inputSchema: z.object({
    domain: z.string().optional().describe('Optional domain filter to only get devices from a specific domain (e.g., "light", "switch", "sensor", "climate")'),
  }),
  outputSchema: z.object({
    devices: z.array(
      z.object({
        entity_id: z.string(),
        state: z.string(),
        attributes: z.record(z.unknown()),
        last_changed: z.string(),
        last_updated: z.string(),
        domain: z.string(),
      })
    ),
  }),
  execute: async (inputData) => {
    // Use Home Assistant template API to render device states
    // This matches the n8n "Get all devices" node which uses resource: "template"
    const template = `
{% set excluded_domains = ['update', 'hassio', 'frontend', 'logger', 'system_log'] %}
{% set ns = namespace(devices=[]) %}
{% for state in states %}
  {% if state.domain not in excluded_domains %}
    {% if not domain or state.domain == domain %}
      {% set device = {
        'entity_id': state.entity_id,
        'state': state.state,
        'attributes': state.attributes,
        'last_changed': state.last_changed.isoformat(),
        'last_updated': state.last_updated.isoformat(),
        'domain': state.domain
      } %}
      {% set ns.devices = ns.devices + [device] %}
    {% endif %}
  {% endif %}
{% endfor %}
{{ ns.devices }}
    `.trim();
    
    const templateWithDomain = inputData.domain 
      ? template.replace('{% set ns = namespace(devices=[]) %}', `{% set domain = '${inputData.domain}' %}\n{% set ns = namespace(devices=[]) %}`)
      : template.replace('not domain or ', '');
    
    const response = await callHomeAssistantApi('template', 'POST', { template: templateWithDomain });
    const devices = typeof response === 'string' ? JSON.parse(response) : response;
    
    return {
      devices: Array.isArray(devices) ? devices : [],
    };
  },
});

// Tool to get all available services
export const getAllServices = createTool({
  id: 'getAllServices',
  description: 'Get all available services in Home Assistant grouped by domain. Use this to discover what actions you can perform on devices. Services define the operations available for each domain (e.g., turn_on, turn_off for lights; set_temperature for climate).',
  inputSchema: z.object({
    domain: z.string().optional().describe('Optional domain filter to only get services from a specific domain (e.g., "light", "switch", "climate")'),
  }),
  outputSchema: z.object({
    services_by_domain: z.record(z.record(z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      fields: z.record(z.unknown()).optional(),
    }))),
  }),
  execute: async (inputData) => {
    const response = await callHomeAssistantApi('services') as Array<{ domain: string; services: Record<string, ServiceDefinition> }>;
    
    const excludedDomains = ['update', 'hassio', 'frontend', 'logger', 'system_log'];
    const filteredServices: Record<string, Record<string, ServiceDefinition>> = {};
    
    for (const item of response) {
      if (item.domain && item.services && !excludedDomains.includes(item.domain) && (!inputData.domain || item.domain === inputData.domain)) {
        filteredServices[item.domain] = item.services;
      }
    }
    
    return {
      services_by_domain: filteredServices as Record<string, Record<string, { name?: string; description?: string; fields?: Record<string, unknown> }>>,
    };
  },
});

// Tool to get devices that have changed since a specific time
export const getChangedDevicesSinceLastTime = createTool({
  id: 'getChangedDevicesSinceLastTime',
  description: 'Get all devices (entities) that have changed state since a specific timestamp. Useful for monitoring recent activity or detecting what has changed in the home. This tool tracks state changes over time.',
  inputSchema: z.object({
    sinceTimestamp: z.string().describe('ISO 8601 timestamp to check changes since (e.g., "2025-11-22T10:00:00Z"). Only devices changed after this time will be returned.'),
    domain: z.string().optional().describe('Optional domain filter to only check devices from a specific domain (e.g., "light", "switch", "sensor")'),
  }),
  outputSchema: z.object({
    changed_devices: z.array(
      z.object({
        entity_id: z.string(),
        state: z.string(),
        attributes: z.record(z.unknown()),
        last_changed: z.string(),
        last_updated: z.string(),
        domain: z.string(),
        changed_at: z.string(),
      })
    ),
    since_timestamp: z.string(),
    total_changed: z.number(),
  }),
  execute: async (inputData) => {
    // Use Home Assistant template API to filter changed devices
    // This matches the n8n "Get changed devices since last time" node which uses resource: "template"
    const template = `
{% set excluded_domains = ['update', 'hassio', 'frontend', 'logger', 'system_log'] %}
{% set since_time = as_datetime('${inputData.sinceTimestamp}') %}
{% set ns = namespace(devices=[]) %}
{% for state in states %}
  {% if state.domain not in excluded_domains %}
    {% if not domain or state.domain == domain %}
      {% if state.last_changed > since_time %}
        {% set device = {
          'entity_id': state.entity_id,
          'state': state.state,
          'attributes': state.attributes,
          'last_changed': state.last_changed.isoformat(),
          'last_updated': state.last_updated.isoformat(),
          'domain': state.domain,
          'changed_at': state.last_changed.isoformat()
        } %}
        {% set ns.devices = ns.devices + [device] %}
      {% endif %}
    {% endif %}
  {% endif %}
{% endfor %}
{{ ns.devices }}
    `.trim();
    
    const templateWithDomain = inputData.domain 
      ? template.replace('{% set ns = namespace(devices=[]) %}', `{% set domain = '${inputData.domain}' %}\n{% set ns = namespace(devices=[]) %}`)
      : template.replace('not domain or ', '');
    
    const response = await callHomeAssistantApi('template', 'POST', { template: templateWithDomain });
    const devices = typeof response === 'string' ? JSON.parse(response) : response;
    const changedDevices = Array.isArray(devices) ? devices : [];
    
    return {
      changed_devices: changedDevices,
      since_timestamp: inputData.sinceTimestamp,
      total_changed: changedDevices.length,
    };
  },
});

// Export all tools together for convenience
export const homeAssistantTools = {
  callHomeAssistantService,
  getEntityLogbook,
  getAllDevices,
  getAllServices,
  getChangedDevicesSinceLastTime,
};
