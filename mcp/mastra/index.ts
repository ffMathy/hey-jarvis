import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { getSqlStorageProvider } from './storage/index.js';
import {
  checkForFormRepliesWorkflow,
  checkForNewEmails,
  generateMealPlanWorkflow,
  getPublicAgents,
  getRoutingAgent,
  humanInTheLoopDemoWorkflow,
  implementFeatureWorkflow,
  sendEmailAndAwaitResponseWorkflow,
  stateChangeNotificationWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
} from './verticals/index.js';

async function createMastra() {
  // Set up the Google AI SDK environment variable
  process.env['GOOGLE_GENERATIVE_AI_API_KEY'] = process.env['HEY_JARVIS_GOOGLE_API_KEY'] || '';

  const sqlStorageProvider = await getSqlStorageProvider();

  // Get public agents (for MCP server)
  const publicAgents = await getPublicAgents();

  // Get the routing agent for async orchestration
  const routingAgent = await getRoutingAgent();

  // Build agents object dynamically using agent IDs
  const agentsByName = publicAgents.reduce(
    (acc, agent) => {
      const agentId = agent.id;
      acc[agentId] = agent;
      return acc;
    },
    {} as Record<string, (typeof publicAgents)[0]>,
  );

  // Add routing agent
  agentsByName[routingAgent.id] = routingAgent;

  return new Mastra({
    storage: sqlStorageProvider,
    logger: new PinoLogger({
      name: 'Mastra',
      level: 'info',
    }),
    observability: new Observability({ default: { enabled: true } }),
    workflows: {
      weatherMonitoringWorkflow,
      generateMealPlanWorkflow,
      weeklyMealPlanningWorkflow,
      implementFeatureWorkflow,
      stateChangeNotificationWorkflow,
      humanInTheLoopDemoWorkflow,
      sendEmailAndAwaitResponseWorkflow,
      checkForFormRepliesWorkflow,
      checkForNewEmails,
    },
    agents: agentsByName,
  });
}

export const mastra = await createMastra();
