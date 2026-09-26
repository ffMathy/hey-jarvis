import { beforeAll, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import { weatherMonitoringWorkflow } from './workflows.js';

const workflowResultSchema = z.object({
  registered: z.boolean(),
  message: z.string(),
});

/**
 * Asserts the run succeeded and hands back its typed result.
 *
 * Mastra's run result is a discriminated union in which `result` only exists on
 * the success branch, so the status has to be narrowed rather than merely
 * asserted on.
 */
function expectSuccessfulResult(execution: { status: string; result?: unknown }) {
  expect(execution.status).toBe('success');
  return workflowResultSchema.parse(execution.result);
}

describe('weatherMonitoringWorkflow', () => {
  let mastra: Mastra;

  beforeAll(async () => {
    // Create a minimal Mastra instance with just the weather workflow.
    // Avoids importing the full index.ts entrypoint which starts a Hono server at module level.
    mastra = new Mastra({
      workflows: { weatherMonitoringWorkflow },
    });

    // Verify required environment variables
    if (!process.env.HEY_JARVIS_OPENWEATHERMAP_API_KEY) {
      throw new Error('HEY_JARVIS_OPENWEATHERMAP_API_KEY environment variable is required for weather workflow tests');
    }
    if (!process.env.HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY) {
      throw new Error(
        'HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY environment variable is required for weather workflow tests',
      );
    }
  });

  it('should execute the workflow successfully', async () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');
    const run = await workflow.createRun();
    const execution = await run.start({ inputData: {} });

    // Verify the workflow completes successfully
    expect(execution).toBeDefined();

    const result = expectSuccessfulResult(execution);
    expect(typeof result.registered).toBe('boolean');
    expect(typeof result.message).toBe('string');
  }, 60000);

  it('should have correct workflow structure', () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');

    // Verify workflow is properly configured
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('weatherMonitoringWorkflow');
  });
});
