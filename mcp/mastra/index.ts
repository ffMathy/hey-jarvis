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
  iotMonitoringWorkflow,
  stateChangeNotificationWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
} from './verticals/index.js';
import {
  getCurrentDagWorkflow,
  getNextInstructionsWorkflow,
  routePromptWorkflow,
} from './verticals/routing/workflows.js';

async function createMastra() {
  // Set up the Google AI SDK environment variable
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.HEY_JARVIS_GOOGLE_API_KEY || '';

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
      checkForFormRepliesWorkflow,
      checkForNewEmails,
      iotMonitoringWorkflow,
      routePromptWorkflow,
      getCurrentDagWorkflow,
      getNextInstructionsWorkflow,
    },
    agents: agentsByName,
    // Workaround for mastra CLI bundler bug: the bundler incorrectly resolves
    // @mastra/core/evals/scoreTraces to @mastra/core/eval (singular) during the
    // "Optimizing dependencies" step, causing "Cannot find module" errors in Docker.
    // Adding @mastra/core, @mastra/evals and related paths to externals bypasses this issue.
    // Note: This workaround is applied but may not fully work due to a bug where
    // externals are only used in bundleExternals, not in captureDependenciesToOptimize.
    bundler: {
      externals: [
        '@mastra/core',
        '@mastra/core/evals',
        '@mastra/core/evals/scoreTraces',
        '@mastra/evals',
        '@mastra/evals/scorers/prebuilt',
        '@mastra/evals/scorers/utils',
      ],
    },
  });
}

export const mastra = await createMastra();
