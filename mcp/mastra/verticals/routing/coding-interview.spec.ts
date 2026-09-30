/**
 * A coding request from Jarvis's side of the line, from the first sentence to the answer that
 * reaches the Claude session.
 *
 * This is the path the ElevenLabs agent takes, through the same two MCP tools it calls:
 * `routePromptWorkflow` with what sir said, then `getNextInstructionsWorkflow` until a response
 * closes the request. In between, the planner hands the request to the coding agent, and the
 * coding agent starts `implementFeatureWorkflow` as a tool, which starts a Claude session at once
 * -- nothing is asked first.
 *
 * The session asks later, whenever it needs something only sir can decide: its turn ends on a
 * question, the watcher asks him over a channel his answer can come back on, and his answer -- the
 * next thing he says to Jarvis, on that call or any later one -- goes back in through
 * `routePromptWorkflow` and has to reach the session rather than start a new errand.
 *
 * Every model is scripted, the Claude session is a recorder and asking is spied on, so what is
 * tested is the plumbing between them.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import {
  type CodingToolRecorder,
  RECORDED_SESSION_ID,
  recordCodingTools,
} from '../../../tests/utils/coding-tool-recorder.js';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from '../../utils/mcp-tool-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import type { ClaudeSessionEvent } from '../coding/claude-sessions.js';
import { ClaudeSessionWatcher, createSessionQuestionAsker } from '../coding/session-watcher.js';
import { implementFeatureWorkflow } from '../coding/workflows.js';
import { askQuestion } from '../notification/tools.js';
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
const SESSION_QUESTION = 'Should the reminder go out by email, or as a push notification?';
const ANSWER = 'Push, please.';
const SESSION_STARTED = 'A Claude Code session is now implementing push reminders for tasks.';
const TITLE = 'Push reminders for tasks';

/**
 * The planner: a coding task for the feature request, and an answer for anything said while a
 * question is waiting -- except the one request here that is about something else entirely.
 */
function scriptedPlanner() {
  return createScriptedModel(({ transcript }) => {
    const waitingQuestionId = transcript.match(/id "(q\d+)", asked by/)?.[1];

    if (waitingQuestionId && transcript.includes(ANSWER)) {
      return {
        text: JSON.stringify({
          responseStyle: 'command',
          tasks: [],
          answers: [{ questionId: waitingQuestionId, answer: ANSWER }],
        }),
      };
    }

    if (transcript.includes(FEATURE_REQUEST)) {
      return {
        text: JSON.stringify({
          responseStyle: 'briefing',
          tasks: [{ id: 'feature', agentId: 'coding', prompt: FEATURE_REQUEST, needs: '' }],
          answers: [],
        }),
      };
    }

    // Nothing any agent can do, and no answer to anything.
    return { text: JSON.stringify({ responseStyle: 'conversation', tasks: [], answers: [] }) };
  });
}

