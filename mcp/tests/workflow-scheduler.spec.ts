import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { WorkflowScheduler, CronPatterns, validateCronExpression } from '../mastra/utils/workflow-scheduler';
import { Mastra } from '@mastra/core';
import { createWorkflow, createStep } from '../mastra/utils/workflow-factory';
import { z } from 'zod';

describe('WorkflowScheduler', () => {
  let scheduler: WorkflowScheduler;
  let mastra: Mastra;

  beforeEach(() => {
    // Create a simple test step
    const testStep = createStep({
      id: 'test-step',
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
      execute: async () => ({ result: 'test completed' }),
    });

    // Create a simple test workflow with the step
    const testWorkflow = createWorkflow({
      id: 'testWorkflow', // ID must match the key in workflows object
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
    })
      .then(testStep)
      .commit();

    mastra = new Mastra({
      workflows: {
        testWorkflow, // Key name becomes the workflow ID for getWorkflow
      },
    });

    scheduler = new WorkflowScheduler(mastra, {
      timezone: 'Europe/Copenhagen',
    });
  });

  afterEach(() => {
    // Stop all scheduled tasks
    scheduler.stop();
  });

  describe('schedule', () => {
    it('should schedule a workflow with valid cron expression', () => {
      expect(() => {
        scheduler.schedule({
          workflowId: 'testWorkflow',
          schedule: CronPatterns.EVERY_HOUR,
          name: 'Test Workflow',
        });
      }).not.toThrow();
    });

    it('should throw error for invalid cron expression', () => {
      expect(() => {
        scheduler.schedule({
          workflowId: 'testWorkflow',
          schedule: 'invalid cron',
          name: 'Test Workflow',
        });
      }).toThrow('Invalid cron expression');
    });

    it('should throw error for non-existent workflow', () => {
      expect(() => {
        scheduler.schedule({
          workflowId: 'non-existent-workflow',
          schedule: CronPatterns.EVERY_HOUR,
          name: 'Non-existent Workflow',
        });
      }).toThrow(/Workflow.*not found/);
    });
  });

  describe('start and stop', () => {
    it('should start all scheduled workflows', () => {
      scheduler.schedule({
        workflowId: 'testWorkflow',
        schedule: CronPatterns.EVERY_HOUR,
        name: 'Test Workflow',
      });

      expect(() => scheduler.start()).not.toThrow();
    });

    it('should stop all scheduled workflows', () => {
      scheduler.schedule({
        workflowId: 'testWorkflow',
        schedule: CronPatterns.EVERY_HOUR,
        name: 'Test Workflow',
      });

      scheduler.start();
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('getScheduledWorkflows', () => {
    it('should return list of scheduled workflows', () => {
      scheduler.schedule({
        workflowId: 'testWorkflow',
        schedule: CronPatterns.EVERY_HOUR,
        name: 'Test Workflow',
      });

      const scheduled = scheduler.getScheduledWorkflows();
      expect(scheduled).toContain('testWorkflow');
      expect(scheduled.length).toBe(1);
    });
  });

  describe('stopWorkflow', () => {
    it('should stop a specific workflow', () => {
      scheduler.schedule({
        workflowId: 'testWorkflow',
        schedule: CronPatterns.EVERY_HOUR,
        name: 'Test Workflow',
      });

      scheduler.start();
      scheduler.stopWorkflow('testWorkflow');

      const scheduled = scheduler.getScheduledWorkflows();
      expect(scheduled).not.toContain('testWorkflow');
    });
  });

  describe('CronPatterns', () => {
    it('should have valid cron patterns', () => {
      expect(validateCronExpression(CronPatterns.EVERY_MINUTE)).toBe(true);
      expect(validateCronExpression(CronPatterns.EVERY_HOUR)).toBe(true);
      expect(validateCronExpression(CronPatterns.DAILY_AT_MIDNIGHT)).toBe(true);
      expect(validateCronExpression(CronPatterns.WEEKLY_SUNDAY_8AM)).toBe(true);
    });
  });

  describe('validateCronExpression', () => {
    it('should validate correct cron expressions', () => {
      expect(validateCronExpression('* * * * *')).toBe(true);
      expect(validateCronExpression('0 * * * *')).toBe(true);
      expect(validateCronExpression('0 0 * * 0')).toBe(true);
    });

    it('should reject invalid cron expressions', () => {
      expect(validateCronExpression('invalid')).toBe(false);
      expect(validateCronExpression('* * * *')).toBe(false);
      expect(validateCronExpression('60 * * * *')).toBe(false);
    });
  });
});
