import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// Interface for Home Assistant service call response
interface HomeAssistantServiceResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

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

// Interface for Home Assistant device/entity state
interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

// Interface for Home Assistant service definition
interface ServiceDefinition {
  name: string;
  description: string;
  fields: Record<string, {
    description: string;
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

// Tool to get all states/entities
export const getHomeAssistantStates = createTool({
  id: 'getHomeAssistantStates',
  description: 'Get the current state of all entities in Home Assistant. Use this to discover available devices and their current states.',
  inputSchema: z.object({
    domain: z.string().optional().describe('Optional domain filter to only get entities from a specific domain (e.g., "light", "switch", "sensor")'),
  }),
  outputSchema: z.object({
    states: z.array(
      z.object({
        entity_id: z.string(),
        state: z.string(),
        attributes: z.record(z.unknown()),
        last_changed: z.string(),
        last_updated: z.string(),
      })
    ),
  }),
  execute: async (inputData) => {
    const allStates = await callHomeAssistantApi('states') as EntityState[];
    
    const filteredStates = inputData.domain
      ? allStates.filter(state => state.entity_id.startsWith(`${inputData.domain}.`))
      : allStates;
    
    // Filter out excluded domains
    const excludedDomains = ['update', 'hassio', 'frontend', 'logger', 'system_log'];
    const finalStates = filteredStates.filter(state => {
      const domain = state.entity_id.split('.')[0];
      return !excludedDomains.includes(domain);
    });
    
    return {
      states: finalStates.map(state => ({
        entity_id: state.entity_id,
        state: state.state,
        attributes: state.attributes,
        last_changed: state.last_changed,
        last_updated: state.last_updated,
      })),
    };
  },
});

// Tool to get available services
export const getHomeAssistantServices = createTool({
  id: 'getHomeAssistantServices',
  description: 'Get all available services in Home Assistant grouped by domain. Use this to discover what actions you can perform.',
  inputSchema: z.object({
    domain: z.string().optional().describe('Optional domain filter to only get services from a specific domain (e.g., "light", "switch")'),
  }),
  outputSchema: z.object({
    services: z.record(z.record(z.object({
      name: z.string().optional(),
      description: z.string(),
      fields: z.record(z.unknown()),
    }))),
  }),
  execute: async (inputData) => {
    const allServices = await callHomeAssistantApi('services') as Record<string, Record<string, ServiceDefinition>>;
    
    // Filter out excluded domains
    const excludedDomains = ['update', 'hassio', 'frontend', 'logger', 'system_log'];
    const filteredServices: Record<string, Record<string, ServiceDefinition>> = {};
    
    for (const [domain, services] of Object.entries(allServices)) {
      if (!excludedDomains.includes(domain) && (!inputData.domain || domain === inputData.domain)) {
        filteredServices[domain] = services;
      }
    }
    
    return {
      services: filteredServices as Record<string, Record<string, { name?: string; description: string; fields: Record<string, unknown> }>>,
    };
  },
});

// Export all tools together for convenience
export const homeAssistantTools = {
  callHomeAssistantService,
  getEntityLogbook,
  getHomeAssistantStates,
  getHomeAssistantServices,
};
