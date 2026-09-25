/**
 * What makes a suspension a question sir can be asked, and how a question waits for his answer.
 *
 * The chunk reading and the reporting are covered in `controller.spec.ts` and
 * `workflows.spec.ts`; this is the part in between that decides whether a stopped delegation can
 * be resumed with a spoken answer at all.
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { plannerPrompt } from './planner.js';
import {
  asDelegationSuspension,
  forgetOpenQuestions,
  listOpenQuestions,
  nextQuestionId,
  type OpenQuestion,
  readSuspension,
  rememberOpenQuestions,
  takeOpenQuestion,
} from './questions.js';

function openQuestion(overrides: Partial<OpenQuestion> = {}): OpenQuestion {
  return {
    id: nextQuestionId(),
    taskId: 'feature',
    agentId: 'coding',
    question: 'Email, or a push notification?',
    agentRunId: 'agent-run-1',
    toolCallId: 'call-1',
    answerField: 'userAnswer',
    ...overrides,
  };
}

beforeEach(() => {
  forgetOpenQuestions();
});

describe('reading a suspension off an agent’s stream', () => {
  it('reads the run, the tool call, the payload and the resume schema', () => {
    const chunk = {
      type: 'tool-call-suspended',
      runId: 'agent-run-1',
      payload: { toolCallId: 'call-1', suspendPayload: { question: 'Which?' }, resumeSchema: '{}' },
    };

    expect(asDelegationSuspension(chunk)).toEqual({
      agentRunId: 'agent-run-1',
      toolCallId: 'call-1',
      suspendPayload: { question: 'Which?' },
      resumeSchema: '{}',
    });
  });

  it('ignores every other chunk', () => {
    expect(asDelegationSuspension({ type: 'tool-result', runId: 'agent-run-1', payload: {} })).toBeUndefined();
    expect(asDelegationSuspension('not a chunk')).toBeUndefined();
  });
});

describe('deciding whether a suspension can be asked out loud', () => {
  const suspension = {
    agentRunId: 'agent-run-1',
    toolCallId: 'call-1',
    suspendPayload: { question: '  Email, or a push notification?  ' },
    resumeSchema: JSON.stringify({ type: 'object', properties: { userAnswer: { type: 'string' } } }),
  };

  it('asks the question, and resumes with the answer in the one text field there is', () => {
    expect(readSuspension(suspension)).toEqual({
      question: 'Email, or a push notification?',
      answerField: 'userAnswer',
    });
  });

  it('refuses a suspension that asks nothing', () => {
    expect(readSuspension({ ...suspension, suspendPayload: {} })).toHaveProperty('problem');
  });

  it('refuses an answer that has to be more than one piece of text', () => {
    const twoFields = JSON.stringify({
      type: 'object',
      properties: { approved: { type: 'boolean' }, comments: { type: 'string' } },
    });

    expect(readSuspension({ ...suspension, resumeSchema: twoFields })).toHaveProperty('problem');
  });

  it('refuses a resume schema it cannot read', () => {
    expect(readSuspension({ ...suspension, resumeSchema: 'not json' })).toHaveProperty('problem');
    expect(readSuspension({ ...suspension, resumeSchema: undefined })).toHaveProperty('problem');
  });
});

describe('a question waiting for its answer', () => {
  it('stays open until it is answered, however many requests come in between', () => {
    const question = openQuestion();
    rememberOpenQuestions([question]);

    expect(listOpenQuestions()).toEqual([question]);
    expect(listOpenQuestions()).toEqual([question]);
  });

  it('is handed over once, since an answer resumes the work exactly once', () => {
    const question = openQuestion();
    rememberOpenQuestions([question]);

    expect(takeOpenQuestion(question.id)).toEqual(question);
    expect(takeOpenQuestion(question.id)).toBeUndefined();
    expect(listOpenQuestions()).toEqual([]);
  });

  it('gets an id of its own, so the planner can say which one a request answers', () => {
    expect(openQuestion().id).not.toBe(openQuestion().id);
  });
});

describe('what the planner is shown', () => {
  it('is the request alone when nothing is waiting, exactly as before questions existed', () => {
    expect(plannerPrompt('What is the weather?', [])).toBe('What is the weather?');
  });

  it('lists the waiting questions by id after the request', () => {
    const question = openQuestion();
    const prompt = plannerPrompt('Push, please.', [question]);

    expect(prompt).toContain('Push, please.');
    expect(prompt).toContain(`"${question.id}"`);
    expect(prompt).toContain('Email, or a push notification?');
  });
});