/** The coding agent: starts the workflow, and reports once the workflow has finished. */
function scriptedCodingAgent() {
  return createScriptedModel(({ transcript }) => {
    if (transcript.includes(RECORDED_SESSION_ID)) {
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
  questionsForUser?: { id: string; question: string }[];
  slowTaskIds?: string[];
}

/**
 * The openings a response has when it closes a request, and only then.
 *
 * Searched for rather than expected at the start: a response that also carries what the request
 * touched opens with the markAffected instruction instead (see `MARK_AFFECTED_INSTRUCTIONS`), and the
 * coding agent's implementation workflow reports the repository it works on.
 */
const CLOSING_OPENINGS = ['All tasks have completed', 'The request could not be completed', 'Part of this request'];

/** Says something to Jarvis, and does what he does: polls until the request is closed. */
async function say(userQuery: string): Promise<PollResponse> {
  await executeTool(routeTool, { userQuery, async: false });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = (await executeTool(pollTool, {})) as PollResponse;
    if (CLOSING_OPENINGS.some((opening) => response.instructions.includes(opening))) {
      return response;
    }
  }

  throw new Error(`"${userQuery}" was never closed`);
}

/** What the session was asked, and what reached it. */
interface SessionLine {
  asked: { question: string; about?: string }[];
  sent: { sessionId: string; message: string }[];
}

/**
 * Has a watched session end its turn on a question, the way a real one does, and records both
 * directions of the line: what sir was asked, and what was sent back to the session.
 */
async function sessionAsks(question: string): Promise<SessionLine> {
  const line: SessionLine = { asked: [], sent: [] };
  askSpy = spyOn(askQuestion, 'execute').mockImplementation(async (inputData) => {
    line.asked.push(inputData);
    return { success: true, channel: 'phone-call', reason: 'He is in the car.', message: 'Phone call initiated' };
  });

  const turn: ClaudeSessionEvent[] = [
    { id: 'sevt_1', type: 'session.status_running' },
    { id: 'sevt_2', type: 'agent.message', text: `I read the code.\n\n\`\`\`jarvis-question\n${question}\n\`\`\`` },
    { id: 'sevt_3', type: 'session.status_idle', stopReason: 'end_turn' },
  ];
  const watcher = new ClaudeSessionWatcher(
    async function* () {
      yield* turn;
    },
    async () => {},
    0,
    async () => undefined,
    createSessionQuestionAsker(async (sessionId, message) => {
      line.sent.push({ sessionId, message });
    }),
  );

  watcher.watch(RECORDED_SESSION_ID, { title: TITLE });
  for (let attempt = 0; attempt < 50 && line.asked.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return line;
}

let codingTools: CodingToolRecorder | undefined;
let askSpy: { mockRestore(): void } | undefined;

/**
 * Registers the workflows and agents on a fresh instance, with the Claude session recorded.
 *
 * Registering the workflows here is what hands their steps this instance: the routing steps plan
 * against its agents.
 */
async function setUp(): Promise<CodingToolRecorder> {
  codingTools = recordCodingTools();

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
  askSpy?.mockRestore();
  askSpy = undefined;
  resetRoutingRuntime();
  resetPollDeadlineForTest();
});

describe('a coding request made by voice', () => {
  it('starts one Claude session at once, asking nothing first', async () => {
    const recorder = await setUp();

    const response = await say(FEATURE_REQUEST);

    expect(response.instructions).toContain('All tasks have completed');
    expect(response.questionsForUser).toBeUndefined();
    expect(response.slowTaskIds).toBeUndefined();
    expect(response.completedTaskResults).toEqual([{ id: 'feature', result: SESSION_STARTED }]);
    expect(recorder.startedSessions).toEqual([expect.objectContaining({ request: FEATURE_REQUEST })]);
  }, 60_000);
});

describe('a question the Claude session asks along the way', () => {
  it('is put to sir, and stays open until he answers', async () => {
    await setUp();
    await say(FEATURE_REQUEST);

    const line = await sessionAsks(SESSION_QUESTION);

    expect(line.asked).toEqual([{ question: SESSION_QUESTION, about: TITLE }]);
    expect(listOpenQuestions()).toMatchObject([{ question: SESSION_QUESTION, agentId: 'coding' }]);
    expect(line.sent).toEqual([]);
  }, 60_000);

  it('gets his answer, back through routePromptWorkflow, to the session that asked', async () => {
    const recorder = await setUp();
    await say(FEATURE_REQUEST);
    const line = await sessionAsks(SESSION_QUESTION);

    const response = await say(ANSWER);

    expect(line.sent).toEqual([{ sessionId: RECORDED_SESSION_ID, message: ANSWER }]);
    expect(response.instructions).toContain('All tasks have completed');
    expect(response.completedTaskResults).toEqual([
      { id: TITLE, result: expect.stringContaining('Passed the answer on to the Claude Code session') },
    ]);
    // The answer reached the session that asked, rather than starting another one.
    expect(recorder.startedSessions).toHaveLength(1);
    expect(listOpenQuestions()).toEqual([]);
  }, 60_000);

  it('stays open while sir talks about something else, and takes the answer after', async () => {
    await setUp();
    await say(FEATURE_REQUEST);
    const line = await sessionAsks(SESSION_QUESTION);

    const aside = await say('What is the meaning of life?');
    expect(aside.instructions).toContain('The request could not be completed');
    expect(listOpenQuestions()).toMatchObject([{ question: SESSION_QUESTION }]);
    expect(line.sent).toEqual([]);

    await say(ANSWER);
    expect(line.sent).toEqual([{ sessionId: RECORDED_SESSION_ID, message: ANSWER }]);
  }, 60_000);

  it('is brought up the next time sir talks to Jarvis, once', async () => {
    await setUp();
    await say(FEATURE_REQUEST);
    await sessionAsks(SESSION_QUESTION);

    const next = await say('What is the meaning of life?');
    expect(next.questionsForUser).toEqual([{ id: TITLE, question: SESSION_QUESTION }]);
    expect(next.instructions).toContain('work he started earlier is still waiting on him');

    // Not after every request of the same conversation.
    const after = await say('What is the meaning of life?');
    expect(after.questionsForUser).toBeUndefined();
  }, 60_000);
});
