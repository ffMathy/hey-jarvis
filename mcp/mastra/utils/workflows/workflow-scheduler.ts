import type { Mastra } from '@mastra/core';
import cron, { type ScheduledTask } from 'node-cron';

interface ScheduledWorkflow {
  workflow: { id: string };
  schedule: string;
  inputData?: Record<string, unknown>;
  runOnStartup?: boolean;
}

interface SchedulerOptions {
  timezone?: string;
  onError?: (error: Error, workflowId: string) => void;
}

/**
 * An `Error` for a value that may not be one.
 *
 * A failed run does not hand back the Error its step threw: Mastra serializes it on the way
 * through the run snapshot, so `result.error` arrives as a plain object that still carries
 * `message` and `stack`. Passing that through `String(...)` yields `[object Object]` and
 * throws away the only account of what went wrong.
 */
function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string') {
    const error = new Error(value.message);
    if ('name' in value && typeof value.name === 'string') {
      error.name = value.name;
    }
    if ('stack' in value && typeof value.stack === 'string') {
      error.stack = value.stack;
    }
    return error;
  }

  return new Error(String(value));
}

/**
 * Workflow Scheduler for Mastra
 *
 * Enables cron-based scheduling of Mastra workflows using node-cron.
 *
 * @example
 * ```typescript
 * import { weatherMonitoringWorkflow, weeklyMealPlanningWorkflow } from './verticals';
 *
 * const scheduler = new WorkflowScheduler(mastra);
 *
 * // Schedule weather monitoring every hour
 * scheduler.schedule({
 *   workflow: weatherMonitoringWorkflow,
 *   schedule: '0 * * * *', // Every hour at minute 0
 * });
 *
 * // Schedule meal planning every Sunday at 8am
 * scheduler.schedule({
 *   workflow: weeklyMealPlanningWorkflow,
 *   schedule: '0 8 * * 0', // Sundays at 8:00am
 * });
 *
 * // Start all scheduled workflows
 * scheduler.start();
 * ```
 *
 * Cron format: * * * * *
 *              │ │ │ │ │
 *              │ │ │ │ └─ Day of week (0-6, Sunday = 0)
 *              │ │ │ └─── Month (1-12)
 *              │ │ └───── Day of month (1-31)
 *              │ └─────── Hour (0-23)
 *              └───────── Minute (0-59)
 */
export class WorkflowScheduler {
  private mastra: Mastra;
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private scheduledInputData: Map<string, Record<string, unknown>> = new Map();
  /** Workflows to run once as soon as {@link start} is called. */
  private startupWorkflows: Set<string> = new Set();
  /** Workflows with a tick still in flight. See {@link runNow}. */
  private runningWorkflows: Set<string> = new Set();
  private options: SchedulerOptions;

  constructor(mastra: Mastra, options: SchedulerOptions = {}) {
    this.mastra = mastra;
    this.options = {
      timezone: options.timezone || 'Europe/Copenhagen',
      onError: options.onError ?? ((error, workflowId) => this.defaultErrorHandler(error, workflowId)),
    };
  }

