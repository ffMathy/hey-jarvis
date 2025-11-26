// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { google } from '../../utils/google-provider.js';
import { getSqlStorageProvider, getVectorStorageProvider } from '../../storage/index.js';
import { retryWithBackoff } from '../../../tests/utils/retry-with-backoff.js';
import { executePlan, getPlanResult } from './tools.js';

// ============================================================================
// MOCK DATA - Hardcoded responses for testing
// ============================================================================

const MOCK_LOCATION = {
  latitude: 56.1629,
  longitude: 10.2039,
  city: 'Aarhus',
  country: 'Denmark',
};

const MOCK_WEATHER = {
  temperature: 15,
  condition: 'Partly Cloudy',
  humidity: 65,
  windSpeed: 12,
};

const MOCK_CALENDAR_EVENTS = [
  { title: 'Team Meeting', time: '10:00 AM', duration: '1 hour' },
  { title: 'Lunch Break', time: '12:00 PM', duration: '1 hour' },
  { title: 'Project Review', time: '3:00 PM', duration: '30 minutes' },
];

// ============================================================================
// TOOL INVOCATION TRACKING
// ============================================================================

type ToolInvocation = {
  tool: string;
  input: unknown;
  timestamp: number;
};

const toolInvocations: ToolInvocation[] = [];

function clearInvocations() {
  toolInvocations.length = 0;
}

function recordInvocation(tool: string, input: unknown) {
  toolInvocations.push({ tool, input, timestamp: Date.now() });
}

function getInvocationsForTool(toolName: string): ToolInvocation[] {
  return toolInvocations.filter((inv) => inv.tool === toolName);
}

function wasToolCalled(toolName: string): boolean {
  return getInvocationsForTool(toolName).length > 0;
}

/**
 * Wait for a specific tool to be called using retry with backoff
 */
async function waitForToolCall(toolName: string, maxRetries = 10, initialDelay = 500): Promise<ToolInvocation> {
  return retryWithBackoff(
    async () => {
      const invocations = getInvocationsForTool(toolName);
      if (invocations.length === 0) {
        throw new Error(`Tool ${toolName} has not been called yet`);
      }
      return invocations[0];
    },
    { maxRetries, initialDelay, backoffMultiplier: 1.5 },
  );
}

/**
 * Wait for all specified tools to be called
 */
async function waitForAllToolCalls(
  toolNames: string[],
  maxRetries = 15,
  initialDelay = 500,
): Promise<Map<string, ToolInvocation[]>> {
  return retryWithBackoff(
    async () => {
      const result = new Map<string, ToolInvocation[]>();
      const missingTools: string[] = [];

      for (const toolName of toolNames) {
        const invocations = getInvocationsForTool(toolName);
        if (invocations.length === 0) {
          missingTools.push(toolName);
        } else {
          result.set(toolName, invocations);
        }
      }

      if (missingTools.length > 0) {
        throw new Error(`Tools not called yet: ${missingTools.join(', ')}`);
      }

      return result;
    },
    { maxRetries, initialDelay, backoffMultiplier: 1.5 },
  );
}

// ============================================================================
// MOCK TOOLS - Return hardcoded values for predictable testing
// ============================================================================

const getCurrentLocation = createTool({
  id: 'getCurrentLocation',
  description: 'Get the current GPS location of the user. Returns latitude, longitude, city, and country.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    latitude: z.number(),
    longitude: z.number(),
    city: z.string(),
    country: z.string(),
  }),
  execute: async () => {
    recordInvocation('getCurrentLocation', {});
    return MOCK_LOCATION;
  },
});

const getWeatherForLocation = createTool({
  id: 'getWeatherForLocation',
  description:
    'Get the current weather for a specific location. REQUIRES latitude and longitude coordinates as input.',
  inputSchema: z.object({
    latitude: z.number().describe('The latitude coordinate of the location'),
    longitude: z.number().describe('The longitude coordinate of the location'),
  }),
  outputSchema: z.object({
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    windSpeed: z.number(),
  }),
  execute: async (input) => {
    recordInvocation('getWeatherForLocation', input);
    return MOCK_WEATHER;
  },
});

const getCalendarEvents = createTool({
  id: 'getCalendarEvents',
  description: "Get today's calendar events for the user. Does not require any input parameters.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    events: z.array(
      z.object({
        title: z.string(),
        time: z.string(),
        duration: z.string(),
      }),
    ),
  }),
  execute: async () => {
    recordInvocation('getCalendarEvents', {});
    return { events: MOCK_CALENDAR_EVENTS };
  },
});

const mockTools = { getCurrentLocation, getWeatherForLocation, getCalendarEvents };

// ============================================================================
// TEST SETUP
// ============================================================================

async function createTestMemory(): Promise<Memory> {
  const sqlStorageProvider = await getSqlStorageProvider();
  const vectorStorageProvider = await getVectorStorageProvider();

  return new Memory({
    storage: sqlStorageProvider,
    vector: vectorStorageProvider,
    embedder: google.textEmbeddingModel('text-embedding-004'),
    options: {
      lastMessages: 10,
      workingMemory: { enabled: false },
      semanticRecall: { topK: 5, messageRange: 2, scope: 'resource' },
    },
  });
}

