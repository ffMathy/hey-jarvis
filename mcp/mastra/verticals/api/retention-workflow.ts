import { z } from 'zod';
import { getMastraStorageProvider, getTokenUsageStorage } from '../../storage/index.js';
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
 * What one run of the workflow deleted.
 *
 * `mastraRowsDeleted` counts rows across every Mastra-owned table with a policy, so a
 * run that trims spans and workflow snapshots reports one number rather than a shape
 * that changes with the retention config.
 */
const retentionResultSchema = z.object({
  tokenUsageRecordsDeleted: z.number(),
  mastraRowsDeleted: z.number(),
  cutoff: z.string(),
});

/**
 * Deletes records past their retention window.
 *
 * `cleanupOldRecords` has existed and been tested since token accounting was added, but
 * nothing ever called it outside its own tests, so `token_usage` grew for the life of
 * the database — one row per model call, on a device that is never turned off. This is
 * the caller. Mastra's own append-only tables grow the same way now that it has a
 * durable store, so they are pruned here too.
 */
export const storageRetentionWorkflow = createWorkflow({
  id: 'storageRetentionWorkflow',
  description: 'Deletes storage records that have passed their retention window',
  inputSchema: z.object({}),
  outputSchema: retentionResultSchema,
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
  .then(
    createStep({
      id: 'prune-mastra-storage',
      description: "Deletes rows past the retention policies declared on Mastra's own storage",
      inputSchema: z.object({
        tokenUsageRecordsDeleted: z.number(),
        cutoff: z.string(),
      }),
      outputSchema: retentionResultSchema,
      /**
       * Prunes the tables Mastra fills on its own.
       *
       * `prune()` deletes in bounded, resumable batches and reports `done: false` when
       * eligible rows remain, so an overdue first run cannot lock the database for the
       * length of a full backlog — whatever is left goes on the next nightly tick.
       */
      execute: async ({ inputData }) => {
        const storage = await getMastraStorageProvider();
        const results = await storage.prune();
        const mastraRowsDeleted = results.reduce((total, result) => total + result.deleted, 0);

        logger.info('[RETENTION] Pruned Mastra storage', {
          mastraRowsDeleted,
          tables: results.map(({ domain, table, deleted, done }) => ({ domain, table, deleted, done })),
          hasMore: results.some(({ done }) => !done),
        });

        return { ...inputData, mastraRowsDeleted };
      },
    }),
  )
  .commit();
