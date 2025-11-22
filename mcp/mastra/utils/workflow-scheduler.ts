import cron, { type ScheduledTask } from 'node-cron';
import type { Mastra } from '@mastra/core';
import type { Workflow } from '@mastra/core/workflows';

interface ScheduledWorkflow {
  workflowId: string;
  schedule: string;
  inputData?: Record<string, any>;
  name?: string;
}

interface SchedulerOptions {
  timezone?: string;
  onError?: (error: Error, workflowId: string) => void;
}

/**
 * Workflow Scheduler for Mastra
 * 
 * Enables cron-based scheduling of Mastra workflows using node-cron.
 * 
 * @example
 * ```typescript
 * const scheduler = new WorkflowScheduler(mastra);
 * 
 * // Schedule weather monitoring every hour
 * scheduler.schedule({
 *   workflowId: 'weatherMonitoringWorkflow',
 *   schedule: '0 * * * *', // Every hour at minute 0
 *   name: 'Hourly Weather Check'
 * });
 * 
 * // Schedule meal planning every Sunday at 8am
 * scheduler.schedule({
 *   workflowId: 'weeklyMealPlanningWorkflow',
 *   schedule: '0 8 * * 0', // Sundays at 8:00am
 *   name: 'Weekly Meal Plan'
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
  private options: SchedulerOptions;

  constructor(mastra: Mastra, options: SchedulerOptions = {}) {
    this.mastra = mastra;
    this.options = {
      timezone: options.timezone || 'Europe/Copenhagen',
      onError: options.onError || this.defaultErrorHandler,
    };
  }

  /**
   * Schedule a workflow to run on a recurring cron schedule
   */
  schedule(config: ScheduledWorkflow): void {
    const { workflowId, schedule, inputData = {}, name } = config;

    // Validate cron expression
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron expression: ${schedule}`);
    }

    // Check if workflow exists
    const workflow = this.mastra.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Create scheduled task
    const task = cron.schedule(
      schedule,
      async () => {
        await this.executeWorkflow(workflowId, inputData, name);
      },
      {
        timezone: this.options.timezone,
      }
    );

    // Store task reference
    this.scheduledTasks.set(workflowId, task);

    console.log(`📅 Scheduled workflow: ${name || workflowId}`);
    console.log(`   Schedule: ${schedule} (${this.options.timezone})`);
  }

  /**
   * Start all scheduled workflows
   */
  start(): void {
    console.log(`\n🚀 ${this.scheduledTasks.size} scheduled workflow(s) are now active`);
    
    this.scheduledTasks.forEach((task, workflowId) => {
      console.log(`   ✅ Active: ${workflowId}`);
    });

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
   * Execute a workflow
   */
  private async executeWorkflow(
    workflowId: string,
    inputData: Record<string, any>,
    name?: string
  ): Promise<void> {
    const startTime = Date.now();
    console.log(`\n⚙️  Executing scheduled workflow: ${name || workflowId}`);
    console.log(`   Time: ${new Date().toISOString()}`);

    try {
      const workflow = this.mastra.getWorkflow(workflowId);
      const run = await workflow.createRun();
      const result = await run.start({ inputData });

      const duration = Date.now() - startTime;
      console.log(`✅ Workflow completed successfully (${duration}ms)`);
      console.log(`   Status: ${result.status}`);
      
      // Log result if it's not too large and workflow succeeded
      if (result.status === 'success' && result.result && JSON.stringify(result.result).length < 500) {
        console.log(`   Result:`, result.result);
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Workflow failed (${duration}ms):`, error);
      
      if (this.options.onError && error instanceof Error) {
        this.options.onError(error, workflowId);
      }
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
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY_AT_MIDNIGHT: '0 0 * * *',
  DAILY_AT_NOON: '0 12 * * *',
  DAILY_AT_8AM: '0 8 * * *',
  WEEKLY_SUNDAY_8AM: '0 8 * * 0',
  WEEKLY_MONDAY_9AM: '0 9 * * 1',
  MONTHLY_FIRST_DAY: '0 0 1 * *',
} as const;
