// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createAgent } from '../../utils/index.js';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { weatherMonitoringWorkflow } from './workflows.js';

describe('weatherMonitoringWorkflow', () => {
  let mastra: Mastra;
  let mockWeatherAgent: Agent;

  beforeEach(async () => {
    // Create a mock weather agent that returns a simple weather result
    mockWeatherAgent = await createAgent({
      name: 'weather',
      instructions: 'Mock weather agent for testing',
      description: 'Test agent',
      tools: {},
    });

    // Mock the agent's stream method to return a structured response
    mockWeatherAgent.stream = mock(async () => {
      return {
        object: Promise.resolve({
          result: 'Current weather: 15°C, partly cloudy, humidity 65%',
        }),
      };
    });

    // Create a proper mock workflow for stateChangeNotificationWorkflow
    // This is needed because registerStateChange tries to trigger it
    const mockStateChangeStep = createStep({
      id: 'mock-state-change-step',
      inputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.unknown()),
      }),
      outputSchema: z.object({
        notificationSent: z.boolean(),
        message: z.string(),
      }),
      execute: mock(async () => {
        return {
          notificationSent: false,
          message: 'No notification needed',
        };
      }),
    });

    const mockStateChangeWorkflow = createWorkflow({
      id: 'stateChangeNotificationWorkflow',
      inputSchema: z.object({
        source: z.string(),
        stateType: z.string(),
        stateData: z.record(z.unknown()),
      }),
      outputSchema: z.object({
        notificationSent: z.boolean(),
        message: z.string(),
      }),
    })
      .then(mockStateChangeStep)
      .commit();

    // Initialize Mastra with the weather workflow and mock dependencies
    mastra = new Mastra({
      workflows: {
        weatherMonitoringWorkflow,
        stateChangeNotificationWorkflow: mockStateChangeWorkflow,
      },
      agents: {
        weather: mockWeatherAgent,
      },
    });
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

    // The result structure depends on whether the notification workflow is triggered
    // In the test environment, it should attempt to trigger it
    expect(execution.result.message).toBeDefined();
  });

  it('should call the weather agent', async () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');
    const run = await workflow.createRun();
    await run.start({ inputData: {} });

    // Verify the weather agent was called
    expect(mockWeatherAgent.stream).toHaveBeenCalled();
  });

  it('should complete workflow with proper structure', async () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');
    const run = await workflow.createRun();
    const execution = await run.start({ inputData: {} });

    // Verify that the workflow completed
    expect(execution.status).toBe('success');
    expect(execution.result).toBeDefined();

    // Verify the result has the expected keys (even if values vary based on context)
    expect('registered' in execution.result).toBe(true);
    expect('message' in execution.result).toBe(true);
  });

  it('should chain steps correctly', async () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');
    const run = await workflow.createRun();

    // Execute the workflow
    await run.start({ inputData: {} });

    // Verify the agent was called (first step)
    expect(mockWeatherAgent.stream).toHaveBeenCalledTimes(1);

    // Verify the agent was called with correct parameters
    const callArgs = mockWeatherAgent.stream.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(Array.isArray(callArgs[0])).toBe(true);
    expect(callArgs[0][0].content).toContain('weather');
  });

  it('should have correct workflow structure', () => {
    const workflow = mastra.getWorkflow('weatherMonitoringWorkflow');

    // Verify workflow is properly configured
    expect(workflow).toBeDefined();
    expect(workflow.id).toBe('weatherMonitoringWorkflow');
  });
});
