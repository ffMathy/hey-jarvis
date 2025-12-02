import { mastra } from './index.js';
import { CronPatterns, WorkflowScheduler } from './utils/workflow-scheduler.js';
import {
  checkForNewEmails,
  iotMonitoringWorkflow,
  weatherMonitoringWorkflow,
  weeklyMealPlanningWorkflow,
} from './verticals/index.js';

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

  // Weather monitoring - every 2 hours
  scheduler.schedule({
    workflow: weatherMonitoringWorkflow,
    schedule: CronPatterns.EVERY_2_HOURS,
    inputData: {},
  });

  // Weekly meal planning - every Sunday at 8am
  scheduler.schedule({
    workflow: weeklyMealPlanningWorkflow,
    schedule: CronPatterns.WEEKLY_SUNDAY_8AM,
    inputData: {},
  });

  // Check for new emails - every hour
  scheduler.schedule({
    workflow: checkForNewEmails,
    schedule: CronPatterns.EVERY_HOUR,
    inputData: {},
    runOnStartup: true,
  });

  // IoT device monitoring - every minute
  // Polls Home Assistant for state changes in the last 60 seconds,
  // matching the old n8n behavior. Filters out devices/entities with 'sensitive' label.
  scheduler.schedule({
    workflow: iotMonitoringWorkflow,
    schedule: CronPatterns.EVERY_MINUTE,
    inputData: {},
    runOnStartup: true,
  });

  return scheduler;
}
