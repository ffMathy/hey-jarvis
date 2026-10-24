/**
 * A lights request whose agent fails, from Jarvis's side of the line.
 *
 * This is the path the ElevenLabs agent takes, through the same two MCP tools it calls:
 * `routePromptWorkflow` with what sir said, then `getNextInstructionsWorkflow` until a response
 * closes the request. The planner hands the request to the Internet of Things agent, whose model
 * throws.
 *
 * A failed step reaches the plan run with what went wrong in `error` and no `output` at all, which
 * is Mastra's shape rather than one written down anywhere -- and the controller spec only feeds it
 * step results built by hand. Routing once read `output` regardless, so the request closed as if
 * the agent had answered "null", and Jarvis was left with nothing to say and no reason why. So it
 * is pinned here against a real plan run, with scripted models.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { resetRoutingRuntime } from './controller.js';
import { PLANNER_AGENT_ID } from './planner.js';
import {
  getNextInstructionsWorkflow,
  instructionsOutputSchema,
  resetPollDeadlineForTest,
  routePromptWorkflow,
  setPollDeadlineForTest,
} from './workflows.js';

const REQUEST = 'Which lights are on?';
const FAILURE = 'The model is unavailable.';

/** The planner: one task for the Internet of Things agent, answered as a lookup. */
function scriptedPlanner() {
  return createScriptedModel(() => ({
    text: JSON.stringify({
      responseStyle: 'lookup',
      tasks: [{ id: 'internetOfThings', agentId: 'internetOfThings', prompt: REQUEST, needs: '' }],
      answers: [],
      dismissedPhotoIds: [],
      photosToAskAbout: [],
      awaitsPhoto: false,
    }),
  }));
}

/** An agent on a scripted model, without the shared memory that would want real credentials. */
async function scriptedAgent(id: string, model: ReturnType<typeof createScriptedModel>['model']) {
  return createAgent({ id, name: id, instructions: `You are ${id}.`, model, memory: undefined });
}

const routeTool = createInstructionsWorkflowTool(routePromptWorkflow);
const pollTool = createSimplifiedWorkflowTool(getNextInstructionsWorkflow);

/** One poll, read the way the voice agent reads it. */
async function poll() {
  return instructionsOutputSchema.parse(await executeTool(pollTool, {}));
}

/** The openings a response has when it closes a request, wherever in it they come. */
const CLOSING_OPENINGS = ['All tasks have completed', 'The request could not be completed'];

/** Polls until a response closes the request, the way the voice agent does. */
async function pollUntilClosed() {
  const responses = [await poll()];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const latest = responses[responses.length - 1];
    if (CLOSING_OPENINGS.some((opening) => latest.instructions.includes(opening))) {
      break;
    }
    responses.push(await poll());
  }
  return responses;
}

beforeEach(async () => {
  resetRoutingRuntime();
  setPollDeadlineForTest(5_000);

  new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { routePromptWorkflow, getNextInstructionsWorkflow },
    agents: {
      [PLANNER_AGENT_ID]: await scriptedAgent(PLANNER_AGENT_ID, scriptedPlanner().model),
      internetOfThings: await scriptedAgent(
        'internetOfThings',
        createScriptedModel(() => {
          throw new Error(FAILURE);
        }).model,
      ),
    },
  });
});

afterEach(() => {
  resetRoutingRuntime();
  resetPollDeadlineForTest();
});

describe('a lights request whose agent fails', () => {
  it('tells Jarvis what went wrong, rather than that the agent answered "null"', async () => {
    await executeTool(routeTool, { userQuery: REQUEST, async: false });
    const responses = await pollUntilClosed();
    const closing = responses[responses.length - 1];

    expect(closing.taskIdsInProgress).toEqual([]);
    const results = responses.flatMap((response) => response.completedTaskResults ?? []);
    expect(results).not.toContainEqual({ id: 'internetOfThings', result: 'null' });
    expect(results).toContainEqual({ id: 'internetOfThings', result: `failed: ${FAILURE}` });
  }, 60_000);
});