  /**
   * Schedule a workflow to run on a recurring cron schedule
   */
  schedule(config: ScheduledWorkflow): void {
    const { workflow, schedule, inputData = {}, runOnStartup = false } = config;
    const workflowId = workflow.id;

    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron expression: ${schedule}`);
    }

    // Check if workflow is registered in Mastra
    const registeredWorkflow = this.mastra.getWorkflow(workflowId);
    if (!registeredWorkflow) {
      throw new Error(`Workflow not found in Mastra: ${workflowId}`);
    }

    // Create scheduled task
    const task = cron.schedule(
      schedule,
      async () => {
        await this.runNow(workflowId);
      },
      {
        timezone: this.options.timezone,
      },
    );

    // Store task reference
    this.scheduledTasks.set(workflowId, task);
    this.scheduledInputData.set(workflowId, inputData);

    // Track startup workflows
    if (runOnStartup) {
      this.startupWorkflows.add(workflowId);
    }

    console.log(`📅 Scheduled workflow: ${workflowId}`);
    console.log(`   Schedule: ${schedule} (${this.options.timezone})`);
    if (runOnStartup) {
      console.log(`   Run on startup: enabled`);
    }
  }

  /**
   * Start all scheduled workflows
   */
  start(): void {
    console.log(`\n🚀 ${this.scheduledTasks.size} scheduled workflow(s) are now active`);

    this.scheduledTasks.forEach((_task, workflowId) => {
      console.log(`   ✅ Active: ${workflowId}`);
    });

    // Execute startup workflows immediately (don't await - run in background)
    if (this.startupWorkflows.size > 0) {
      console.log(`\n🏃 Executing ${this.startupWorkflows.size} startup workflow(s)...`);
      this.startupWorkflows.forEach((workflowId) => {
        console.log(`   🚀 Running on startup: ${workflowId}`);
        void this.runNow(workflowId);
      });
    }

    console.log('\n⏰ Workflow scheduler is running\n');
  }

  /**
   * Stop all scheduled workflows
   */
  stop(): void {
    console.log('\n🛑 Stopping workflow scheduler...');

    this.scheduledTasks.forEach((task, workflowId) => {
      task.stop();
      console.log(`   ⏹️  Stopped: ${workflowId}`);
    });

    console.log('\n✅ Workflow scheduler stopped\n');
  }

  /**
   * Stop a specific workflow schedule
   */
  stopWorkflow(workflowId: string): void {
    const task = this.scheduledTasks.get(workflowId);
    if (task) {
      task.stop();
      this.scheduledTasks.delete(workflowId);
      this.scheduledInputData.delete(workflowId);
      this.startupWorkflows.delete(workflowId);
      console.log(`⏹️  Stopped workflow: ${workflowId}`);
    }
  }

  /**
   * Get list of all scheduled workflows
   */
  getScheduledWorkflows(): string[] {
    return Array.from(this.scheduledTasks.keys());
  }

  /**
   * Runs a scheduled workflow immediately, exactly as a cron tick would.
   *
   * A tick is skipped while the previous run of the same workflow is still in flight.
   * `node-cron` fires on the clock regardless of how long the last callback took, so
   * without this a workflow scheduled every minute — `emailCheckingWorkflow` is — starts a
   * second run whenever one takes longer than a minute. Those overlapping runs duplicate
   * whatever the workflow does, and each one that the process outlives is left behind in
   * storage as an active run for Mastra to try (and fail) to restart on the next boot.
   *
   * Anything the run throws is reported through the scheduler's `onError` handler rather
   * than escaping into the cron callback, where it would surface as an unhandled rejection
   * with no workflow name attached.
   *
   * @returns whether the workflow ran; `false` means the tick was skipped.
   */
  async runNow(workflowId: string): Promise<boolean> {
    if (this.runningWorkflows.has(workflowId)) {
      console.warn(`⏭️  Skipped scheduled run of ${workflowId}: the previous run is still in flight`);
      return false;
    }

    this.runningWorkflows.add(workflowId);
    try {
      await this.executeWorkflow(workflowId, this.scheduledInputData.get(workflowId) ?? {});
    } catch (error) {
      this.options.onError?.(toError(error), workflowId);
    } finally {
      this.runningWorkflows.delete(workflowId);
    }

    return true;
  }

  /**
   * Execute a workflow
   */
  private async executeWorkflow(workflowId: string, inputData: Record<string, unknown>): Promise<void> {
    const startTime = Date.now();
    console.log(`\n⚙️  Executing scheduled workflow: ${workflowId}`);
    console.log(`   Time: ${new Date().toISOString()}`);

    const workflow = this.mastra.getWorkflow(workflowId);
    const run = await workflow.createRun();
    const result = await run.start({ inputData });

    const duration = Date.now() - startTime;

    // A failed run used to be announced as "✅ Workflow completed successfully" with the
    // real status on the line below it, so the only record of a scheduled workflow failing
    // was a green checkmark.
    if (result.status === 'failed') {
      throw toError(result.error);
    }

    if (result.status !== 'success') {
      console.warn(`⚠️  Workflow ${workflowId} did not finish (${duration}ms)`);
      console.warn(`   Status: ${result.status}`);
      return;
    }

    console.log(`✅ Workflow completed successfully (${duration}ms)`);

    // Log result if it's not too large
    if (result.result && JSON.stringify(result.result).length < 500) {
      console.log(`   Result:`, result.result);
    }
  }

  /**
   * Default error handler
   */
  private defaultErrorHandler(error: Error, workflowId: string): void {
    console.error(`\n🚨 Error in scheduled workflow: ${workflowId}`);
    console.error(`   Message: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
  }
}

/**
 * Helper function to validate cron expressions
 */
export function validateCronExpression(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * Common cron schedule patterns
 */
export const CronPatterns = {
  EVERY_MINUTE: '* * * * *',
  EVERY_5_MINUTES: '*/5 * * * *',
  EVERY_15_MINUTES: '*/15 * * * *',
  EVERY_30_MINUTES: '*/30 * * * *',
  EVERY_HOUR: '0 * * * *',
  EVERY_2_HOURS: '0 */2 * * *',
  EVERY_3_HOURS: '0 */3 * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY_AT_MIDNIGHT: '0 0 * * *',
  DAILY_AT_NOON: '0 12 * * *',
  DAILY_AT_8AM: '0 8 * * *',
  WEEKLY_SUNDAY_8AM: '0 8 * * 0',
  WEEKLY_MONDAY_9AM: '0 9 * * 1',
  MONTHLY_FIRST_DAY: '0 0 1 * *',
} as const;
