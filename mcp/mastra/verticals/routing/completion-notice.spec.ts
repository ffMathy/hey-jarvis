/**
 * The notice sent when a request sir asked to be notified about is done.
 *
 * It stands in for the closing report he would otherwise have heard, so it has to carry the same
 * things: what was answered, what failed, and any question the work is waiting on him for.
 */

import { describe, expect, it } from 'bun:test';
import { buildCompletionNotice } from './completion-notice.js';
import type { OpenQuestion } from './questions.js';

const QUESTION: OpenQuestion = {
  id: 'q1',
  taskId: 'feature',
  agentId: 'coding',
  question: 'Should the reminder go out by email, or as a push notification?',
  agentRunId: 'agent-run-1',
  toolCallId: 'call-1',
  answerField: 'userAnswer',
};

describe('buildCompletionNotice', () => {
  it('relays what the request answered', () => {
    const notice = buildCompletionNotice({
      all: [{ taskId: 'feature', agentId: 'coding', result: 'A Claude session is implementing it.', failed: false }],
      questions: [],
    });

    expect(notice).toEqual({ title: 'Your request is done', message: 'A Claude session is implementing it.' });
  });

  it('asks the question the work is waiting on', () => {
    const notice = buildCompletionNotice({ all: [], questions: [QUESTION] });

    expect(notice.title).toBe('Jarvis has a question');
    expect(notice.message).toContain(QUESTION.question);
  });

  it('says what failed', () => {
    const notice = buildCompletionNotice({
      all: [{ taskId: 'feature', agentId: 'coding', result: 'did not report a result', failed: true }],
      questions: [],
    });

    expect(notice.message).toBe('The feature part did not report a result.');
  });

  it('says a request failed outright, with whatever it answered first', () => {
    const notice = buildCompletionNotice({
      all: [{ taskId: 'weather', agentId: 'weather', result: 'It is 8 degrees.', failed: false }],
      questions: [],
      error: 'the planner timed out',
    });

    expect(notice.title).toBe('Your request could not be completed');
    expect(notice.message).toBe('Your request could not be completed: the planner timed out. It is 8 degrees.');
  });
});
