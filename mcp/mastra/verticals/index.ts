import { getCalendarAgent } from './calendar/agent.js';
import { getCodingAgent } from './coding/agent.js';
import { getCommuteAgent } from './commute/agent.js';
import { getCookingAgent } from './cooking/agents.js';
import { getEmailAgent } from './email/agent.js';
import { getInternetOfThingsAgent } from './internet-of-things/agent.js';
import { getShoppingListAgent } from './shopping/agents.js';
import { getTodoListAgent } from './todo-list/agent.js';
import { getWeatherAgent } from './weather/agent.js';

// Main verticals exports
export * from './calendar/index.js';
export * from './coding/index.js';
export * from './commute/index.js';
export * from './cooking/index.js';
export * from './email/index.js';
export * from './human-in-the-loop/index.js';
export * from './internet-of-things/index.js';
export * from './notification/index.js';
export * from './routing/index.js';
export * from './shopping/index.js';
export * from './synapse/index.js';
export * from './todo-list/index.js';
export * from './weather/index.js';
export * from './web-research/index.js';

// Get agents for public MCP server
export async function getPublicAgents() {
  return await Promise.all([
    getCodingAgent(),
    getCookingAgent(),
    getWeatherAgent(),
    getShoppingListAgent(),
    getEmailAgent(),
    getCalendarAgent(),
    getTodoListAgent(),
    getInternetOfThingsAgent(),
    getCommuteAgent(),
  ]);
}
