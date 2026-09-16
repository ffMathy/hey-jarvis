/**
 * Reading a plan run's event stream.
 *
 * This is the join between Mastra's chunks and what a poll reports, and it is the one part
 * of routing whose failure mode is silence: a mapping that matches nothing produces a
 * request that runs correctly, answers nothing, and closes with every delegation marked
 * unanswered. That is exactly how the previous implementation failed, so it is pinned here
 * rather than left to an integration run to discover.
 */

import { describe, expect, it } from 'bun:test';
import { asRoutingEvent, buildSnapshot, RoutingProgress } from './controller.js';
import { buildRoutingPlan } from './plan.js';

const PLAN = buildRoutingPlan('plan-under-test', [
  { delegations: [{ agentId: 'calendar', prompt: 'What is on my calendar?' }] },
  {
    delegations: [
      { agentId: 'internetOfThings', prompt: 'Where is the user?' },
      { agentId: 'weather', prompt: 'What is the weather there?' },
    ],
  },
]);

const CALENDAR_STEP = 'plan-under-test-chain-0-0-calendar';
const LOCATION_STEP = 'plan-under-test-chain-1-0-internetOfThings';
const WEATHER_STEP = 'plan-under-test-chain-1-1-weather';

/** A step result, the way a run emits one. */
function stepResult(id: string, output: unknown, status = 'success') {
  return { type: 'workflow-step-result', payload: { id, status, output } };
}

/** A plan run that has announced everything it intends to do, and done none of it yet. */
function startedPlan(): RoutingProgress {
  const progress = new RoutingProgress();
  for (const [delegationId, agentId] of PLAN.agentByStepId) {
    progress.handle({ type: 'delegation_start', delegationId, agentId });
  }
  return progress;
}

describe('reading a chunk off a plan run', () => {
  it('closes the delegation an agent step is', () => {
    expect(asRoutingEvent(stepResult(CALENDAR_STEP, { text: 'Dentist at four.' }), PLAN)).toEqual({
      type: 'delegation_end',
      delegationId: CALENDAR_STEP,
      result: { text: 'Dentist at four.' },
      isError: false,
    });
  });

  it('marks a step that did not succeed as a failed delegation', () => {
    const event = asRoutingEvent(stepResult(CALENDAR_STEP, { error: 'no' }, 'failed'), PLAN);

    expect(event).toMatchObject({ type: 'delegation_end', isError: true });
  });

  it('attributes a chain’s own result to the delegation that produced it', () => {
    // A chain's output is its last agent step's text, and it arrives whether or not the
    // chain's inner steps reach the parent stream.
    expect(asRoutingEvent(stepResult('chain-1', { text: 'It is 8 degrees.' }), PLAN)).toMatchObject({
      type: 'delegation_end',
      delegationId: WEATHER_STEP,
    });
  });

  it('ignores the plumbing steps, which are not delegations', () => {
    expect(asRoutingEvent(stepResult(`${CALENDAR_STEP}-prompt`, { prompt: 'hi' }), PLAN)).toBeUndefined();
  });

  it('ignores anything that is not a step result', () => {
    // `workflow-finish` in particular: a chain is a nested workflow sharing the root's
    // pubsub, so taking its finish for the request's would close the request the moment the
    // fastest chain was done.
    expect(asRoutingEvent({ type: 'workflow-finish', payload: { workflowStatus: 'success' } }, PLAN)).toBeUndefined();
    expect(asRoutingEvent({ type: 'workflow-start', payload: { workflowId: 'chain-0' } }, PLAN)).toBeUndefined();
    expect(asRoutingEvent('not a chunk at all', PLAN)).toBeUndefined();
  });
});

describe('a plan run, folded', () => {
  it('names every delegation as outstanding before a single step has run', () => {
    const snapshot = buildSnapshot(startedPlan());

    expect(snapshot.inProgress).toEqual(['calendar', 'internetOfThings', 'weather']);
    expect(snapshot.landed).toEqual([]);
    expect(snapshot.finished).toBe(false);
  });

  it('reports a delegation once, whichever event closes it first', () => {
    const progress = startedPlan();

    // The weather step's own result, then the chain's — the same answer, twice.
    for (const chunk of [
      stepResult(WEATHER_STEP, { text: 'It is 8 degrees.' }),
      stepResult('chain-1', { text: 'It is 8 degrees.' }),
    ]) {
      const event = asRoutingEvent(chunk, PLAN);
      if (event) {
        progress.handle(event);
      }
    }

    expect(buildSnapshot(progress).landed).toEqual([{ agentId: 'weather', result: 'It is 8 degrees.', failed: false }]);
  });

  it('closes out what the run never got to, rather than leaving the request unfinishable', () => {
    const progress = startedPlan();
    const answered = asRoutingEvent(stepResult(CALENDAR_STEP, { text: 'Dentist at four.' }), PLAN);
    if (answered) {
      progress.handle(answered);
    }

    progress.handle({ type: 'finished' });

    const snapshot = buildSnapshot(progress);
    expect(snapshot.finished).toBe(true);
    expect(snapshot.inProgress).toEqual([]);
    expect(snapshot.all.map((outcome) => `${outcome.agentId}:${outcome.failed}`)).toEqual([
      'calendar:false',
      'internetOfThings:true',
      'weather:true',
    ]);
  });

  it('is idle until something is planned, so a poll on a fresh session says nothing', () => {
    expect(new RoutingProgress().isIdle()).toBe(true);
    expect(startedPlan().isIdle()).toBe(false);
  });

  it('reports the location step separately when a chain’s inner results do reach the stream', () => {
    const progress = startedPlan();
    for (const chunk of [
      stepResult(LOCATION_STEP, { text: 'Aarhus.' }),
      stepResult(WEATHER_STEP, { text: 'It is 8 degrees.' }),
    ]) {
      const event = asRoutingEvent(chunk, PLAN);
      if (event) {
        progress.handle(event);
      }
    }

    expect(buildSnapshot(progress).landed.map((outcome) => outcome.agentId)).toEqual(['internetOfThings', 'weather']);
  });
});
