import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { SpanType } from '@mastra/core/observability';
import { MastraServer } from '@mastra/hono';
import { CloudExporter, DefaultExporter, Observability, SamplingStrategyType } from '@mastra/observability';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getCorsOptions } from './cors.js';
import { getMastraStorageProvider, getTokenUsageStorage } from './storage/index.js';
import { stripTransferEncodingHeader } from './streaming-headers.js';
import { createLogger } from './utils/logger.js';
import { TokenTrackingProcessor, TokenUsageExporter } from './utils/token-usage-exporter.js';
import { storageRetentionWorkflow, tokenUsageTools } from './verticals/api/index.js';
import { calendarTools, getCalendarAgent } from './verticals/calendar/index.js';
import { codingTools, getCodingAgent } from './verticals/coding/index.js';
import { commuteTools, getCommuteAgent } from './verticals/commute/index.js';
import { cookingTools, getCookingAgent } from './verticals/cooking/index.js';
import { emailTools, getEmailAgent } from './verticals/email/index.js';
import { generativeUiShortcuts, generativeUiTools, getGenerativeUiAgent } from './verticals/generative-ui/index.js';
import { getEmailParsingAgent, humanInTheLoopTools } from './verticals/human-in-the-loop/index.js';
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
  getInternetOfThingsAgent,
  internetOfThingsShortcuts,
  internetOfThingsTools,
} from './verticals/internet-of-things/index.js';
import { getNotificationAgent, notificationTools } from './verticals/notification/index.js';
import { phoneTools } from './verticals/phone/index.js';
import { presenceShortcuts } from './verticals/presence/index.js';
import { getReflectionAgent, reflectionTools } from './verticals/reflection/index.js';
import { getRoutingPlannerAgent } from './verticals/routing/planner.js';
import { getNextInstructionsWorkflow, routePromptWorkflow } from './verticals/routing/workflows.js';
import { getShoppingListAgent, getShoppingListSummaryAgent, shoppingTools } from './verticals/shopping/index.js';
import { getStateChangeReactorAgent, synapseTools } from './verticals/synapse/index.js';
import { getTodoListAgent, todoListTools } from './verticals/todo-list/index.js';
import { getWeatherAgent, weatherTools } from './verticals/weather/index.js';
import { getWebResearchAgent } from './verticals/web-research/index.js';
import { retireUnrestartableRuns } from './workflow-run-recovery.js';

// Set up the Google AI SDK environment variable immediately.
// No fallback to a general "Google" key: HEY_JARVIS_GOOGLE_MAPS_API_KEY is scoped to
// the Maps APIs and returns API_KEY_INVALID here, which used to look like a broken
// credential rather than the wrong one.
process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY || '';

function toAgentMap(agents: Agent[]): Record<string, Agent> {
  return agents.reduce<Record<string, Agent>>((acc, agent) => {
    acc[agent.id] = agent;
    return acc;
  }, {});
}

/**
 * The instance logger, held so the scheduler's error handler can report through the same
 * one rather than going around it to the console.
 */
const mastraLogger = createLogger('Mastra');