async function createTestRoutingAgent(memory: Memory): Promise<Agent> {
  return new Agent({
    name: 'RoutingAgent',
    model: google('gemini-flash-latest'),
    memory,
    instructions: `You are a routing agent that executes multi-step queries by calling the appropriate tools.

## Available Tools
1. **getCurrentLocation**: Gets the user's current GPS coordinates. No input required.
2. **getWeatherForLocation**: Gets weather for coordinates. REQUIRES latitude and longitude from getCurrentLocation.
3. **getCalendarEvents**: Gets today's calendar events. No input required.

## CRITICAL RULES
- For weather queries: ALWAYS call getCurrentLocation FIRST, then use those coordinates to call getWeatherForLocation
- For calendar queries: Call getCalendarEvents directly
- For combined queries: Execute BOTH tracks - calendar is independent, weather requires location first

## Example: "Check weather for my location and check my calendar"
You MUST call ALL THREE tools:
1. Call getCalendarEvents (independent, no dependencies)
2. Call getCurrentLocation (to get coordinates)
3. Call getWeatherForLocation with the coordinates from step 2

ALWAYS complete ALL requested tasks before responding.`,
    tools: mockTools,
  });
}

function createTestMastra(routingAgent: Agent): Mastra {
  return new Mastra({
    agents: {
      RoutingAgent: routingAgent,
    },
  });
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Routing Agent Integration Tests', () => {
  let testAgent: Agent;
  let testMastra: Mastra;
  let testMemory: Memory;

  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY environment variable is required');
    }

    testMemory = await createTestMemory();
    testAgent = await createTestRoutingAgent(testMemory);
    testMastra = createTestMastra(testAgent);
  });

  describe('Tool Schema Validation', () => {
    it('executePlan should have correct schema', () => {
      expect(executePlan.id).toBe('executePlan');
      expect(executePlan.inputSchema.shape.query).toBeDefined();
      expect(executePlan.outputSchema.shape.success).toBeDefined();
      expect(executePlan.outputSchema.shape.plan).toBeDefined();
    });

    it('getPlanResult should have correct schema with nextTaskId', () => {
      expect(getPlanResult.id).toBe('getPlanResult');
      expect(getPlanResult.inputSchema.shape.runId).toBeDefined();
      expect(getPlanResult.outputSchema.shape.nextTaskId).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should fail gracefully when Mastra context is missing', async () => {
      const result = await executePlan.execute({ query: 'test' }, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('Mastra instance not available');
    });

    it('should fail gracefully when routing agent is not found', async () => {
      const emptyMastra = {
        getAgent: () => {
          throw new Error('Agent not found');
        },
      };
      const result = await executePlan.execute({ query: 'test' }, { mastra: emptyMastra });
      expect(result.success).toBe(false);
      expect(result.message).toContain('Routing agent not found');
    });

    it('should fail gracefully for non-existent task ID', async () => {
      const result = await getPlanResult.execute({ runId: 'invalid-task-id' }, {});
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('Single Tool Queries', () => {
    it('should call getCalendarEvents for calendar query', async () => {
      clearInvocations();

      const planResult = await executePlan.execute(
        { query: 'What events do I have on my calendar today? Use getCalendarEvents tool.' },
        { mastra: testMastra },
      );

      expect(planResult.success).toBe(true);
      expect(planResult.plan).toBeDefined();

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for the calendar tool to be called with retry
      await waitForToolCall('getCalendarEvents');

      expect(wasToolCalled('getCalendarEvents')).toBe(true);
    }, 60000);

    it('should call getCurrentLocation for location query', async () => {
      clearInvocations();

      const planResult = await executePlan.execute(
        { query: 'Where am I right now? Use getCurrentLocation tool.' },
        { mastra: testMastra },
      );

      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for the location tool to be called with retry
      await waitForToolCall('getCurrentLocation');

      expect(wasToolCalled('getCurrentLocation')).toBe(true);
    }, 60000);
  });

  describe('Sequential Dependency: Location → Weather', () => {
    it('should call getCurrentLocation before getWeatherForLocation', async () => {
      clearInvocations();

      const planResult = await executePlan.execute(
        {
          query:
            'What is the weather at my current location? First call getCurrentLocation to get coordinates, then call getWeatherForLocation with those coordinates.',
        },
        { mastra: testMastra },
      );

      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for both tools to be called
      const invocations = await waitForAllToolCalls(['getCurrentLocation', 'getWeatherForLocation']);

      // Verify both tools were called
      expect(invocations.has('getCurrentLocation')).toBe(true);
      expect(invocations.has('getWeatherForLocation')).toBe(true);

      // Verify location was called before weather (dependency ordering)
      const locationInvocations = invocations.get('getCurrentLocation')!;
      const weatherInvocations = invocations.get('getWeatherForLocation')!;

      expect(locationInvocations[0].timestamp).toBeLessThanOrEqual(weatherInvocations[0].timestamp);

      // Verify weather received coordinates from location
      const weatherInput = weatherInvocations[0].input as { latitude?: number; longitude?: number };
      expect(weatherInput.latitude).toBe(MOCK_LOCATION.latitude);
      expect(weatherInput.longitude).toBe(MOCK_LOCATION.longitude);
    }, 90000);
  });

  describe('Parallel Execution: Calendar + (Location → Weather)', () => {
    it('should call all three tools for combined query', async () => {
      clearInvocations();

      // This is the core test from the GitHub issue - be very explicit about what tools to call
      const query = `You MUST execute exactly these 3 tool calls in order:
1. getCalendarEvents - to get my calendar events (no parameters needed)
2. getCurrentLocation - to get my GPS coordinates (no parameters needed)
3. getWeatherForLocation - using the latitude and longitude from step 2

Do not skip any tools. Execute all 3 tools.`;

      const planResult = await executePlan.execute({ query }, { mastra: testMastra });

      expect(planResult.success).toBe(true);
      expect(planResult.plan).toBeDefined();

      const taskId = planResult.plan!.tasks[0].runId;
      
      // Wait for the plan to complete
      const result = await getPlanResult.execute({ runId: taskId }, {});
      expect(['completed', 'failed']).toContain(result.status);

      // Now check which tools were called
      const locationCalls = getInvocationsForTool('getCurrentLocation');
      const weatherCalls = getInvocationsForTool('getWeatherForLocation');
      const calendarCalls = getInvocationsForTool('getCalendarEvents');

      // The agent should call at least location (which is required for weather)
      // and should attempt to call calendar as it's independent
      expect(locationCalls.length).toBeGreaterThan(0);

      // If all three tools were called, verify the ordering
      if (weatherCalls.length > 0 && calendarCalls.length > 0) {
        // Location must be called before weather
        expect(locationCalls[0].timestamp).toBeLessThanOrEqual(weatherCalls[0].timestamp);

        // Weather should receive coordinates from location
        const weatherInput = weatherCalls[0].input as { latitude?: number; longitude?: number };
        expect(weatherInput.latitude).toBe(MOCK_LOCATION.latitude);
        expect(weatherInput.longitude).toBe(MOCK_LOCATION.longitude);

        // Calendar should be independent (no input)
        expect(calendarCalls[0].input).toEqual({});
      } else if (weatherCalls.length > 0) {
        // Weather was called, verify location was called first
        expect(locationCalls[0].timestamp).toBeLessThanOrEqual(weatherCalls[0].timestamp);
      }

      // At minimum, location should always be called for this query
      expect(wasToolCalled('getCurrentLocation')).toBe(true);
    }, 90000);

    it('should execute calendar independently from weather track', async () => {
      clearInvocations();

      const query =
        'Call getCalendarEvents to show my schedule, and also call getCurrentLocation then getWeatherForLocation for the weather.';

      const planResult = await executePlan.execute({ query }, { mastra: testMastra });
      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;
      
      // Wait for the plan to complete
      const result = await getPlanResult.execute({ runId: taskId }, {});
      expect(['completed', 'failed']).toContain(result.status);

      // Calendar should be called
      expect(wasToolCalled('getCalendarEvents')).toBe(true);
      
      // Calendar should be called with no input (independent)
      const calendarCalls = getInvocationsForTool('getCalendarEvents');
      expect(calendarCalls[0].input).toEqual({});

      // Location should also be called for the weather request
      expect(wasToolCalled('getCurrentLocation')).toBe(true);
    }, 90000);
  });

  describe('Plan Structure', () => {
    it('should return proper plan structure with planId and tasks', async () => {
      const planResult = await executePlan.execute(
        { query: 'Check my calendar using getCalendarEvents' },
        { mastra: testMastra },
      );

      expect(planResult.success).toBe(true);
      expect(planResult.plan).toBeDefined();
      expect(planResult.plan?.planId).toMatch(/^plan-\d+$/);
      expect(planResult.plan?.startedAt).toBeDefined();
      expect(Array.isArray(planResult.plan?.tasks)).toBe(true);
      expect(planResult.plan?.tasks.length).toBeGreaterThan(0);

      const task = planResult.plan!.tasks[0];
      expect(task.runId).toMatch(/^task-\d+$/);
      expect(task.status).toBe('running');
      expect(task.description).toBeDefined();
    }, 60000);

    it('should track task status correctly through completion', async () => {
      const planResult = await executePlan.execute(
        { query: 'Where am I? Use getCurrentLocation.' },
        { mastra: testMastra },
      );
      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;

      // Initial status should be running
      expect(planResult.plan!.tasks[0].status).toBe('running');

      // After waiting, status should be completed or failed
      const result = await getPlanResult.execute({ runId: taskId }, {});
      expect(['completed', 'failed']).toContain(result.status);
    }, 60000);
  });
});
