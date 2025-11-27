// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import type { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import { filter } from 'lodash-es';
import { createTool } from '../../utils/tool-factory.js';
import { getRoutingAgent } from './agent.js';
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
  return filter(toolInvocations, (inv) => inv.tool === toolName);
}

function wasToolCalled(toolName: string): boolean {
  return getInvocationsForTool(toolName).length > 0;
}

/**
 * Wait for all specified tools to be called using retry with backoff
 */
async function waitForAllToolCalls(
  toolNames: string[],
  maxRetries = 20,
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
// TEST SETUP - Uses real routing agent with mock tools
// ============================================================================

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

  beforeAll(async () => {
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY environment variable is required');
    }

    // Use the real routing agent but with mock tools and no agents (empty)
    testAgent = await getRoutingAgent({ tools: mockTools, agents: {} });
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
    it('should call calendar tool for calendar query', async () => {
      clearInvocations();

      const planResult = await executePlan.execute(
        { query: 'What events do I have on my calendar today?' },
        { mastra: testMastra },
      );

      expect(planResult.success).toBe(true);
      expect(planResult.plan).toBeDefined();

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for the calendar tool to be called
      await waitForAllToolCalls(['getCalendarEvents']);

      expect(wasToolCalled('getCalendarEvents')).toBe(true);
    }, 60000);

    it('should call location tool for location query', async () => {
      clearInvocations();

      const planResult = await executePlan.execute({ query: 'Where am I right now?' }, { mastra: testMastra });

      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for the location tool to be called
      await waitForAllToolCalls(['getCurrentLocation']);

      expect(wasToolCalled('getCurrentLocation')).toBe(true);
    }, 60000);
  });

  describe('Weather Query (requires location)', () => {
    it('should call both location and weather tools for weather query', async () => {
      clearInvocations();

      const planResult = await executePlan.execute(
        { query: 'What is the weather at my current location?' },
        { mastra: testMastra },
      );

      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for both tools to be called
      await waitForAllToolCalls(['getCurrentLocation', 'getWeatherForLocation']);

      // Verify both tools were called
      expect(wasToolCalled('getCurrentLocation')).toBe(true);
      expect(wasToolCalled('getWeatherForLocation')).toBe(true);

      // Verify weather received correct coordinates from location
      const weatherInvocations = getInvocationsForTool('getWeatherForLocation');
      const weatherInput = weatherInvocations[0].input as { latitude?: number; longitude?: number };
      expect(weatherInput.latitude).toBe(MOCK_LOCATION.latitude);
      expect(weatherInput.longitude).toBe(MOCK_LOCATION.longitude);
    }, 90000);
  });

  describe('Combined Query (calendar + weather)', () => {
    it('should call all three tools for combined query', async () => {
      clearInvocations();

      // Natural query without specifying tool names or order
      const query = 'Check the weather for my current location and also check my calendar for today.';

      const planResult = await executePlan.execute({ query }, { mastra: testMastra });

      expect(planResult.success).toBe(true);
      expect(planResult.plan).toBeDefined();

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for all three tools to be called
      await waitForAllToolCalls(['getCurrentLocation', 'getWeatherForLocation', 'getCalendarEvents']);

      // Verify all tools were called
      expect(wasToolCalled('getCurrentLocation')).toBe(true);
      expect(wasToolCalled('getWeatherForLocation')).toBe(true);
      expect(wasToolCalled('getCalendarEvents')).toBe(true);

      // Verify weather received correct coordinates
      const weatherInvocations = getInvocationsForTool('getWeatherForLocation');
      const weatherInput = weatherInvocations[0].input as { latitude?: number; longitude?: number };
      expect(weatherInput.latitude).toBe(MOCK_LOCATION.latitude);
      expect(weatherInput.longitude).toBe(MOCK_LOCATION.longitude);

      // Verify calendar was called with no input (independent)
      const calendarInvocations = getInvocationsForTool('getCalendarEvents');
      expect(calendarInvocations[0].input).toEqual({});
    }, 120000);

    it('should handle calendar and weather independently', async () => {
      clearInvocations();

      const query = "Show my schedule and tell me what the weather is like where I am.";

      const planResult = await executePlan.execute({ query }, { mastra: testMastra });
      expect(planResult.success).toBe(true);

      const taskId = planResult.plan!.tasks[0].runId;
      await getPlanResult.execute({ runId: taskId }, {});

      // Wait for all tools to be called
      await waitForAllToolCalls(['getCurrentLocation', 'getWeatherForLocation', 'getCalendarEvents']);

      // Calendar should be called with no input (it's independent)
      const calendarInvocations = getInvocationsForTool('getCalendarEvents');
      expect(calendarInvocations[0].input).toEqual({});

      // Weather should have received coordinates
      const weatherInvocations = getInvocationsForTool('getWeatherForLocation');
      const weatherInput = weatherInvocations[0].input as { latitude?: number; longitude?: number };
      expect(weatherInput.latitude).toBe(MOCK_LOCATION.latitude);
      expect(weatherInput.longitude).toBe(MOCK_LOCATION.longitude);
    }, 120000);
  });

  describe('Plan Structure', () => {
    it('should return proper plan structure with planId and tasks', async () => {
      const planResult = await executePlan.execute({ query: 'Check my calendar' }, { mastra: testMastra });

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
      const planResult = await executePlan.execute({ query: 'Where am I?' }, { mastra: testMastra });
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
