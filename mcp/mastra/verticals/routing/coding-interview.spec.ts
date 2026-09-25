/**
 * A coding request from Jarvis's side of the line, from the first sentence to the Claude session.
 *
 * This is the path the ElevenLabs agent takes, through the same two MCP tools it calls:
 * `routePromptWorkflow` with what sir said, then `getNextInstructionsWorkflow` until a response
 * closes the request. In between, the planner hands the request to the coding agent, the coding
 * agent starts `implementFeatureWorkflow` as a tool, and the interview suspends it on its first
 * question -- which has to come back out of the poll as something Jarvis can ask. Sir's reply
 * goes back in through `routePromptWorkflow`, and has to reach the suspended interview rather
 * than start a new errand.
 *
 * Every model is scripted and the GitHub and Claude tools are recorders, so what is tested is
 * the plumbing between them: that a suspension surfaces, that an answer resumes it, and that the
 * interview ends in exactly one issue and one session.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import {
  type CodingToolRecorder,
  RECORDED_ISSUE_URL,
  recordCodingTools,
} from '../../../tests/utils/coding-tool-recorder.js';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { implementFeatureWorkflow } from '../coding/workflows.js';
import { resetRoutingRuntime } from './controller.js';
import { PLANNER_AGENT_ID } from './planner.js';
import { listOpenQuestions } from './questions.js';
import {
  getNextInstructionsWorkflow,
  resetPollDeadlineForTest,
  routePromptWorkflow,
  setPollDeadlineForTest,
} from './workflows.js';

const FEATURE_REQUEST = 'Build me reminders that go out before my tasks are due.';
const FIRST_QUESTION = 'Should the reminder go out by email, or as a push notification?';
const FIRST_ANSWER = 'Push, please.';
const SECOND_QUESTION = 'How long before the task is due should it be sent?';
const SECOND_ANSWER = 'An hour before.';

/**
 * The planner: a coding task for the feature request, and an answer for anything said while a
 * question is waiting -- except the one request here that is about something else entirely.
 */
function scriptedPlanner() {
  return createScriptedModel(({ transcript }) => {
    const waitingQuestionId = transcript.match(/id "(q\d+)", asked by/)?.[1];
    const answer = [FIRST_ANSWER, SECOND_ANSWER].find((candidate) => transcript.includes(candidate));

    if (waitingQuestionId && answer) {
      return { text: JSON.stringify({ tasks: [], answers: [{ questionId: waitingQuestionId, answer }] }) };
    }

    if (transcript.includes(FEATURE_REQUEST)) {
      return {
        text: JSON.stringify({
          tasks: [{ id: 'feature', agentId: 'coding', prompt: FEATURE_REQUEST, needs: '' }],
          answers: [],
        }),
      };
    }

    // Nothing any agent can do, and no answer to anything.
    return { text: JSON.stringify({ tasks: [], answers: [] }) };
  });
}

/** The coding agent: starts the workflow, and reports once the workflow has finished. */
function scriptedCodingAgent() {
  return createScriptedModel(({ transcript }) => {
    if (transcript.includes(RECORDED_ISSUE_URL)) {
      return { text: 'Filed issue #42, "Push reminders for tasks", and a Claude cloud session is implementing it.' };
    }

    return {
      toolCalls: [
        { toolName: 'workflow-implementFeatureWorkflow', input: { inputData: { initialRequest: FEATURE_REQUEST } } },
      ],
    };
  });
}

/** The interviewer: two questions, then satisfied. */
function scriptedInterviewer() {
  return createScriptedModel(({ transcript }) => {
    if (!transcript.includes(FIRST_ANSWER)) {
      return { text: JSON.stringify({ needsMoreQuestions: true, nextQuestion: FIRST_QUESTION, requirements: {} }) };
    }

    if (!transcript.includes(SECOND_ANSWER)) {
      return { text: JSON.stringify({ needsMoreQuestions: true, nextQuestion: SECOND_QUESTION, requirements: {} }) };
    }

    return {
      text: JSON.stringify({
        needsMoreQuestions: false,
        requirements: {
          title: 'Push reminders for tasks',
          requirements: ['Send a push notification an hour before a task is due'],
          isComplete: true,
        },
      }),
    };
  });
}

/** An agent on a scripted model, without the shared memory that would want real credentials. */
async function scriptedAgent(id: string, model: ReturnType<typeof createScriptedModel>['model'], extra = {}) {
  return createAgent({ id, name: id, instructions: `You are ${id}.`, model, memory: undefined, ...extra });
}

const routeTool = createInstructionsWorkflowTool(routePromptWorkflow);
const pollTool = createSimplifiedWorkflowTool(getNextInstructionsWorkflow);

