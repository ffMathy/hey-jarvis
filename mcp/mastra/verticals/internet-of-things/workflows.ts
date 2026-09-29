import { z } from 'zod';
import { getEntityNoiseBaselineStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { fetchHistoricalStates } from './tools.js';

/**
 * Time window in seconds to look back for historical data when calculating noise baselines.
 * Set to 15 minutes to capture recent fluctuation patterns.
 */
const NOISE_BASELINE_HISTORY_SECONDS = 15 * 60;

// Calculate noise baselines from historical data
const calculateNoiseBaselines = createStep({
  id: 'calculate-noise-baselines',
  description:
    'Fetches historical state data and calculates noise baselines for entities to filter insignificant changes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    baselinesCalculated: z.number(),
    timestamp: z.string(),
  }),
  execute: async () => {
    const startTime = new Date(Date.now() - NOISE_BASELINE_HISTORY_SECONDS * 1000).toISOString();
    const endTime = new Date().toISOString();

    logger.info('Calculating noise baselines', {
      startTime,
      endTime,
      windowSeconds: NOISE_BASELINE_HISTORY_SECONDS,
    });

    const result = await fetchHistoricalStates({
      startTime,
      endTime,
      minimalResponse: true,
    });

    // Calculate baselines from history
    const storage = await getEntityNoiseBaselineStorage();
    const baselines = await storage.calculateBaselinesFromHistory(result.history);

    logger.info('Noise baselines calculated', {
      baselinesCalculated: baselines.length,
      entityCount: result.entityCount,
    });

    return {
      baselinesCalculated: baselines.length,
      timestamp: new Date().toISOString(),
    };
  },
});

// IoT Noise Baseline Workflow
// Recalculates how much each entity normally fluctuates, which the Home Assistant event
// monitor (./event-monitor.ts) uses to drop changes that are only noise. Detecting the
// changes themselves is the monitor's job, over the websocket API, rather than a schedule's.
export const iotNoiseBaselineWorkflow = createWorkflow({
  id: 'iotNoiseBaselineWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    baselinesCalculated: z.number(),
    timestamp: z.string(),
  }),
})
  .then(calculateNoiseBaselines)
  .commit();
