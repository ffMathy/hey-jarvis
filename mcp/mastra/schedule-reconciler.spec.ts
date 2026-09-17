/**
 * What reconciliation does to the stored schedule rows.
 *
 * Schedules now outlive the process that declared them, which is the whole point and also
 * the whole risk: a row nobody reconciles keeps firing forever, and a reconcile that is
 * too eager deletes rows it does not own. Both directions are covered here.
 *
 * These tests run against a real Mastra instance backed by a temporary LibSQL file. That
 * is still an offline, credential-free test -- the point is to exercise the actual
 * schedules storage rather than a fake whose behaviour we would be inventing.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { z } from 'zod';
import { reconcileSchedules } from './schedule-reconciler.js';
import { createStep, createWorkflow } from './utils/workflows/workflow-factory.js';

const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'scheduler-spec-'));

function noopWorkflow(id: string) {
  return createWorkflow({
    id,
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
  })
    .then(
      createStep({
        id: `${id}-step`,
        inputSchema: z.object({}),
        outputSchema: z.object({ ok: z.boolean() }),
        execute: async () => ({ ok: true }),
      }),
    )
    .commit();
}

const alphaWorkflow = noopWorkflow('alphaWorkflow');
const betaWorkflow = noopWorkflow('betaWorkflow');

let mastra: Mastra;
let databaseCounter = 0;

beforeEach(() => {
  // A fresh database per test, so one test's rows cannot decide another's outcome.
  databaseCounter++;
  mastra = new Mastra({
    storage: new LibSQLStore({
      id: 'scheduler-spec-storage',
      url: `file:${path.join(databaseDirectory, `schedules-${databaseCounter}.db`)}`,
    }),
    workflows: { alphaWorkflow, betaWorkflow },
  });
});

afterAll(async () => {
  await rm(databaseDirectory, { recursive: true, force: true });
});

/** The declared rows, as `list()` reports them back. */
async function storedWorkflowSchedules() {
  const schedules = await mastra.schedules.list();
  return schedules
    .filter((schedule) => schedule.workflowId !== undefined)
    .map((schedule) => ({
      workflowId: schedule.workflowId,
      cron: schedule.cron,
      timezone: schedule.timezone,
      status: schedule.status,
      managedBy: schedule.metadata?.managedBy,
    }));
}

describe('the first reconcile', () => {
  it('creates a row for every declared workflow', async () => {
    await reconcileSchedules(mastra.schedules, [
      { workflowId: 'alphaWorkflow', cron: '0 */3 * * *' },
      { workflowId: 'betaWorkflow', cron: '0 0 * * *' },
    ]);

    expect(await storedWorkflowSchedules()).toEqual([
      {
        workflowId: 'alphaWorkflow',
        cron: '0 */3 * * *',
        timezone: 'Europe/Copenhagen',
        status: 'active',
        managedBy: 'hey-jarvis-scheduler',
      },
      {
        workflowId: 'betaWorkflow',
        cron: '0 0 * * *',
        timezone: 'Europe/Copenhagen',
        status: 'active',
        managedBy: 'hey-jarvis-scheduler',
      },
    ]);
  });

  it('reports the row id for each workflow, so startup runs need no second lookup', async () => {
    const scheduleIds = await reconcileSchedules(mastra.schedules, [
      { workflowId: 'alphaWorkflow', cron: '0 */3 * * *' },
    ]);

    const [stored] = await mastra.schedules.list();
    expect(scheduleIds.get('alphaWorkflow')).toBe(stored.id);
  });
});

describe('reconciling again', () => {
  it('does not duplicate the rows it already created', async () => {
    const declarations = [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }];

    await reconcileSchedules(mastra.schedules, declarations);
    await reconcileSchedules(mastra.schedules, declarations);

    expect(await storedWorkflowSchedules()).toHaveLength(1);
  });

  it('keeps the row id stable, so its fire history survives a redeploy', async () => {
    const declarations = [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }];

    const first = await reconcileSchedules(mastra.schedules, declarations);
    const second = await reconcileSchedules(mastra.schedules, declarations);

    expect(second.get('alphaWorkflow')).toBe(first.get('alphaWorkflow'));
  });

  it('retimes a row whose declared cadence changed', async () => {
    await reconcileSchedules(mastra.schedules, [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }]);
    await reconcileSchedules(mastra.schedules, [{ workflowId: 'alphaWorkflow', cron: '* * * * *' }]);

    const [stored] = await storedWorkflowSchedules();
    expect(stored.cron).toBe('* * * * *');
  });

  it('resumes a schedule that was paused at runtime', async () => {
    // This file is what says whether a schedule should be running, so a runtime pause is
    // deliberately not permanent -- it lasts until the next deploy.
    const declarations = [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }];
    const scheduleIds = await reconcileSchedules(mastra.schedules, declarations);
    const scheduleId = scheduleIds.get('alphaWorkflow');
    if (!scheduleId) {
      throw new Error('expected a schedule id');
    }

    await mastra.schedules.pause(scheduleId);
    expect((await storedWorkflowSchedules())[0].status).toBe('paused');

    await reconcileSchedules(mastra.schedules, declarations);
    expect((await storedWorkflowSchedules())[0].status).toBe('active');
  });
});

describe('a declaration that was removed', () => {
  it('takes its stored row with it, instead of firing forever', async () => {
    await reconcileSchedules(mastra.schedules, [
      { workflowId: 'alphaWorkflow', cron: '0 */3 * * *' },
      { workflowId: 'betaWorkflow', cron: '0 0 * * *' },
    ]);

    await reconcileSchedules(mastra.schedules, [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }]);

    expect((await storedWorkflowSchedules()).map((schedule) => schedule.workflowId)).toEqual(['alphaWorkflow']);
  });
});

describe('a schedule this file does not own', () => {
  it('is left alone by the sweep', async () => {
    // Anything created at runtime, or by another feature, carries no managedBy tag. The
    // sweep has to be able to tell the difference, or every deploy would delete it.
    const foreign = await mastra.schedules.create({
      workflowId: 'betaWorkflow',
      cron: '0 9 * * *',
      inputData: {},
    });

    await reconcileSchedules(mastra.schedules, [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }]);

    const survivors = await mastra.schedules.list();
    expect(survivors.map((schedule) => schedule.id)).toContain(foreign.id);
  });

  it('is not mistaken for the declared row, so both end up stored', async () => {
    await mastra.schedules.create({
      workflowId: 'alphaWorkflow',
      cron: '0 9 * * *',
      inputData: {},
    });

    await reconcileSchedules(mastra.schedules, [{ workflowId: 'alphaWorkflow', cron: '0 */3 * * *' }]);

    const stored = await storedWorkflowSchedules();
    expect(stored).toHaveLength(2);
    expect(stored.filter((schedule) => schedule.managedBy === 'hey-jarvis-scheduler')).toHaveLength(1);
  });
});
