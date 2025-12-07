import { Mastra } from '@mastra/core';
import { PinoLogger } from '@mastra/loggers';
import { CloudExporter, DefaultExporter } from '@mastra/observability/exporters';
import { keyBy } from 'lodash-es';
import { getSqlStorageProvider, getTokenUsageStorage } from './storage/index.js';
import { TokenTrackingProcessor, TokenUsageExporter } from './utils/token-usage-exporter.js';
import {
  checkForFormRepliesWorkflow,
  checkForNewEmails,
  emailCheckingWorkflow,
  formRepliesDetectionWorkflow,
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
  // Prioritize HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY over HEY_JARVIS_GOOGLE_API_KEY
  process.env.GOOGLE_GENERATIVE_AI_API_KEY =
    process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || process.env.HEY_JARVIS_GOOGLE_API_KEY || '';

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
    observability: {
      configs: {
        default: {
          serviceName: 'hey-jarvis',
          sampling: { type: 'always' },
          exporters: [
            new DefaultExporter(),
            new CloudExporter(),
            new TokenUsageExporter(), // Track token usage for quota management
          ],
          processors: [
            new TokenTrackingProcessor(), // Enrich spans with agent/workflow context
          ],
        },
      },
    },
    workflows: {
      weatherMonitoringWorkflow,
      generateMealPlanWorkflow,
      weeklyMealPlanningWorkflow,
      implementFeatureWorkflow,
      stateChangeNotificationWorkflow,
      humanInTheLoopDemoWorkflow,
      checkForFormRepliesWorkflow,
      checkForNewEmails,
      emailCheckingWorkflow,
      formRepliesDetectionWorkflow,
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

// Log cumulative token usage on startup
try {
  const tokenStorage = await getTokenUsageStorage();
  const totalUsage = await tokenStorage.getTotalUsage();
  const modelUsage = await tokenStorage.getAllModelUsage();

  console.log('📊 Token Usage Summary:');
  console.log(`   Total: ${totalUsage.totalTokens.toLocaleString()} tokens (${totalUsage.requestCount} requests)`);
  console.log(
    `   Prompt: ${totalUsage.totalPromptTokens.toLocaleString()} | Completion: ${totalUsage.totalCompletionTokens.toLocaleString()}`,
  );

  if (modelUsage.length > 0) {
    console.log('   By Model:');
    for (const usage of modelUsage) {
      console.log(`   - ${usage.model}: ${usage.totalTokens.toLocaleString()} tokens (${usage.requestCount} requests)`);
    }
  }
} catch (error) {
  // Log errors during token usage logging, but do not block startup
  console.error('⚠️  Failed to load token usage statistics:', error instanceof Error ? error.message : String(error));
}
