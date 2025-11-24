// @ts-expect-error - Bun's test framework types are not available in TypeScript definitions
import { beforeAll, describe, expect, it } from 'bun:test';
import { mastra } from '../../index.js';

describe('weatherMonitoringWorkflow', () => {
  beforeAll(() => {
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
    expect(execution.status).toBe('success');
    expect(execution.result).toBeDefined();
    expect(execution.result.registered).toBeDefined();
    expect(typeof execution.result.registered).toBe('boolean');
    expect(typeof execution.result.message).toBe('string');
  }, 60000); // Increase timeout for real API calls

  it('should complete workflow with proper structure', async () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');
    const run = await workflow.createRun();
    const execution = await run.start({ inputData: {} });

    // Verify that the workflow completed
    expect(execution.status).toBe('success');
    expect(execution.result).toBeDefined();

    // Verify the result has the expected keys
    expect('registered' in execution.result).toBe(true);
    expect('message' in execution.result).toBe(true);
  }, 60000); // Increase timeout for real API calls

  it('should have correct workflow structure', () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');

    // Verify workflow is properly configured
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('weatherMonitoringWorkflow');
  });
});
