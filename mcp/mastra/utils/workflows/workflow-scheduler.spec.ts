import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { z } from 'zod';
import { createStep, createWorkflow } from './workflow-factory';
import { CronPatterns, validateCronExpression, WorkflowScheduler } from './workflow-scheduler';

describe('WorkflowScheduler', () => {
  let scheduler: WorkflowScheduler;
  let mastra: Mastra;
  let testWorkflow: ReturnType<ReturnType<typeof createWorkflow>['commit']>;

  beforeEach(() => {
    // Create a simple test step
    const testStep = createStep({
      id: 'test-step',
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
      execute: async () => ({ result: 'test completed' }),
    });

    // Create a simple test workflow with the step
    testWorkflow = createWorkflow({
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
          workflow: testWorkflow,
          schedule: CronPatterns.EVERY_HOUR,
        });
      }).not.toThrow();
    });

    it('should throw error for invalid cron expression', () => {
      expect(() => {
        scheduler.schedule({
          workflow: testWorkflow,
          schedule: 'invalid cron',
        });
      }).toThrow('Invalid cron expression');
    });

    it('should throw error for non-registered workflow', () => {
      const unregisteredWorkflow = createWorkflow({
        id: 'unregisteredWorkflow',
        inputSchema: z.object({}),
        outputSchema: z.object({}),
      }).commit();

      expect(() => {
        scheduler.schedule({
          workflow: unregisteredWorkflow,
          schedule: CronPatterns.EVERY_HOUR,
        });
      }).toThrow(/Workflow.*not found/);
    });
  });

  describe('start and stop', () => {
    it('should start all scheduled workflows', () => {
      scheduler.schedule({
        workflow: testWorkflow,
        schedule: CronPatterns.EVERY_HOUR,
      });

      expect(() => scheduler.start()).not.toThrow();
    });

    it('should stop all scheduled workflows', () => {
      scheduler.schedule({
        workflow: testWorkflow,
        schedule: CronPatterns.EVERY_HOUR,
      });

      scheduler.start();
      expect(() => scheduler.stop()).not.toThrow();
    });
  });

  describe('getScheduledWorkflows', () => {
    it('should return list of scheduled workflows', () => {
      scheduler.schedule({
        workflow: testWorkflow,
        schedule: CronPatterns.EVERY_HOUR,
      });

      const scheduled = scheduler.getScheduledWorkflows();
      expect(scheduled).toContain('testWorkflow');
      expect(scheduled.length).toBe(1);
    });
  });

  describe('stopWorkflow', () => {
    it('should stop a specific workflow', () => {
      scheduler.schedule({
        workflow: testWorkflow,
        schedule: CronPatterns.EVERY_HOUR,
      });

      scheduler.start();
      scheduler.stopWorkflow('testWorkflow');

      const scheduled = scheduler.getScheduledWorkflows();
      expect(scheduled).not.toContain('testWorkflow');
    });
  });

  describe('runNow', () => {
    it('runs the workflow with the input data it was scheduled with', async () => {
      const seen: unknown[] = [];
      const recordingStep = createStep({
        id: 'recording-step',
        inputSchema: z.object({ marker: z.string() }),
        outputSchema: z.object({ result: z.string() }),
        execute: async ({ inputData }) => {
          seen.push(inputData);
          return { result: 'recorded' };
        },
      });
      const recordingWorkflow = createWorkflow({
        id: 'recordingWorkflow',
        inputSchema: z.object({ marker: z.string() }),
        outputSchema: z.object({ result: z.string() }),
      })
        .then(recordingStep)
        .commit();

      const recordingScheduler = new WorkflowScheduler(new Mastra({ workflows: { recordingWorkflow } }));
      recordingScheduler.schedule({
        workflow: recordingWorkflow,
        schedule: CronPatterns.EVERY_HOUR,
        inputData: { marker: 'from-schedule' },
      });

      expect(await recordingScheduler.runNow('recordingWorkflow')).toBe(true);
      expect(seen).toEqual([{ marker: 'from-schedule' }]);

      recordingScheduler.stop();
    });

    it('reports a failing workflow through onError instead of rejecting into the cron callback', async () => {
      const failures: { error: Error; workflowId: string }[] = [];
      const failingStep = createStep({
        id: 'failing-step',
        inputSchema: z.object({}),
        outputSchema: z.object({ result: z.string() }),
        execute: async () => {
          throw new Error('mailbox unreachable');
        },
      });
      const failingWorkflow = createWorkflow({
        id: 'failingWorkflow',
        inputSchema: z.object({}),
        outputSchema: z.object({ result: z.string() }),
      })
        .then(failingStep)
        .commit();

      const failingScheduler = new WorkflowScheduler(new Mastra({ workflows: { failingWorkflow } }), {
        onError: (error, workflowId) => failures.push({ error, workflowId }),
      });
      failingScheduler.schedule({ workflow: failingWorkflow, schedule: CronPatterns.EVERY_HOUR });

      await failingScheduler.runNow('failingWorkflow');

      expect(failures.length).toBe(1);
      expect(failures[0]?.workflowId).toBe('failingWorkflow');
      // Mastra serializes the thrown error on its way through the run snapshot, so this
      // arrives as a plain object rather than an Error. Stringifying it used to report
      // "[object Object]" and lose the only description of the failure.
      expect(failures[0]?.error.message).toContain('mailbox unreachable');
      expect(failures[0]?.error.stack).toContain('mailbox unreachable');

      failingScheduler.stop();
    });

    it('reports an unregistered workflow through onError rather than throwing', async () => {
      const failures: string[] = [];
      const unregisteredScheduler = new WorkflowScheduler(mastra, {
        onError: (_error, workflowId) => failures.push(workflowId),
      });

      await unregisteredScheduler.runNow('neverScheduledWorkflow');

      expect(failures).toEqual(['neverScheduledWorkflow']);
    });

    it('skips a tick while the previous run of the same workflow is still in flight', async () => {
      let releaseRun: (() => void) | undefined;
      const blocked = new Promise<void>((resolve) => {
        releaseRun = resolve;
      });
      let startedRuns = 0;

      const slowStep = createStep({
        id: 'slow-step',
        inputSchema: z.object({}),
        outputSchema: z.object({ result: z.string() }),
        execute: async () => {
          startedRuns++;
          await blocked;
          return { result: 'done' };
        },
      });
      const slowWorkflow = createWorkflow({
        id: 'slowWorkflow',
        inputSchema: z.object({}),
        outputSchema: z.object({ result: z.string() }),
      })
        .then(slowStep)
        .commit();

      const slowScheduler = new WorkflowScheduler(new Mastra({ workflows: { slowWorkflow } }));
      slowScheduler.schedule({ workflow: slowWorkflow, schedule: CronPatterns.EVERY_MINUTE });

      const firstRun = slowScheduler.runNow('slowWorkflow');
      // Let the first run reach the blocked step before the next tick lands on top of it.
      while (startedRuns === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }

      expect(await slowScheduler.runNow('slowWorkflow')).toBe(false);
      expect(startedRuns).toBe(1);

      releaseRun?.();
      expect(await firstRun).toBe(true);

      // The guard is released once the run finishes, so the next tick runs normally.
      expect(await slowScheduler.runNow('slowWorkflow')).toBe(true);
      expect(startedRuns).toBe(2);

      slowScheduler.stop();
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
