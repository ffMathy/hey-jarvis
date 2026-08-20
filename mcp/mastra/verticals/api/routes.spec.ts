/**
 * On a failed run the API layer's only job is to tell the caller why it failed.
 *
 * Mastra serialises the error before the result leaves the engine, so the field the
 * handler reads holds a plain object rather than the `Error` its type promises. The
 * shapes `extractErrorMessage` has to understand are pinned next to it in
 * `utils/errors.spec.ts`; these tests pin what a real failing run actually produces.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createStep, createWorkflow, getWorkflowRuntime } from '../../utils/workflows/workflow-factory.js';
import { extractWorkflowError } from './routes.js';

const FAILURE_MESSAGE = 'the fridge is on fire';

const failingStep = createStep({
  id: 'always-fails',
  description: 'Throws, so the run ends in the failed state.',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async () => {
    throw new Error(FAILURE_MESSAGE);
  },
});

const failingWorkflow = createWorkflow({
  id: 'failingWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
})
  .then(failingStep)
  .commit();

async function runFailingWorkflow() {
  const run = await failingWorkflow.createRun();
  return await run.start({ inputData: {} });
}

const suspendingStep = createStep({
  id: 'always-suspends',
  description: 'Suspends, so the run ends without an error to report.',
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  suspendSchema: z.object({}),
  execute: async ({ suspend }) => await suspend({}),
});

// Suspending persists a run snapshot, which needs a Mastra instance to persist through.
const suspendingWorkflow = createWorkflow({
  id: 'suspendingWorkflow',
  mastra: getWorkflowRuntime(),
  inputSchema: z.object({}),
  outputSchema: z.object({}),
})
  .then(suspendingStep)
  .commit();

describe('extractWorkflowError', () => {
  it('surfaces the step failure from a real failed run', async () => {
    const result = await runFailingWorkflow();

    expect(result.status).toBe('failed');
    expect(extractWorkflowError(result)).toBe(FAILURE_MESSAGE);
  });

  it('gets a plain object rather than an Error, which is why the naive check lost the message', async () => {
    const result = await runFailingWorkflow();

    if (result.status !== 'failed') {
      throw new Error(`Expected the run to fail, but it reported ${result.status}.`);
    }

    // Mastra's types promise an `Error` here, but `toJSON` has already run by the time
    // the result reaches us, so an `instanceof Error` check finds nothing to report.
    expect(result.error).not.toBeInstanceOf(Error);
    expect(result.error).toMatchObject({ message: FAILURE_MESSAGE, name: 'Error' });
  });

  it('falls back to the status when the result carries no error at all', async () => {
    // A suspended run is the everyday non-success result with nothing to explain.
    const run = await suspendingWorkflow.createRun();
    const result = await run.start({ inputData: {} });

    expect(result.status).toBe('suspended');
    expect(extractWorkflowError(result)).toBe('Workflow failed with status suspended');
  });
});
