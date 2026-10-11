import type { DirectAnswerCatalog } from '../utils/direct-answer-source.js';
import { getCalendarAgent } from './calendar/agent.js';
import { calendarLookups } from './calendar/lookups.js';
import { getCodingAgent } from './coding/agent.js';
import { codingLookups } from './coding/lookups.js';
import { getCommuteAgent } from './commute/agent.js';
import { getCookingAgent } from './cooking/agents.js';
import { getEmailAgent } from './email/agent.js';
import { emailLookups } from './email/lookups.js';
import { getInternetOfThingsAgent } from './internet-of-things/agent.js';
import { internetOfThingsCommands } from './internet-of-things/commands.js';
import { homeDirectAnswerSource } from './internet-of-things/direct-answers.js';
import { getReflectionAgent } from './reflection/agent.js';
import { getShoppingListAgent } from './shopping/agents.js';
import { shoppingLookups } from './shopping/lookups.js';
import { getTodoListAgent } from './todo-list/agent.js';
import { todoListLookups } from './todo-list/lookups.js';
import { getVisionAgent } from './vision/agents.js';
import { getVisualizeAgent } from './visualize/agent.js';
import { getWeatherAgent } from './weather/agent.js';
import { weatherLookups } from './weather/lookups.js';
import { getWebResearchAgent } from './web-research/agent.js';

// Main verticals exports
export * from './api/index.js';
export * from './calendar/index.js';
export * from './coding/index.js';
export * from './commute/index.js';
export * from './cooking/index.js';
export * from './email/index.js';
export * from './human-in-the-loop/index.js';
export * from './internet-of-things/index.js';
export * from './notification/index.js';
export * from './phone/index.js';
export * from './presence/index.js';
export * from './reflection/index.js';
export * from './shopping/index.js';
export * from './synapse/index.js';
export * from './todo-list/index.js';
export * from './vision/index.js';
export * from './visualize/index.js';
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
    getWebResearchAgent(),
    getReflectionAgent(),
    getVisualizeAgent(),
    getVisionAgent(),
  ]);
}

/**
 * Everything every vertical can answer without its agent, for routing to offer.
 *
 * Gathered here, where the verticals are put together, so routing is handed the lot without knowing
 * which vertical declared what. A function rather than a constant, because routing imports this
 * module while it is still being loaded.
 */
export function getDirectAnswerCatalog(): DirectAnswerCatalog {
  return {
    lookups: [
      ...weatherLookups,
      ...calendarLookups,
      ...todoListLookups,
      ...shoppingLookups,
      ...emailLookups,
      ...codingLookups,
    ],
    commands: [...internetOfThingsCommands],
    sources: [homeDirectAnswerSource],
  };
}
