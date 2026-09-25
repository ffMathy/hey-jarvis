/**
 * A routing request, end to end, against the real instance.
 *
 * Everything between the request and the answer is exercised here and nowhere else: the
 * planner writes a plan, Mastra validates and registers it as a workflow, the run drives the
 * registered agents, and the poll loop reports what comes back. The unit specs cover the
 * folding rules with hand-fed events; this is the one place that finds out whether a plan
 * this code generates is one Mastra will actually run.
 *
 * It is an integration spec because it needs a model and the agents' own credentials.
 */

import { describe, expect, it } from 'bun:test';
import { mastra } from '../../index.js';
import { getRoutingRuntime, rememberMastraRegistry } from './controller.js';
import { getRoutableAgentIds, PLANNER_AGENT_ID, planDelegations } from './planner.js';

const WEATHER_QUESTION = 'What is the current weather in Aarhus, Denmark?';

/** Long enough for a plan that runs several agents; short enough to fail rather than hang. */
const TIMEOUT_MS = 120_000;

/** Polls the way Jarvis does, until the request closes or the deadline runs out. */
async function routeAndWait(sessionId: string, userQuery: string, timeoutMs: number) {
  rememberMastraRegistry(mastra);
  const runtime = getRoutingRuntime();
  await runtime.start(sessionId, userQuery);

  const deadlineAt = Date.now() + timeoutMs;
  const collected: { agentId: string; result: string; failed: boolean }[] = [];

  while (Date.now() < deadlineAt) {
    const snapshot = await runtime.poll(sessionId);
    collected.push(...snapshot.landed);
    if (snapshot.finished) {
      return { ...snapshot, collected };
    }
    await runtime.waitForChange(sessionId, 1_000);
  }

  throw new Error(`routing did not finish within ${timeoutMs}ms`);
}

describe('the planner', () => {
  it(
    'names only agents that exist, so the plan is one that can be registered',
    async () => {
      const { chains } = await planDelegations(mastra.getAgentById(PLANNER_AGENT_ID), WEATHER_QUESTION);
      const known = await getRoutableAgentIds();

      expect(chains.length).toBeGreaterThan(0);
      for (const chain of chains) {
        for (const delegation of chain.delegations) {
          expect(known.has(delegation.agentId)).toBe(true);
          expect(delegation.prompt.length).toBeGreaterThan(0);
        }
      }
    },
    TIMEOUT_MS,
  );
});

describe('a routing request', () => {
  it(
    'plans, registers and runs a plan that answers the question',
    async () => {
      const outcome = await routeAndWait('plan-run-spec', WEATHER_QUESTION, TIMEOUT_MS);

      expect(outcome.error).toBeUndefined();
      expect(outcome.inProgress).toEqual([]);
      expect(outcome.all.length).toBeGreaterThan(0);

      // The agents have no weather knowledge of their own, so an answer naming the place it
      // was asked about is one their tools produced.
      const answered = outcome.all.filter((entry) => !entry.failed);
      expect(answered.length).toBeGreaterThan(0);
      expect(
        answered
          .map((entry) => entry.result)
          .join(' ')
          .toLowerCase(),
      ).toContain('aarhus');
    },
    TIMEOUT_MS,
  );

  it(
    'leaves its plan in the workflow list, which is the point of building it as one',
    async () => {
      await routeAndWait('plan-run-spec-studio', 'What is on my calendar today?', TIMEOUT_MS);

      const plans = Object.keys(mastra.listWorkflows()).filter((key) => mastra.getWorkflowOrigin(key) === 'dynamic');

      expect(plans.length).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
});
