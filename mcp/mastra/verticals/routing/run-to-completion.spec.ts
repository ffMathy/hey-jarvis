/**
 * Running a request to completion with nobody on the line. The routing runtime is replaced by one
 * whose request plays a script against a real `RoutingProgress` — the same events a plan run folds
 * in — so the snapshots read here are the ones routing really builds.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { getWorkflowRuntime } from '../../utils/workflows/workflow-factory.js';
import {
  buildSnapshot,
  RoutingProgress,
  type RoutingRuntime,
  resetRoutingRuntime,
  setRoutingRuntime,
} from './controller.js';
import { runRequestToCompletion } from './run-to-completion.js';

const SESSION_ID = 'glance-actions';

/** A runtime whose every request is carried out by `script`, or left running when it never finishes. */
function scriptedRuntime(script: (progress: RoutingProgress) => void, finishes = true) {
  const started: Array<{ sessionId: string; request: string }> = [];
  const progressBySessionId = new Map<string, RoutingProgress>();
  const runtime: RoutingRuntime = {
    async start(sessionId, request) {
      started.push({ sessionId, request });
      const progress = new RoutingProgress();
      progressBySessionId.set(sessionId, progress);
      script(progress);
      if (finishes) {
        progress.handle({ type: 'finished' });
      }
    },
    async poll(sessionId) {
      return buildSnapshot(progressBySessionId.get(sessionId) ?? new RoutingProgress());
    },
    async waitForChange() {},
    async finishesWithin(sessionId) {
      return progressBySessionId.get(sessionId)?.isFinished() ?? false;
    },
    async notifyWhenDone() {
      return false;
    },
  };
  setRoutingRuntime(runtime);
  return started;
}

function delegate(progress: RoutingProgress, agentId: string, result: unknown, isError = false): void {
  const delegationId = `plan-chain-0-1-${agentId}`;
  progress.handle({ type: 'delegation_start', delegationId, taskId: agentId, agentId });
  progress.handle({ type: 'delegation_end', delegationId, result, isError });
}

afterEach(() => {
  resetRoutingRuntime();
});

describe('runRequestToCompletion', () => {
  it('routes the request in its own session and answers with what the agents said', async () => {
    const started = scriptedRuntime((progress) =>
      delegate(progress, 'internetOfThings', { text: 'The front door is unlocked, sir.' }),
    );

    const outcome = await runRequestToCompletion(getWorkflowRuntime(), 'Unlock the front door', {
      sessionId: SESSION_ID,
    });

    expect(started).toEqual([{ sessionId: SESSION_ID, request: 'Unlock the front door' }]);
    expect(outcome).toEqual({ ok: true, message: 'The front door is unlocked, sir.' });
  });

  it('reports a delegation that failed as a failure', async () => {
    scriptedRuntime((progress) => delegate(progress, 'internetOfThings', 'Home Assistant refused the call', true));

    const outcome = await runRequestToCompletion(getWorkflowRuntime(), 'Unlock the front door', {
      sessionId: SESSION_ID,
    });

    expect(outcome.ok).toBe(false);
  });

  it('says why a request that failed outright could not be done', async () => {
    scriptedRuntime((progress) => progress.fail('no agent can handle this request'));

    const outcome = await runRequestToCompletion(getWorkflowRuntime(), 'Make me a sandwich', {
      sessionId: SESSION_ID,
    });

    expect(outcome).toEqual({ ok: false, message: 'That could not be done: no agent can handle this request' });
  });

  it('says it is still working on a request that outlives its deadline', async () => {
    scriptedRuntime(() => undefined, false);

    const outcome = await runRequestToCompletion(getWorkflowRuntime(), 'Open the garage door', {
      sessionId: SESSION_ID,
      deadlineMs: 10,
    });

    expect(outcome).toEqual({
      ok: false,
      message: 'This is taking longer than expected; Jarvis is still working on it.',
    });
  });

  it('keeps a long answer short enough for a button', async () => {
    scriptedRuntime((progress) => delegate(progress, 'calendar', { text: 'word '.repeat(200) }));

    const outcome = await runRequestToCompletion(getWorkflowRuntime(), 'What is on today?', {
      sessionId: SESSION_ID,
    });

    expect(outcome.message.length).toBeLessThanOrEqual(280);
    expect(outcome.message.endsWith('…')).toBe(true);
  });
});
