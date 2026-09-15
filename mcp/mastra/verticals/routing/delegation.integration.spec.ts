/**
 * Whether a subagent can run at all, and whether delegating to it changes the answer.
 *
 * Every delegation in a live routing run fails with
 * `[Agent:RoutingSupervisor] - Failed agent tool execution for <agent>`, which names the
 * agent and says nothing else. Four attempts to recover the reason from logs and traces
 * produced nothing: the traces record no failure, so the subagent run appears never to
 * start, and the wrapper is the only artefact left behind.
 *
 * Reading more code was not settling it, so this asks the question directly instead. The
 * two tests are the same weather question down two different paths:
 *
 * - alone, the agent is called the way anything else in this repo calls one
 * - delegated, the registered supervisor is asked the same thing and routes it
 *
 * Which of them fails is the answer. Both failing puts the problem in the environment or
 * the model, and routing is not involved. Only the second failing puts it squarely in the
 * delegation path, which is what this branch introduced.
 */

import { describe, expect, it } from 'bun:test';
import { mastra } from '../../index.js';
import { ROUTING_SUPERVISOR_AGENT_ID } from './agents.js';

const WEATHER_QUESTION = 'What is the current weather in Aarhus, Denmark?';

/** Long enough for a delegation that retries; short enough to fail rather than hang. */
const TIMEOUT_MS = 90_000;

describe('a subagent on its own', () => {
  it(
    'answers a question the routing supervisor would delegate to it',
    async () => {
      const weather = mastra.getAgentById('weather');

      const response = await weather.generate(WEATHER_QUESTION);

      expect(response.text.length).toBeGreaterThan(0);
      // The agent has no weather knowledge of its own, so an answer naming the place it was
      // asked about is one its tools produced.
      expect(response.text.toLowerCase()).toContain('aarhus');
    },
    TIMEOUT_MS,
  );
});

describe('the same subagent, reached by delegation', () => {
  it(
    'answers through the supervisor rather than failing the tool call',
    async () => {
      const supervisor = mastra.getAgentById(ROUTING_SUPERVISOR_AGENT_ID);

      const response = await supervisor.generate(WEATHER_QUESTION);

      // This is the failure under investigation. Asserting on it rather than on the text
      // means a run that reproduces it says so, instead of failing on a vague emptiness.
      expect(response.text).not.toContain('Failed agent tool execution');
      expect(response.text.length).toBeGreaterThan(0);
    },
    TIMEOUT_MS,
  );
});
