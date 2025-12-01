import { mastra } from './index.js';
import { CronPatterns, WorkflowScheduler } from './utils/workflow-scheduler.js';

/**
 * Configure scheduled workflows
 *
 * This file defines all workflows that should run on recurring schedules.
 * Add new scheduled workflows here to enable automatic execution.
 */
export function initializeScheduler(): WorkflowScheduler {
  const scheduler = new WorkflowScheduler(mastra, {
    timezone: 'Europe/Copenhagen',
    onError: (error, workflowId) => {
      console.error(`\n🚨 Scheduled workflow error: ${workflowId}`);
      console.error(`   ${error.message}`);
      // Future: Could integrate with error reporting processor
    },
  });

  // Weather monitoring - every hour
  scheduler.schedule({
    workflowId: 'weatherMonitoringWorkflow',
    schedule: CronPatterns.EVERY_HOUR,
    inputData: {},
  });

  // Weekly meal planning - every Sunday at 8am
  scheduler.schedule({
    workflowId: 'weeklyMealPlanningWorkflow',
    schedule: CronPatterns.WEEKLY_SUNDAY_8AM,
    inputData: {},
  });

  // Check for new emails - every 30 minutes
  scheduler.schedule({
    workflowId: 'checkForNewEmails',
    schedule: CronPatterns.EVERY_30_MINUTES,
    inputData: {},
  });

  // IoT device monitoring - every 5 minutes
  scheduler.schedule({
    workflowId: 'iotMonitoringWorkflow',
    schedule: CronPatterns.EVERY_5_MINUTES,
    inputData: {},
  });

  return scheduler;
}
