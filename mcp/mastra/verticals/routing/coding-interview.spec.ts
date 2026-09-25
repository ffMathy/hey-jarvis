/**
 * A coding request from Jarvis's side of the line, from the first sentence to the Claude session.
 *
 * This is the path the ElevenLabs agent takes, through the same two MCP tools it calls:
 * `routePromptWorkflow` with what sir said, then `getNextInstructionsWorkflow` until a response
 * closes the request. In between, the planner hands the request to the coding agent, the coding
 * agent starts `implementFeatureWorkflow` as a tool, a Claude session reads the codebase, and the
 * workflow suspends on the first question that session could not answer -- which has to come
 * back out of the poll as something Jarvis can ask. Sir's reply goes back in through
 * `routePromptWorkflow`, and has to reach the suspended workflow rather than start a new errand.
 *
 * The workflow is marked slow, so the poll also has to offer to notify him instead of holding the
 * line, and taking that offer has to let the request outlive the conversation.
 *
 * Every model is scripted and both Claude sessions are recorders, so what is tested is the
 * plumbing between them: that a suspension surfaces, that an answer resumes it, that the slow
 * offer and the notification work, and that the questions end in exactly one session.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import {
  type CodingToolRecorder,
  RECORDED_ANALYSIS,
  RECORDED_SESSION_URL,
  type RecordCodingToolsOptions,
  recordCodingTools,
} from '../../../tests/utils/coding-tool-recorder.js';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import { implementFeatureWorkflow } from '../coding/workflows.js';
import {
  type CompletionNotice,
  resetCompletionNotifierForTest,
  setCompletionNotifierForTest,
} from './completion-notice.js';
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
const [FIRST_QUESTION, SECOND_QUESTION] = RECORDED_ANALYSIS.questions;
const FIRST_ANSWER = 'Push, please.';
const SECOND_ANSWER = 'An hour before.';
const SESSION_STARTED = 'A Claude cloud session is now implementing push reminders for tasks.';

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
    if (transcript.includes(RECORDED_SESSION_URL)) {
      return { text: SESSION_STARTED };
    }

    return {
      toolCalls: [
        { toolName: 'workflow-implementFeatureWorkflow', input: { inputData: { initialRequest: FEATURE_REQUEST } } },
      ],
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
  slowTaskIds?: string[];
}

/** The openings a response has when it closes a request, and only then. */
const CLOSING_OPENINGS = ['All tasks have completed', 'The request could not be completed', 'Part of this request'];

async function poll(input: { notifyWhenDone?: boolean } = {}): Promise<PollResponse> {
  return (await executeTool(pollTool, input)) as PollResponse;
}

/** Says something to Jarvis, and does what he does: polls until the request is closed. */
async function say(userQuery: string): Promise<PollResponse> {
  await executeTool(routeTool, { userQuery, async: false });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await poll();
    if (CLOSING_OPENINGS.some((opening) => response.instructions.startsWith(opening))) {
      return response;
    }
  }

  throw new Error(`"${userQuery}" was never closed`);
}

let codingTools: CodingToolRecorder | undefined;

/**
 * Registers the workflows and agents on a fresh instance, with the analysing session recorded.
 *
 * Registering the workflows here is what hands their steps this instance: the routing steps plan
 * against its agents, and the coding workflow persists its suspension in its storage.
 */
async function setUp(options?: RecordCodingToolsOptions): Promise<CodingToolRecorder> {
  codingTools = recordCodingTools(options);

  new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { implementFeatureWorkflow, routePromptWorkflow, getNextInstructionsWorkflow },
    agents: {
      [PLANNER_AGENT_ID]: await scriptedAgent(PLANNER_AGENT_ID, scriptedPlanner().model),
      coding: await scriptedAgent('coding', scriptedCodingAgent().model, {
        workflows: { implementFeatureWorkflow },
      }),
    },
  });

  return codingTools;
}

beforeEach(() => {
  resetRoutingRuntime();
  setPollDeadlineForTest(1_000);
});

afterEach(() => {
  codingTools?.restore();
  codingTools = undefined;
  resetCompletionNotifierForTest();
  resetRoutingRuntime();
  resetPollDeadlineForTest();
});