/** What the poll answers with, as far as these tests read it. */
interface PollResponse {
  instructions: string;
  completedTaskResults?: { id: string; result: unknown }[];
  taskIdsInProgress?: string[];
  questionsForUser?: { id: string; question: string }[];
}

/** The openings a response has when it closes a request, and only then. */
const CLOSING_OPENINGS = ['All tasks have completed', 'The request could not be completed', 'Part of this request'];

/** Says something to Jarvis, and does what he does: polls until the request is closed. */
async function say(userQuery: string): Promise<PollResponse> {
  await executeTool(routeTool, { userQuery, async: false });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = (await executeTool(pollTool, {})) as PollResponse;
    if (CLOSING_OPENINGS.some((opening) => response.instructions.startsWith(opening))) {
      return response;
    }
  }

  throw new Error(`"${userQuery}" was never closed`);
}

let codingTools: CodingToolRecorder;
let interviewerCalls: ReturnType<typeof createScriptedModel>['calls'];

beforeEach(async () => {
  resetRoutingRuntime();
  setPollDeadlineForTest(1_000);
  codingTools = recordCodingTools();

  const interviewer = scriptedInterviewer();
  interviewerCalls = interviewer.calls;

  // Registering the workflows here is what hands their steps this instance: the routing steps
  // plan against its agents, and the interview persists its suspension in its storage.
  new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { implementFeatureWorkflow, routePromptWorkflow, getNextInstructionsWorkflow },
    agents: {
      [PLANNER_AGENT_ID]: await scriptedAgent(PLANNER_AGENT_ID, scriptedPlanner().model),
      coding: await scriptedAgent('coding', scriptedCodingAgent().model, {
        workflows: { implementFeatureWorkflow },
      }),
      requirementsInterviewer: await scriptedAgent('requirementsInterviewer', interviewer.model),
    },
  });
});

afterEach(() => {
  codingTools.restore();
  resetRoutingRuntime();
  resetPollDeadlineForTest();
});

describe('a coding request made by voice', () => {
  it('comes back as the interviewer’s first question, with nothing filed yet', async () => {
    const response = await say(FEATURE_REQUEST);

    expect(response.questionsForUser).toEqual([{ id: 'feature', question: FIRST_QUESTION }]);
    expect(response.instructions).toContain('send his answer through routePromptWorkflow');
    expect(codingTools.createdIssues).toEqual([]);
  }, 60_000);

  it('carries each answer back to the interview, and asks the next question', async () => {
    await say(FEATURE_REQUEST);

    const response = await say(FIRST_ANSWER);

    expect(response.questionsForUser).toEqual([{ id: 'feature', question: SECOND_QUESTION }]);
    expect(codingTools.createdIssues).toEqual([]);
    // The interview heard the answer, rather than a fresh interview being started with it.
    const lastInterviewerCall = interviewerCalls[interviewerCalls.length - 1];
    expect(lastInterviewerCall.transcript).toContain(FIRST_ANSWER);
    expect(lastInterviewerCall.transcript).toContain(FEATURE_REQUEST);
  }, 60_000);

  it('ends in one issue and one Claude session, reported back as the request’s result', async () => {
    await say(FEATURE_REQUEST);
    await say(FIRST_ANSWER);

    const response = await say(SECOND_ANSWER);

    expect(response.instructions).toStartWith('All tasks have completed');
    expect(response.questionsForUser).toBeUndefined();
    expect(response.completedTaskResults).toEqual([
      {
        id: 'feature',
        result: 'Filed issue #42, "Push reminders for tasks", and a Claude cloud session is implementing it.',
      },
    ]);
    expect(codingTools.createdIssues).toHaveLength(1);
    expect(codingTools.createdIssues[0].body).toContain(FIRST_ANSWER);
    expect(codingTools.createdIssues[0].body).toContain(SECOND_ANSWER);
    expect(codingTools.startedSessions).toEqual([expect.objectContaining({ issue_number: 42 })]);
    expect(listOpenQuestions()).toEqual([]);
  }, 60_000);

  it('keeps the question open while sir talks about something else, and takes the answer after', async () => {
    await say(FEATURE_REQUEST);

    const aside = await say('What is the meaning of life?');
    expect(aside.instructions).toStartWith('The request could not be completed');
    expect(listOpenQuestions()).toMatchObject([{ question: FIRST_QUESTION }]);

    const response = await say(FIRST_ANSWER);
    expect(response.questionsForUser).toEqual([{ id: 'feature', question: SECOND_QUESTION }]);
  }, 60_000);
});
