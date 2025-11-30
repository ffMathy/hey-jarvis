// @ts-expect-error - Bun's test framework types are not available in TypeScript definitions
import { beforeAll, describe, expect, it } from 'bun:test';
import { mastra } from '../../index.js';

// Check if Ollama is available
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ollamaHost = process.env.OLLAMA_HOST || 'localhost';
    const ollamaPort = process.env.OLLAMA_PORT || '11434';
    const response = await fetch(`http://${ollamaHost}:${ollamaPort}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

describe('weatherMonitoringWorkflow', () => {
  let ollamaAvailable = false;

  beforeAll(async () => {
    // Verify required environment variables
    if (!process.env.HEY_JARVIS_OPENWEATHERMAP_API_KEY) {
      throw new Error('HEY_JARVIS_OPENWEATHERMAP_API_KEY environment variable is required for weather workflow tests');
    }
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY environment variable is required for weather workflow tests');
    }

    // Check Ollama availability
    ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.log('⚠️ Ollama is not available - integration tests requiring Ollama will be skipped');
    }
  });

  it('should execute the workflow successfully', async () => {
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

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
    if (!ollamaAvailable) {
      console.log('Skipping test: Ollama is not available');
      return;
    }

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
