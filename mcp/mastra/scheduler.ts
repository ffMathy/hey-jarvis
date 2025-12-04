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
    },
  });

  // Weather monitoring - every 3 hours
  scheduler.schedule({
    workflow: weatherMonitoringWorkflow,
    schedule: CronPatterns.EVERY_3_HOURS,
    inputData: {},
  });

  // Weekly meal planning - every Sunday at 8am
  scheduler.schedule({
    workflow: weeklyMealPlanningWorkflow,
    schedule: CronPatterns.WEEKLY_SUNDAY_8AM,
    inputData: {},
  });

  // Check for new emails (form reply detection) - every minute
  // Quick detection of form replies for resuming suspended workflows
  // Looks back 1 hour, does NOT trigger state reactor
  scheduler.schedule({
    workflow: checkForNewEmails,
    schedule: CronPatterns.EVERY_MINUTE,
    inputData: { hoursAgo: 1, triggerStateReactor: false },
    runOnStartup: true,
  });

  // Check for new emails (state reactor) - every hour
  // Triggers the state reactor for new emails for notification analysis
  // Looks back 1 hour, DOES trigger state reactor
  scheduler.schedule({
    workflow: checkForNewEmails,
    schedule: CronPatterns.EVERY_HOUR,
    inputData: { hoursAgo: 1, triggerStateReactor: true },
  });

  // IoT device monitoring - every 3 hours
  // Polls Home Assistant for state changes, matching the old n8n behavior.
  // Filters out devices/entities with 'sensitive' label.
  scheduler.schedule({
    workflow: iotMonitoringWorkflow,
    schedule: CronPatterns.EVERY_3_HOURS,
    inputData: {},
    runOnStartup: true,
  });

  return scheduler;
}