describe('a coding request made by voice', () => {
  it('comes back as the first question the codebase could not answer, with nothing started yet', async () => {
    const recorder = await setUp();

    const response = await say(FEATURE_REQUEST);

    expect(response.questionsForUser).toEqual([{ id: 'feature', question: FIRST_QUESTION }]);
    expect(response.instructions).toContain('send his answer through routePromptWorkflow');
    expect(recorder.analysisTasks).toHaveLength(1);
    expect(recorder.startedSessions).toEqual([]);
  }, 60_000);

  it('carries each answer back to the workflow, and asks the next question', async () => {
    const recorder = await setUp();
    await say(FEATURE_REQUEST);

    const response = await say(FIRST_ANSWER);

    expect(response.questionsForUser).toEqual([{ id: 'feature', question: SECOND_QUESTION }]);
    // The workflow heard the answer, rather than a fresh analysis being started with it.
    expect(recorder.analysisTasks).toHaveLength(1);
    expect(recorder.startedSessions).toEqual([]);
  }, 60_000);

  it('ends in one Claude session, reported back as the request’s result', async () => {
    const recorder = await setUp();
    await say(FEATURE_REQUEST);
    await say(FIRST_ANSWER);

    const response = await say(SECOND_ANSWER);

    expect(response.instructions).toStartWith('All tasks have completed');
    expect(response.questionsForUser).toBeUndefined();
    expect(response.completedTaskResults).toEqual([{ id: 'feature', result: SESSION_STARTED }]);
    expect(recorder.startedSessions).toHaveLength(1);
    expect(recorder.startedSessions[0].instructions).toContain(FIRST_ANSWER);
    expect(recorder.startedSessions[0].instructions).toContain(SECOND_ANSWER);
    expect(listOpenQuestions()).toEqual([]);
  }, 60_000);

  it('keeps the question open while sir talks about something else, and takes the answer after', async () => {
    await setUp();
    await say(FEATURE_REQUEST);

    const aside = await say('What is the meaning of life?');
    expect(aside.instructions).toStartWith('The request could not be completed');
    expect(listOpenQuestions()).toMatchObject([{ question: FIRST_QUESTION }]);

    const response = await say(FIRST_ANSWER);
    expect(response.questionsForUser).toEqual([{ id: 'feature', question: SECOND_QUESTION }]);
  }, 60_000);
});

describe('a coding request that takes minutes', () => {
  /** Longer than a poll's deadline, so the analysis is still running when the first poll returns. */
  const SLOW_ANALYSIS = { analysisDelayMilliseconds: 2_500 };

  /** Captures the notices that would be sent to sir, and resolves once the first one is. */
  function recordNotices() {
    const notices: CompletionNotice[] = [];
    const firstNotice = new Promise<void>((resolve) => {
      setCompletionNotifierForTest(async (notice) => {
        notices.push(notice);
        resolve();
      });
    });
    return { notices, firstNotice };
  }

  it('has Jarvis offer to notify sir rather than hold the line', async () => {
    await setUp(SLOW_ANALYSIS);
    await executeTool(routeTool, { userQuery: FEATURE_REQUEST, async: false });

    const response = await poll();

    expect(response.slowTaskIds).toEqual(['feature']);
    expect(response.instructions).toContain('offer to notify him when it is done');
  }, 60_000);

  it('sends sir the question once he has taken the offer, and still takes his answer later', async () => {
    const recorder = await setUp(SLOW_ANALYSIS);
    const { notices, firstNotice } = recordNotices();
    await executeTool(routeTool, { userQuery: FEATURE_REQUEST, async: false });
    await poll();

    const accepted = await poll({ notifyWhenDone: true });
    expect(accepted.instructions).toContain('will be notified when this request is done');

    await firstNotice;
    expect(notices).toEqual([{ title: 'Jarvis has a question', message: expect.stringContaining(FIRST_QUESTION) }]);
    expect(recorder.startedSessions).toEqual([]);

    const response = await say(FIRST_ANSWER);
    expect(response.questionsForUser).toEqual([{ id: 'feature', question: SECOND_QUESTION }]);
  }, 60_000);

  it('is not cancelled by what sir asks for next', async () => {
    const recorder = await setUp(SLOW_ANALYSIS);
    const { notices, firstNotice } = recordNotices();
    await executeTool(routeTool, { userQuery: FEATURE_REQUEST, async: false });
    await poll();
    await poll({ notifyWhenDone: true });

    // A new request would ordinarily supersede the running one and cancel it.
    await say('What is the meaning of life?');
    await firstNotice;

    expect(recorder.analysisTasks).toHaveLength(1);
    expect(notices[0].message).toContain(FIRST_QUESTION);
    expect(listOpenQuestions()).toMatchObject([{ question: FIRST_QUESTION }]);
  }, 60_000);
});
