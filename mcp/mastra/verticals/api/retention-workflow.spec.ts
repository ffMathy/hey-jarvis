/**
 * Storage retention.
 *
 * `cleanupOldRecords` had existed and been tested since token accounting was added, but
 * nothing outside its own tests ever called it, so `token_usage` grew for the life of the
 * database — one row per model call, on a device that is never switched off. The workflow
 * under test is the caller.
 *
 * Real storage against a temporary database, no module mocking: substituting
 * `storage/index.js` would replace the singleton for every spec file that runs afterwards
 * in the same process, since bun's mock.module is process-global.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { TokenUsageStorage } from '../../storage/token-usage.js';
import { storageRetentionWorkflow } from './retention-workflow.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let databaseDirectory: string;
let storage: TokenUsageStorage;

/**
 * Records usage now.
 *
 * `recordUsage` stamps its own timestamp, so age is expressed by moving the cutoff
 * rather than the record — the same approach tests/token-usage-storage.spec.ts takes.
 */
async function record(model = 'gemini-flash-latest') {
  await storage.recordUsage({ model, provider: 'google', promptTokens: 100, completionTokens: 50 });
}

beforeEach(async () => {
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'retention-'));
  storage = new TokenUsageStorage(path.join(databaseDirectory, 'usage.db'));
});

afterEach(async () => {
  await storage.close();
  await rm(databaseDirectory, { force: true, recursive: true });
});

describe('the retention window', () => {
  it('deletes every record older than the cutoff', async () => {
    await record();
    await record();

    const deleted = await storage.cleanupOldRecords(new Date(Date.now() + DAY_MS));

    expect(deleted).toBe(2);
    expect(await storage.getRecentUsage(10)).toEqual([]);
  });

  it('keeps records inside the window', async () => {
    await record();

    // A 90 day window against a record written seconds ago keeps it, which is the case
    // that matters: the nightly job must not delete live data.
    expect(await storage.cleanupOldRecords(new Date(Date.now() - 90 * DAY_MS))).toBe(0);
    expect(await storage.getRecentUsage(10)).toHaveLength(1);
  });

  it('is safe to run when there is nothing stored at all', async () => {
    expect(await storage.cleanupOldRecords(new Date())).toBe(0);
  });

  it('is idempotent, so a nightly schedule cannot compound', async () => {
    await record();
    const cutoff = new Date(Date.now() + DAY_MS);

    expect(await storage.cleanupOldRecords(cutoff)).toBe(1);
    expect(await storage.cleanupOldRecords(cutoff)).toBe(0);
  });
});

describe('the workflow wiring', () => {
  it('is registered under the id the scheduler looks up', () => {
    // WorkflowScheduler.schedule() throws when the id is not registered with Mastra, so
    // a rename here has to stay in step with mastra/index.ts.
    expect(storageRetentionWorkflow.id).toBe('storageRetentionWorkflow');
  });

  it('takes no input, so it can be scheduled with an empty payload', () => {
    expect(storageRetentionWorkflow.inputSchema.safeParse({}).success).toBe(true);
  });

  it('reports what it deleted, so a nightly run is auditable', () => {
    const parsed = storageRetentionWorkflow.outputSchema.safeParse({
      tokenUsageRecordsDeleted: 3,
      cutoff: new Date().toISOString(),
    });

    expect(parsed.success).toBe(true);
  });
});