export async function getMastra(): Promise<Mastra> {
  return new Mastra({
    // Without this Mastra keeps workflow runs, schedules, background tasks and traces in
    // RAM and loses them on restart. See getMastraStorageProvider for why observability is
    // composed.
    storage: await getMastraStorageProvider(),
    // Mastra reports its own failures — a workflow run that could not be restarted at
    // boot, a scheduler tick that threw — by handing the error to this logger as a plain
    // field. `createLogger` is what makes those fields readable; a bare PinoLogger prints
    // them as `error: {}`.
    logger: mastraLogger,
    // Where `mastra.schedules` reports a scheduled run that threw, and the only place it
    // does: without a handler the rejection is swallowed, with no schedule id attached to
    // say which one it was.
    scheduler: {
      onError: (error, { scheduleId }) => {
        mastraLogger.error('Scheduled workflow failed', { scheduleId, error });
      },
    },
    observability: new Observability({
      configs: {
        default: {
          serviceName: 'hey-jarvis',
          sampling: { type: SamplingStrategyType.ALWAYS },
          exporters: [new DefaultExporter(), new CloudExporter(), new TokenUsageExporter()],
          spanOutputProcessors: [new TokenTrackingProcessor()],
          // One span per streamed chunk of every model call, which nothing here reads: token usage
          // is taken from the generation spans, and the reflection agent reads failing spans. Kept,
          // they are storage writes on every call and noise in every trace that agent is handed.
          excludeSpanTypes: [SpanType.MODEL_CHUNK],
        },
      },
    }),
    workflows: {
      storageRetentionWorkflow,
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
      getNextInstructionsWorkflow,
    },
    agents: toAgentMap([
      await getCalendarAgent(),
      await getCommuteAgent(),
      await getCookingAgent(),
      await getCodingAgent(),
      await getEmailAgent(),
      await getEmailParsingAgent(),
      await getGenerativeUiAgent(),
      await getInternetOfThingsAgent(),
      await getNotificationAgent(),
      await getReflectionAgent(),
      await getRoutingPlannerAgent(),
      await getShoppingListAgent(),
      await getShoppingListSummaryAgent(),
      await getStateChangeReactorAgent(),
      await getTodoListAgent(),
      await getWeatherAgent(),
      await getWebResearchAgent(),
    ]),
    tools: {
      ...tokenUsageTools,
      ...calendarTools,
      ...codingTools,
      ...commuteTools,
      ...cookingTools,
      ...emailTools,
      ...generativeUiShortcuts,
      ...generativeUiTools,
      ...humanInTheLoopTools,
      ...internetOfThingsTools,
      ...internetOfThingsShortcuts,
      ...notificationTools,
      ...phoneTools,
      ...presenceShortcuts,
      ...reflectionTools,
      ...shoppingTools,
      ...synapseTools,
      ...todoListTools,
      ...weatherTools,
    },
    bundler: {
      // @yarflam/potion-base-8m resolves its embedding table relative to its own
      // module URL, so it has to stay unbundled or the model files go missing.
      externals: ['@elevenlabs/elevenlabs-js', 'twilio', '@yarflam/potion-base-8m'],
    },
    server: {
      studioBase: process.env.MASTRA_STUDIO_BASE_URL,
      port: process.env.MASTRA_SERVER_PORT ? Number(process.env.MASTRA_SERVER_PORT) : 4111,
      // Applies to the server `mastra dev` builds around this instance — the one that
      // actually serves 4111 in the Docker image. See streaming-headers.ts.
      middleware: [stripTransferEncodingHeader],
    },
  });
}

/**
 * Logs cumulative token usage statistics to the console.
 * Called during startup to show token usage summary.
 */
export async function logTokenUsageSummary(): Promise<void> {
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
}

// 1. Initialize the Hono Application
// We do not need any special adapters for Bun here; Hono works out of the box.
const app = new Hono();
app.use('*', cors(getCorsOptions()));
// The `server.middleware` entry above covers `mastra dev`; this covers the same routes
// when this file is served directly (`turbo serve --filter=mcp`).
app.use('*', stripTransferEncodingHeader);

export const mastra = await getMastra();

// Before the boot restart walks into a run whose workflow has moved on under it.
// See ./workflow-run-recovery.ts.
await retireUnrestartableRuns(mastra);

// 2. Initialize the Mastra Server Adapter
// This class wraps our Hono app and injects the Mastra capabilities.
const mastraServer = new MastraServer({
  app: app,
  mastra: mastra,
  openapiPath: '/openapi.json',
  bodyLimitOptions: {
    maxSize: 10 * 1024 * 1024, // 10MB
    onError: (_err) => ({ error: 'Payload too large', maxSize: '10MB' }),
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
// Include port and hostname to ensure proper binding
export default {
  port: process.env.MASTRA_SERVER_PORT ? Number(process.env.MASTRA_SERVER_PORT) : 4111,
  hostname: process.env.HOST || '0.0.0.0',
  fetch: app.fetch,
};
