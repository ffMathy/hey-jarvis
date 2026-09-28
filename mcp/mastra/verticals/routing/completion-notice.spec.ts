/**
 * The notice sent when a request sir asked to be notified about is done.
 *
 * It stands in for the closing report he would otherwise have heard, so it has to carry the same
 * things: what was answered, what failed, and any question the work is waiting on him for.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { askQuestion, sendNotification } from '../notification/tools.js';
import { buildCompletionNotice, sendCompletionNotice } from './completion-notice.js';
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

    expect(notice).toEqual({
      title: 'Your request is done',
      message: 'A Claude session is implementing it.',
      expectsAnswer: false,
    });
  });

  it('asks the question the work is waiting on', () => {
    const notice = buildCompletionNotice({ all: [], questions: [QUESTION] });

    expect(notice.title).toBe('Jarvis has a question');
    expect(notice.message).toContain(QUESTION.question);
    expect(notice.expectsAnswer).toBe(true);
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

describe('sendCompletionNotice', () => {
  function spyOnDelivery() {
    const asked = spyOn(askQuestion, 'execute').mockImplementation(async () => ({
      success: true,
      channel: 'phone-call',
      reason: 'He is in the car.',
      message: 'Phone call initiated',
    }));
    const notified = spyOn(sendNotification, 'execute').mockImplementation(async () => ({
      success: true,
      channel: 'push-notification',
      target: 'Mathias',
      reason: 'He is home.',
      message: 'Push notification sent',
    }));
    return {
      asked,
      notified,
      restore() {
        asked.mockRestore();
        notified.mockRestore();
      },
    };
  }

  it('asks a question where his answer can come back, rather than sending it', async () => {
    const delivery = spyOnDelivery();

    try {
      await sendCompletionNotice({ all: [], questions: [QUESTION] });

      expect(delivery.notified).not.toHaveBeenCalled();
      expect(delivery.asked.mock.calls[0]?.[0]).toEqual({ question: expect.stringContaining(QUESTION.question) });
    } finally {
      delivery.restore();
    }
  });

  it('sends a notice that asks nothing as a notification', async () => {
    const delivery = spyOnDelivery();

    try {
      await sendCompletionNotice({
        all: [{ taskId: 'weather', agentId: 'weather', result: 'It is 8 degrees.', failed: false }],
        questions: [],
      });

      expect(delivery.asked).not.toHaveBeenCalled();
      expect(delivery.notified.mock.calls[0]?.[0]).toEqual({
        target: { type: 'user' },
        title: 'Your request is done',
        message: 'It is 8 degrees.',
      });
    } finally {
      delivery.restore();
    }
  });
});
