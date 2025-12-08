import { getMastra } from './index.js';
import { CronPatterns, WorkflowScheduler } from './utils/workflow-scheduler.js';
import {
  emailCheckingWorkflow,
  formRepliesDetectionWorkflow,
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
export async function initializeScheduler(): Promise<WorkflowScheduler> {
  const mastra = await getMastra();
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

  // Email checking - every minute
  // Checks for new emails and updates tracking (does NOT trigger state reactor)
  scheduler.schedule({
    workflow: emailCheckingWorkflow,
    schedule: CronPatterns.EVERY_MINUTE,
    inputData: {},
    runOnStartup: true,
  });

  // Form replies detection - every 3 hours
  // Processes form reply emails and triggers state reactor for notifications
  scheduler.schedule({
    workflow: formRepliesDetectionWorkflow,
    schedule: CronPatterns.EVERY_3_HOURS,
    inputData: {},
    runOnStartup: true,
  });

  // IoT device monitoring - every 3 hours
  // Polls Home Assistant for state changes, filters out devices/entities with 'sensitive' label.
  scheduler.schedule({
    workflow: iotMonitoringWorkflow,
    schedule: CronPatterns.EVERY_3_HOURS,
    inputData: {},
    runOnStartup: true,
  });

  return scheduler;
}
