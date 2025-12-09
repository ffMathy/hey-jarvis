import { beforeAll, describe, expect, it } from 'bun:test';
import type { Mastra } from '@mastra/core';
import { getMastra } from '../../index.js';
import { ensureModelAvailable, isOllamaAvailable, OLLAMA_MODEL } from '../../utils/ollama-provider.js';

describe('weatherMonitoringWorkflow', () => {
  let ollamaAvailable = false;
  let mastra: Mastra;

  beforeAll(async () => {
    // Initialize Mastra
    mastra = await getMastra();

    // Verify required environment variables
    if (!process.env.HEY_JARVIS_OPENWEATHERMAP_API_KEY) {
      throw new Error('HEY_JARVIS_OPENWEATHERMAP_API_KEY environment variable is required for weather workflow tests');
    }
    if (!process.env.HEY_JARVIS_GOOGLE_API_KEY) {
      throw new Error('HEY_JARVIS_GOOGLE_API_KEY environment variable is required for weather workflow tests');
    }

    // Check Ollama availability and ensure model is pulled
    ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.log('⚠️ Ollama is not available - integration tests requiring Ollama will be skipped');
    } else {
      // Ensure the model is available (lazy pull if needed)
      await ensureModelAvailable(OLLAMA_MODEL);
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
  }, 120000); // Increased timeout to allow for model pulling

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
  }, 120000); // Increased timeout to allow for model pulling

  it('should have correct workflow structure', () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');

    // Verify workflow is properly configured
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('weatherMonitoringWorkflow');
  });
});
