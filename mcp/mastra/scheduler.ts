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
 *
 * Note: Intervals have been increased to reduce Ollama queue pressure.
 * Each workflow triggers LLM inference, so frequent scheduling can overwhelm
 * the local Ollama instance.
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

  // Weather monitoring - every 2 hours (reduced from every hour)
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

  // Check for new emails - every hour (reduced from every 30 minutes)
  scheduler.schedule({
    workflow: checkForNewEmails,
    schedule: CronPatterns.EVERY_HOUR,
    inputData: {},
    runOnStartup: true,
  });

  // IoT device monitoring - every 30 minutes (reduced from every 5 minutes)
  // Note: Noisy attribute filtering in device-state.ts reduces false positives
  scheduler.schedule({
    workflow: iotMonitoringWorkflow,
    schedule: CronPatterns.EVERY_30_MINUTES,
    inputData: {},
    runOnStartup: true,
  });

  return scheduler;
}
