// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { mastra } from '../../index.js';
import { executePlan, getPlanResult, routingTools } from './tools.js';

describe('Routing Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify required environment variables
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY environment variable is required for routing tools tests');
    }
  });

  describe('executePlan tool', () => {
    it('should have correct tool id', () => {
      expect(executePlan.id).toBe('executePlan');
    });

    it('should have a description', () => {
      expect(executePlan.description).toBeDefined();
      expect(executePlan.description.length).toBeGreaterThan(0);
    });

    it('should require a query input', () => {
      const inputSchema = executePlan.inputSchema;
      expect(inputSchema).toBeDefined();
      expect(inputSchema.shape.query).toBeDefined();
    });

    it('should return failure when mastra context is not available', async () => {
      const result = await executePlan.execute({ query: 'test query' }, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('Mastra instance not available');
    });

    it('should return failure when routing agent is not found', async () => {
      const mockMastra = {
        getAgent: () => {
          throw new Error('Agent not found');
        },
      };

      const result = await executePlan.execute({ query: 'test query' }, { mastra: mockMastra });

      expect(result.success).toBe(false);
      expect(result.message).toContain('Routing agent not found');
    });

    it('should execute a simple query and return a plan with real Mastra instance', async () => {
      const result = await executePlan.execute({ query: 'Say hello' }, { mastra });

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan?.planId).toMatch(/^plan-\d+$/);
      expect(result.plan?.tasks).toBeDefined();
      expect(result.plan?.tasks.length).toBeGreaterThan(0);
      expect(result.plan?.tasks[0].runId).toMatch(/^task-\d+$/);
      expect(result.plan?.tasks[0].status).toBe('running');
      expect(result.message).toContain('started successfully');
    }, 60000);
  });

  describe('getPlanResult tool', () => {
    it('should have correct tool id', () => {
      expect(getPlanResult.id).toBe('getPlanResult');
    });

    it('should have a description', () => {
      expect(getPlanResult.description).toBeDefined();
      expect(getPlanResult.description.length).toBeGreaterThan(0);
    });

    it('should require a runId input', () => {
      const inputSchema = getPlanResult.inputSchema;
      expect(inputSchema).toBeDefined();
      expect(inputSchema.shape.runId).toBeDefined();
    });

    it('should return failure for non-existent runId', async () => {
      const result = await getPlanResult.execute({ runId: 'non-existent-run-id' }, {});

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should have nextTaskId in output schema', () => {
      const outputSchema = getPlanResult.outputSchema;
      expect(outputSchema).toBeDefined();
      expect(outputSchema.shape.nextTaskId).toBeDefined();
    });

    it('should wait for task completion and return result', async () => {
      // First, execute a plan
      const planResult = await executePlan.execute({ query: 'Say hello' }, { mastra });

      expect(planResult.success).toBe(true);
      expect(planResult.plan?.tasks[0].runId).toBeDefined();

      const taskId = planResult.plan!.tasks[0].runId;

      // Then, get the result
      const result = await getPlanResult.execute({ runId: taskId }, { mastra });

      // Task should complete (either success or failure)
      expect(['completed', 'failed']).toContain(result.status);
      expect(result.message).toBeDefined();

      if (result.status === 'completed') {
        expect(result.success).toBe(true);
        expect(result.result).toBeDefined();
      }
    }, 120000);
  });

  describe('routingTools object', () => {
    it('should export all routing tools', () => {
      expect(routingTools).toBeDefined();
      expect(routingTools.executePlan).toBeDefined();
      expect(routingTools.getPlanResult).toBeDefined();
    });

    it('should have 2 tools', () => {
      expect(Object.keys(routingTools).length).toBe(2);
    });
  });

  describe('Routing Agent Integration', () => {
    it('should have routing agent registered in Mastra', () => {
      const agent = mastra.getAgent('RoutingAgent');
      expect(agent).toBeDefined();
      expect(agent.name).toBe('RoutingAgent');
    });

    it('should have access to other agents through the network', async () => {
      const agent = mastra.getAgent('RoutingAgent');
      expect(agent).toBeDefined();

      // Verify the agent has network capability
      expect(typeof agent.network).toBe('function');
    });
  });
});
