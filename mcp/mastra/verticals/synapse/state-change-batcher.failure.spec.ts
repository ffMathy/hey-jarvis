/**
 * What the batcher does when a batch fails.
 *
 * It drains its queue before doing any work, so anything thrown after that point used to
 * take the batch with it: not retried, not counted, and `totalProcessed` quietly stopped
 * matching `totalReceived`. The last thing a batch does is call a hosted model, and those
 * fail transiently — gemini-flash-latest returned HTTP 500 twice in ten minutes while
 * this was being written — so the failing path is a normal one, not an exotic one.
 *
 * The agent is mocked to fail on demand. Nothing here calls a real model.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';

/** Flipped by individual tests to make the batch's LLM call fail. */
let failures = 0;
let reactorCalls = 0;

mock.module('./agent.js', () => ({
  getStateChangeReactorAgent: async () => ({
    generate: async () => {
      reactorCalls++;
      if (failures > 0) {
        failures--;
        throw Object.assign(new Error('Internal error encountered.'), { statusCode: 500 });
      }
      return { text: 'Analyzed.' };
    },
  }),
}));

mock.module('../../memory/index.js', () => ({
  createMemory: async () => ({ saveMessages: async () => {} }),
}));

const { StateChangeBatcher } = await import('./state-change-batcher.js');

function change(id: number) {
  return { source: 'test', stateType: 'device_state_changed', stateData: { device: `lamp ${id}` } };
}

beforeEach(() => {
  failures = 0;
  reactorCalls = 0;
});

describe('a batch that fails', () => {
  it('keeps the state changes instead of losing them', async () => {
    // A very long delay so nothing is processed until flush() asks for it, which keeps
    // the test deterministic rather than racing a timer.
    const batcher = new StateChangeBatcher(600_000, 100);
    failures = 1;

    await batcher.add(change(1));
    await batcher.add(change(2));
    await batcher.flush();

    // The batch failed, so nothing was processed -- but the changes are still queued.
    expect(batcher.getStats().totalProcessed).toBe(0);
    expect(batcher.getPendingCount()).toBe(2);
    expect(batcher.getStats().droppedCount).toBe(0);
  });

  it('processes them on the next attempt', async () => {
    const batcher = new StateChangeBatcher(600_000, 100);
    failures = 1;

    await batcher.add(change(1));
    await batcher.flush();
    expect(batcher.getPendingCount()).toBe(1);

    await batcher.flush();

    expect(batcher.getStats().totalProcessed).toBe(1);
    expect(batcher.getPendingCount()).toBe(0);
    expect(reactorCalls).toBe(2);
  });

  it('does not wedge the batcher', async () => {
    const batcher = new StateChangeBatcher(600_000, 100);
    failures = 1;

    await batcher.add(change(1));
    await batcher.flush();

    // isProcessing has to be released even on the failing path, or every later change
    // is silently ignored.
    expect(batcher.getStats().isProcessing ?? false).toBe(false);
    await batcher.add(change(2));
    await batcher.flush();
    expect(batcher.getStats().totalProcessed).toBe(2);
  });

  it('does not rethrow, because no caller can do anything with it', async () => {
    const batcher = new StateChangeBatcher(600_000, 100);
    failures = 1;

    await batcher.add(change(1));

    // The callers are a timer, a full-batch push and flush(). The recovery is the
    // requeue, so an exception would only give them something they cannot handle.
    expect(batcher.flush()).resolves.toBeUndefined();
  });
});

describe('a batch that keeps failing', () => {
  it('gives up after the retry budget and counts what it dropped', async () => {
    const batcher = new StateChangeBatcher(600_000, 100, 3);
    failures = 99;

    await batcher.add(change(1));
    await batcher.flush();
    await batcher.flush();
    await batcher.flush();

    // Three attempts, then the change is abandoned -- and unlike before, the counter
    // that reports this to the agent actually moves.
    expect(batcher.getPendingCount()).toBe(0);
    expect(batcher.getStats().droppedCount).toBe(1);
    expect(batcher.getStats().totalProcessed).toBe(0);
  });

  it('respects a smaller retry budget', async () => {
    const batcher = new StateChangeBatcher(600_000, 100, 1);
    failures = 99;

    await batcher.add(change(1));
    await batcher.flush();

    // A budget of one means the first failure is the last.
    expect(batcher.getPendingCount()).toBe(0);
    expect(batcher.getStats().droppedCount).toBe(1);
  });
});

describe('the pending queue bound', () => {
  it('sheds the oldest changes rather than growing without limit', async () => {
    // Retrying means a sustained outage feeds changes back in, so the queue needs a
    // ceiling or a long outage becomes unbounded memory growth.
    const batcher = new StateChangeBatcher(600_000, 100, 3, 5);

    for (let index = 0; index < 8; index++) {
      await batcher.add(change(index));
    }

    expect(batcher.getPendingCount()).toBe(5);
    expect(batcher.getStats().droppedCount).toBe(3);
    // Newest survive: current state is more useful than stale state.
    expect(batcher.getStats().totalReceived).toBe(8);
  });
});

describe('a batch that succeeds', () => {
  it('still reports every change as processed', async () => {
    const batcher = new StateChangeBatcher(600_000, 100);

    await batcher.add(change(1));
    await batcher.add(change(2));
    await batcher.flush();

    expect(batcher.getStats().totalProcessed).toBe(2);
    expect(batcher.getStats().droppedCount).toBe(0);
    expect(batcher.getPendingCount()).toBe(0);
  });
});
