/**
 * The requirements interview, run the way a voice conversation runs it: one question, a
 * suspension, an answer, the next question, until the interviewer has what it needs — and then
 * an issue and a Claude session, exactly once.
 *
 * The interviewer is a scripted model, and the two tools that reach GitHub and Anthropic are
 * spied on and recorded, so everything between them — the loop, the suspensions, the state carried across
 * them and what finally lands in the issue — is the real workflow.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import {
  type CodingToolRecorder,
  RECORDED_ISSUE_URL,
  RECORDED_SESSION_URL,
  recordCodingTools,
} from '../../../tests/utils/coding-tool-recorder.js';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createAgent } from '../../utils/agent-factory.js';
import { implementFeatureWorkflow } from './workflows.js';

let codingTools: CodingToolRecorder;

const FIRST_QUESTION = 'Should the reminder go out by email or as a push notification?';
const SECOND_QUESTION = 'How long before the task is due should it be sent?';

/**
 * An interviewer that asks two questions and is then satisfied.
 *
 * It decides from what it has been told so far, the way the real one does: the answers arrive
 * as messages in the conversation it is handed on each call.
 */
function scriptedInterviewer() {
  return createScriptedModel(({ transcript }) => {
    const heardFirstAnswer = transcript.includes('Push, please.');
    const heardSecondAnswer = transcript.includes('An hour before.');

    if (!heardFirstAnswer) {
      return { text: JSON.stringify({ needsMoreQuestions: true, nextQuestion: FIRST_QUESTION, requirements: {} }) };
    }

    if (!heardSecondAnswer) {
      return { text: JSON.stringify({ needsMoreQuestions: true, nextQuestion: SECOND_QUESTION, requirements: {} }) };
    }

    return {
      text: JSON.stringify({
        needsMoreQuestions: false,
        requirements: {
          title: 'Push reminders for tasks',
          requirements: ['Send a push notification an hour before a task is due'],
          acceptanceCriteria: ['A task due at 15:00 produces a push notification at 14:00'],
          implementation: { location: 'mcp/mastra/verticals/todo-list', dependencies: [], edgeCases: [] },
          isComplete: true,
        },
      }),
    };
  });
}

async function createMastraWithInterviewer() {
  const interviewer = scriptedInterviewer();
  const mastra = new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { implementFeatureWorkflow },
    agents: {
      requirementsInterviewer: await createAgent({
        id: 'requirementsInterviewer',
        name: 'RequirementsInterviewer',
        instructions: 'Interview the user.',
        model: interviewer.model,
        // The shared memory reaches for an embedder, which wants credentials a mocked test has
        // none of, and the step hands the interviewer the whole conversation itself.
        memory: undefined,
      }),
    },
  });

  return { mastra, interviewerCalls: interviewer.calls };
}

/** A suspended run, read as text, so a spec can look for the question it is waiting on. */
function suspendedRunText(result: { status: string }): string {
  expect(result.status).toBe('suspended');
  return JSON.stringify(result);
}

beforeEach(() => {
  codingTools = recordCodingTools();
});

afterEach(() => {
  codingTools.restore();
});

describe('implementFeatureWorkflow', () => {
  it('suspends on the interviewer’s first question, before anything is filed', async () => {
    const { mastra } = await createMastraWithInterviewer();
    const run = await mastra.getWorkflow('implementFeatureWorkflow').createRun();

    const started = await run.start({ inputData: { initialRequest: 'Remind me about tasks before they are due' } });

    expect(suspendedRunText(started)).toContain(FIRST_QUESTION);
    expect(codingTools.createdIssues).toEqual([]);
    expect(codingTools.startedSessions).toEqual([]);
  });

  it('carries each answer back to the interviewer and asks the next question', async () => {
    const { mastra } = await createMastraWithInterviewer();
    const run = await mastra.getWorkflow('implementFeatureWorkflow').createRun();
    await run.start({ inputData: { initialRequest: 'Remind me about tasks before they are due' } });

    const afterFirstAnswer = await run.resume({ resumeData: { userAnswer: 'Push, please.' } });

    expect(suspendedRunText(afterFirstAnswer)).toContain(SECOND_QUESTION);
    expect(codingTools.createdIssues).toEqual([]);
  });

  /**
   * The loop that asks the questions used to continue while `true`, so the interview never
   * ended on its own: once the interviewer was satisfied it was simply asked again, fifty times,
   * and the run then failed with "Requirements gathering exceeded maximum iterations" — after the
   * user had answered everything, and without ever filing the issue.
   */
  it('files the issue and starts the session once the interviewer has what it needs', async () => {
    const { mastra, interviewerCalls } = await createMastraWithInterviewer();
    const run = await mastra.getWorkflow('implementFeatureWorkflow').createRun();
    await run.start({ inputData: { initialRequest: 'Remind me about tasks before they are due' } });
    await run.resume({ resumeData: { userAnswer: 'Push, please.' } });

    const finished = await run.resume({ resumeData: { userAnswer: 'An hour before.' } });

    expect(finished.status).toBe('success');
    expect(interviewerCalls).toHaveLength(3);
    expect(codingTools.createdIssues).toHaveLength(1);
    expect(codingTools.startedSessions).toEqual([
      expect.objectContaining({ repo: 'hey-jarvis', issue_number: 42, title: 'Push reminders for tasks' }),
    ]);
    if (finished.status === 'success') {
      expect(finished.result).toMatchObject({
        success: true,
        issueUrl: RECORDED_ISSUE_URL,
        sessionUrl: RECORDED_SESSION_URL,
      });
    }
  });

  it('writes down what was asked and what the user answered, so the session can read it', async () => {
    const { mastra } = await createMastraWithInterviewer();
    const run = await mastra.getWorkflow('implementFeatureWorkflow').createRun();
    await run.start({ inputData: { initialRequest: 'Remind me about tasks before they are due' } });
    await run.resume({ resumeData: { userAnswer: 'Push, please.' } });
    await run.resume({ resumeData: { userAnswer: 'An hour before.' } });

    const [issue] = codingTools.createdIssues;
    expect(issue.body).toContain('Remind me about tasks before they are due');
    expect(issue.body).toContain(FIRST_QUESTION);
    expect(issue.body).toContain('Push, please.');
    expect(issue.body).toContain(SECOND_QUESTION);
    expect(issue.body).toContain('An hour before.');
  });
});
