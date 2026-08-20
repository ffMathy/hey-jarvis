import { z } from 'zod';
import { getTokenUsageStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';

/**
 * How long per-request token usage rows are kept.
 *
 * Long enough to answer "what did last month cost, and what changed", short enough that
 * an always-on device does not accumulate a row per model call indefinitely. The
 * aggregate a quota check needs is recomputed from what remains, so trimming the tail
 * does not affect enforcement.
 */
const TOKEN_USAGE_RETENTION_DAYS = 90;

/**
 * Deletes token usage records past their retention window.
 *
 * `cleanupOldRecords` has existed and been tested since token accounting was added, but
 * nothing ever called it outside its own tests, so `token_usage` grew for the life of
 * the database — one row per model call, on a device that is never turned off. This is
 * the caller.
 */
export const storageRetentionWorkflow = createWorkflow({
  id: 'storageRetentionWorkflow',
  description: 'Deletes storage records that have passed their retention window',
  inputSchema: z.object({}),
  outputSchema: z.object({
    tokenUsageRecordsDeleted: z.number(),
    cutoff: z.string(),
  }),
})
  .then(
    createStep({
      id: 'prune-token-usage',
      description: `Deletes token usage rows older than ${TOKEN_USAGE_RETENTION_DAYS} days`,
      inputSchema: z.object({}),
      outputSchema: z.object({
        tokenUsageRecordsDeleted: z.number(),
        cutoff: z.string(),
      }),
      execute: async () => {
        const cutoff = new Date(Date.now() - TOKEN_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const storage = await getTokenUsageStorage();
        const tokenUsageRecordsDeleted = await storage.cleanupOldRecords(cutoff);

        logger.info('[RETENTION] Pruned token usage records', {
          tokenUsageRecordsDeleted,
          cutoff: cutoff.toISOString(),
          retentionDays: TOKEN_USAGE_RETENTION_DAYS,
        });

        return { tokenUsageRecordsDeleted, cutoff: cutoff.toISOString() };
      },
    }),
  )
  .commit();
