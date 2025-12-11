import { Mastra } from '@mastra/core';
import { MastraServer } from '@mastra/hono';
import { PinoLogger } from '@mastra/loggers';
import { CloudExporter, DefaultExporter, Observability, SamplingStrategyType } from '@mastra/observability';
//this export is required by "mastra build". it must be called `mastra` and be a Mastra instance.
//it should never be deferred for that reason.
import { Hono } from 'hono';
import { getTokenUsageStorage } from './storage/index.js';
import { TokenTrackingProcessor, TokenUsageExporter } from './utils/token-usage-exporter.js';
import {
  emailCheckingWorkflow,
  formRepliesDetectionWorkflow,
  generateMealPlanWorkflow,
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

// Set up the Google AI SDK environment variable immediately
// Prioritize HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY over HEY_JARVIS_GOOGLE_API_KEY
process.env.GOOGLE_GENERATIVE_AI_API_KEY =
  process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || process.env.HEY_JARVIS_GOOGLE_API_KEY || '';

// Export mastra instance synchronously as required by mastra build command
// The storage and agents will be lazily initialized when first accessed
export const mastra = new Mastra({
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'hey-jarvis',
        sampling: { type: SamplingStrategyType.ALWAYS },
        exporters: [new DefaultExporter(), new CloudExporter(), new TokenUsageExporter()],
        spanOutputProcessors: [new TokenTrackingProcessor()],
      },
    },
  }),
  workflows: {
    weatherMonitoringWorkflow,
    generateMealPlanWorkflow,
    weeklyMealPlanningWorkflow,
    implementFeatureWorkflow,
    stateChangeNotificationWorkflow,
    humanInTheLoopDemoWorkflow,
    emailCheckingWorkflow,
    formRepliesDetectionWorkflow,
    iotMonitoringWorkflow,
    routePromptWorkflow,
    getCurrentDagWorkflow,
    getNextInstructionsWorkflow,
  },
  bundler: {
    externals: ['@elevenlabs/elevenlabs-js'],
  },
});

/**
 * Logs cumulative token usage statistics to the console.
 * Called during startup to show token usage summary.
 */
export async function logTokenUsageSummary(): Promise<void> {
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
        console.log(
          `   - ${usage.model}: ${usage.totalTokens.toLocaleString()} tokens (${usage.requestCount} requests)`,
        );
      }
    }
  } catch (error) {
    console.error('⚠️  Failed to load token usage statistics:', error instanceof Error ? error.message : String(error));
  }
}

// 1. Initialize the Hono Application
// We do not need any special adapters for Bun here; Hono works out of the box.
const app = new Hono();

// 2. Initialize the Mastra Server Adapter
// This class wraps our Hono app and injects the Mastra capabilities.
const mastraServer = new MastraServer({
  app: app,
  mastra: mastra,
  openapiPath: '/openapi.json',
  bodyLimitOptions: {
    maxSize: 10 * 1024 * 1024, // 10MB
    onError: (err) => ({ error: 'Payload too large', maxSize: '10MB' }),
  },
  streamOptions: { redact: true },
});

// 3. Initialize Routes
// Top-level await is supported in Bun and works correctly even with mastra build
await mastraServer.init();

// 4. Add Custom Routes (Post-Init)
// We can add routes that leverage the Mastra context.
app.get('/health', (c) => c.json({ status: 'ok', runtime: 'bun' }));

// 5. Export for Bun
// Bun.serve looks for a default export with a 'fetch' handler.
export default app;
