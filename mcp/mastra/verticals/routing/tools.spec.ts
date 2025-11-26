// @ts-expect-error - bun:test types are built into Bun runtime
import { describe, expect, it } from 'bun:test';
import { routingTools, executePlan, getPlanResult } from './tools';

describe('Routing Tools', () => {
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

      // Check that the schema shape is correct
      const schemaShape = inputSchema.shape;
      expect(schemaShape.query).toBeDefined();
    });

    it('should return failure when mastra context is not available', async () => {
      const result = await executePlan.execute(
        { query: 'test query' },
        {}, // Empty context without mastra
      );

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

      // Check that the schema shape is correct
      const schemaShape = inputSchema.shape;
      expect(schemaShape.runId).toBeDefined();
    });

    it('should return failure for non-existent runId', async () => {
      const result = await getPlanResult.execute(
        { runId: 'non-existent-run-id' },
        {},
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
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
});
