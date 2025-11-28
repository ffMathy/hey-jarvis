import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { Observability } from '@mastra/observability';
import { keyBy } from 'lodash-es';
import { getSqlStorageProvider } from './storage/index.js';
import {
  checkForFormRepliesWorkflow,
  checkForNewEmails,
  generateMealPlanWorkflow,
  getPublicAgents,
  humanInTheLoopDemoWorkflow,
  implementFeatureWorkflow,
  sendEmailAndAwaitResponseWorkflow,
  stateChangeNotificationWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
} from './verticals/index.js';
import { getCurrentDagWorkflow, getNextInstructionsWorkflow, routePromptWorkflow } from './verticals/routing/workflows.js';

async function createMastra() {
  // Set up the Google AI SDK environment variable
  process.env['GOOGLE_GENERATIVE_AI_API_KEY'] = process.env['HEY_JARVIS_GOOGLE_API_KEY'] || '';

  const sqlStorageProvider = await getSqlStorageProvider();

  // Get public agents (for MCP server)
  const publicAgents = await getPublicAgents();

  // Build agents object dynamically using agent IDs
  const agentsByName = {
    ...keyBy(publicAgents, 'id'),
  };

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
      routePromptWorkflow,
      getCurrentDagWorkflow,
      getNextInstructionsWorkflow
    },
    agents: agentsByName,
  });
}

export const mastra = await createMastra();
