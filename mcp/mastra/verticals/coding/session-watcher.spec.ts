import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { askQuestion } from '../notification/tools.js';
import { forgetOpenQuestions, isAnsweredByQuestion, listOpenQuestions } from '../routing/questions.js';
import type { StateChange } from '../synapse/state-change.js';
import type { ClaudeSessionEvent } from './claude-sessions.js';
import type { PublishTarget, SessionWorkPublication } from './publish-session-work.js';
import {
  ClaudeSessionWatcher,
  createSessionQuestionAsker,
  type SessionQuestionAsker,
  type SessionWorkPublisher,
  toPublicationStateChange,
  toQuestionStateChange,
  toStateChange,
} from './session-watcher.js';

function messageEvent(id: string, text: string): ClaudeSessionEvent {
  return { id, type: 'agent.message', text };
}

function runningEvent(id: string): ClaudeSessionEvent {
  return { id, type: 'session.status_running' };
}

function idleEvent(id: string, stopReason = 'end_turn'): ClaudeSessionEvent {
  return { id, type: 'session.status_idle', stopReason };
}

const PUBLISHED: SessionWorkPublication = {
  status: 'published',
  branch: 'jarvis/add-greeting',
  pullRequest: { number: 42, url: 'https://github.com/ffMathy/hey-jarvis/pull/42' },
  created: true,
};

/** Waits for the watcher's detached event loop to drain. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('toStateChange', () => {
  it('attributes the state change to the coding vertical', () => {
    const stateChange = toStateChange(messageEvent('sevt_1', 'Opened the pull request'), 'sess_1');

    expect(stateChange.source).toBe('coding');
    expect(stateChange.stateType).toBe('coding_session_agent_message');
    expect(stateChange.stateData.sessionId).toBe('sess_1');
    expect(stateChange.stateData.eventId).toBe('sevt_1');
    expect(stateChange.stateData.message).toBe('Opened the pull request');
  });

  it('carries the task context so notifications can name what is happening', () => {
    const stateChange = toStateChange(messageEvent('sevt_1', 'Working on it'), 'sess_1', {
      repository: 'ffMathy/hey-jarvis',
      issueNumber: 42,
      title: 'Add email notifications',
    });

    expect(stateChange.stateData.repository).toBe('ffMathy/hey-jarvis');
    expect(stateChange.stateData.issueNumber).toBe(42);
    expect(stateChange.stateData.task).toBe('Add email notifications');
  });

  it('reports why a session went idle', () => {
    const stateChange = toStateChange({ id: 'sevt_2', type: 'session.status_idle', stopReason: 'end_turn' }, 'sess_1');

    expect(stateChange.stateType).toBe('coding_session_session_status_idle');
    expect(stateChange.stateData.stopReason).toBe('end_turn');
  });

  it('reports session errors', () => {
    const stateChange = toStateChange({ id: 'sevt_3', type: 'session.error', message: 'Connection refused' }, 'sess_1');

    expect(stateChange.stateType).toBe('coding_session_session_error');
    expect(stateChange.stateData.error).toBe('Connection refused');
  });

  it('truncates long messages so one event cannot swamp the batch', () => {
    const stateChange = toStateChange(messageEvent('sevt_4', 'x'.repeat(2000)), 'sess_1');

    expect(String(stateChange.stateData.message).length).toBeLessThanOrEqual(500);
    expect(String(stateChange.stateData.message)).toContain('...');
  });

  it('omits the message when the event carries no text', () => {
    const stateChange = toStateChange(runningEvent('sevt_5'), 'sess_1');

    expect(stateChange.stateData.message).toBeUndefined();
  });
});

describe('toPublicationStateChange', () => {
  const context = { repository: 'ffMathy/hey-jarvis', title: 'Add a greeting' };

  it('carries the pull request a session’s work was published as', () => {
    const stateChange = toPublicationStateChange(PUBLISHED, 'sess_1', 'sevt_9', context);

    expect(stateChange.source).toBe('coding');
    expect(stateChange.stateType).toBe('coding_session_pull_request_opened');
    expect(stateChange.stateData).toMatchObject({
      sessionId: 'sess_1',
      eventId: 'sevt_9',
      repository: 'ffMathy/hey-jarvis',
      task: 'Add a greeting',
      branch: 'jarvis/add-greeting',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/ffMathy/hey-jarvis/pull/42',
      created: true,
    });
  });

  it.each([
    ['refused', true],
    ['failed', false],
  ] as const)('says why a session’s work was not published, when it %s', (status, refused) => {
    const stateChange = toPublicationStateChange({ status, reason: 'It changes CI.' }, 'sess_1', 'sevt_9', context);

    expect(stateChange.stateType).toBe('coding_session_pull_request_failed');
    expect(stateChange.stateData).toMatchObject({ refused, error: 'It changes CI.' });
  });
});

describe('ClaudeSessionWatcher', () => {
  function watcherOver(
    events: ClaudeSessionEvent[][],
    publishWork?: SessionWorkPublisher,
    askSessionQuestion?: SessionQuestionAsker,
  ): {
    watcher: ClaudeSessionWatcher;
    published: StateChange[];
    streamedSessionIds: string[];
  } {
    const published: StateChange[] = [];
    const streamedSessionIds: string[] = [];
    const streams = [...events];

    const watcher = new ClaudeSessionWatcher(
      async function* (sessionId) {
        streamedSessionIds.push(sessionId);
        const batch = streams.shift();
        if (!batch) {
          return;
        }
        for (const event of batch) {
          yield event;
        }
      },
      async (stateChange) => {
        published.push(stateChange);
      },
      0,
      publishWork,
      askSessionQuestion,
    );

    return { watcher, published, streamedSessionIds };
  }

  /** Records what it is asked to publish, and answers with `publication`. */
  function recordingPublisher(publication: SessionWorkPublication = PUBLISHED) {
    const calls: { sessionId: string; target: PublishTarget; finalMessage: string }[] = [];
    const publishWork: SessionWorkPublisher = async (sessionId, target, finalMessage) => {
      calls.push({ sessionId, target, finalMessage });
      return publication;
    };
    return { calls, publishWork };
  }

  const PUBLISH_TO = { owner: 'ffMathy', repo: 'hey-jarvis' };

  it('publishes the work of a turn that finished, from what the agent said last in it', async () => {
    const { calls, publishWork } = recordingPublisher();
    const { watcher, published } = watcherOver(
      [
        [
          runningEvent('sevt_1'),
          messageEvent('sevt_2', 'Cloning.'),
          messageEvent('sevt_3', 'Done. ```jarvis-pull-request ...```'),
          idleEvent('sevt_4'),
        ],
      ],
      publishWork,
    );

    watcher.watch('sess_1', { repository: 'ffMathy/hey-jarvis', publishTo: PUBLISH_TO });
    await settle();

    expect(calls).toEqual([
      { sessionId: 'sess_1', target: PUBLISH_TO, finalMessage: 'Done. ```jarvis-pull-request ...```' },
    ]);
    expect(published.map((change) => change.stateType).slice(-2)).toEqual([
      'coding_session_session_status_idle',
      'coding_session_pull_request_opened',
    ]);
    expect(published[published.length - 1]?.stateData.pullRequestUrl).toBe(
      'https://github.com/ffMathy/hey-jarvis/pull/42',
    );
  });

  it('reads each turn’s own last message, not an earlier turn’s', async () => {
    const { calls, publishWork } = recordingPublisher();
    const { watcher } = watcherOver(
      [
        [
          runningEvent('sevt_1'),
          messageEvent('sevt_2', 'Should it be in Danish?'),
          idleEvent('sevt_3'),
          runningEvent('sevt_4'),
          idleEvent('sevt_5'),
        ],
      ],
      publishWork,
    );

    watcher.watch('sess_1', { publishTo: PUBLISH_TO });
    await settle();

    expect(calls.map((call) => call.finalMessage)).toEqual(['Should it be in Danish?', '']);
  });

  it('publishes nothing for a session that was not started to implement a change', async () => {
    const { calls, publishWork } = recordingPublisher();
    const { watcher } = watcherOver(
      [[runningEvent('sevt_1'), messageEvent('sevt_2', 'Here is the answer.'), idleEvent('sevt_3')]],
      publishWork,
    );

    watcher.watch('sess_1', { repository: 'ffMathy/hey-jarvis' });
    await settle();

    expect(calls).toEqual([]);
  });

  it.each(['timed_out', 'process_exited', 'error_during_execution'])(
    'publishes nothing for a turn that stopped with %s',
    async (stopReason) => {
      const { calls, publishWork } = recordingPublisher();
      const { watcher } = watcherOver([[runningEvent('sevt_1'), idleEvent('sevt_2', stopReason)]], publishWork);

      watcher.watch('sess_1', { publishTo: PUBLISH_TO });
      await settle();

      expect(calls).toEqual([]);
    },
  );

  it('publishes a turn once, even when a reconnect replays it', async () => {
    const { calls, publishWork } = recordingPublisher();
    const turn = [runningEvent('sevt_1'), messageEvent('sevt_2', 'Done.'), idleEvent('sevt_3')];
    let attempts = 0;
    const watcher = new ClaudeSessionWatcher(
      async function* () {
        attempts++;
        yield* turn;
        if (attempts === 1) {
          throw new Error('connection reset');
        }
      },
      async () => {},
      0,
      publishWork,
    );

    watcher.watch('sess_1', { publishTo: PUBLISH_TO });
    await settle();
    await settle();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(calls).toHaveLength(1);
  });

  it('reports nothing more for a turn that did not end on finished work', async () => {
    const { watcher, published } = watcherOver([[runningEvent('sevt_1'), idleEvent('sevt_2')]], async () => undefined);

    watcher.watch('sess_1', { publishTo: PUBLISH_TO });
    await settle();

    expect(published.map((change) => change.stateType)).toEqual([
      'coding_session_session_status_running',
      'coding_session_session_status_idle',
    ]);
  });

  it('reports a publisher that throws as work that was not published', async () => {
    const { watcher, published } = watcherOver([[runningEvent('sevt_1'), idleEvent('sevt_2')]], async () => {
      throw new Error('disk full');
    });

    watcher.watch('sess_1', { publishTo: PUBLISH_TO });
    await settle();

    expect(published[published.length - 1]?.stateType).toBe('coding_session_pull_request_failed');
    expect(published[published.length - 1]?.stateData).toMatchObject({ refused: false, error: 'disk full' });
  });

  it('asks the user the question a turn ended on, and publishes nothing', async () => {
    const { calls, publishWork } = recordingPublisher();
    const asked: { sessionId: string; question: string; title?: string }[] = [];
    const { watcher, published } = watcherOver(
      [
        [
          runningEvent('sevt_1'),
          messageEvent('sevt_2', 'I read the code.\n\n```jarvis-question\nShould it be in Danish, or English?\n```'),
          idleEvent('sevt_3'),
        ],
      ],
      publishWork,
      async (sessionId, question, context) => {
        asked.push({ sessionId, question, title: context.title });
        return { status: 'asked', questionId: 'q1', channel: 'phone-call', reason: 'He is in the car.' };
      },
    );

    watcher.watch('sess_1', { title: 'Add a greeting', publishTo: PUBLISH_TO });
    await settle();

    expect(asked).toEqual([
      { sessionId: 'sess_1', question: 'Should it be in Danish, or English?', title: 'Add a greeting' },
    ]);
    expect(calls).toEqual([]);
    expect(published[published.length - 1]).toMatchObject({
      stateType: 'coding_session_question_asked',
      stateData: { question: 'Should it be in Danish, or English?', questionId: 'q1', channel: 'phone-call' },
    });
  });

  it('reports a question that could not be asked', async () => {
    const { watcher, published } = watcherOver(
      [[runningEvent('sevt_1'), messageEvent('sevt_2', '```jarvis-question\nDanish?\n```'), idleEvent('sevt_3')]],
      async () => undefined,
      async () => {
        throw new Error('no phone number is configured');
      },
    );

    watcher.watch('sess_1', { publishTo: PUBLISH_TO });
    await settle();

    expect(published[published.length - 1]).toMatchObject({
      stateType: 'coding_session_question_failed',
      stateData: { question: 'Danish?', error: 'no phone number is configured' },
    });
  });

  it('forwards each event into synapse', async () => {
    const { watcher, published } = watcherOver([[runningEvent('sevt_1'), messageEvent('sevt_2', 'Pushed a branch')]]);

    watcher.watch('sess_1', { repository: 'ffMathy/hey-jarvis' });
    await settle();

    expect(published.map((change) => change.stateType)).toEqual([
      'coding_session_session_status_running',
      'coding_session_agent_message',
    ]);
    expect(published.every((change) => change.source === 'coding')).toBe(true);
  });

  it('never reports the same event twice, even when a stream replays it', async () => {
    const { watcher, published } = watcherOver([[messageEvent('sevt_1', 'Hello'), messageEvent('sevt_1', 'Hello')]]);

    watcher.watch('sess_1');
    await settle();

    expect(published).toHaveLength(1);
  });

  it('watches a session only once', async () => {
    const { watcher, streamedSessionIds } = watcherOver([[], []]);

    watcher.watch('sess_1');
    watcher.watch('sess_1');

    expect(streamedSessionIds).toEqual(['sess_1']);
  });

  it('keeps going when a state change fails to register', async () => {
    const published: StateChange[] = [];
    let attempts = 0;

    const watcher = new ClaudeSessionWatcher(
      async function* () {
        yield messageEvent('sevt_1', 'first');
        yield messageEvent('sevt_2', 'second');
      },
      async (stateChange) => {
        attempts++;
        if (attempts === 1) {
          throw new Error('synapse unavailable');
        }
        published.push(stateChange);
      },
      0,
    );

    watcher.watch('sess_1');
    await settle();

    expect(attempts).toBe(2);
    expect(published).toHaveLength(1);
  });

  it('forgets a session once its stream ends', async () => {
    const { watcher } = watcherOver([[messageEvent('sevt_1', 'done')]]);

    watcher.watch('sess_1');
    expect(watcher.getWatchedSessionIds()).toEqual(['sess_1']);

    await settle();

    expect(watcher.getWatchedSessionIds()).toEqual([]);
  });

  it('stops streaming when a watch is cancelled', async () => {
    let aborted = false;

    const watcher = new ClaudeSessionWatcher(
      async function* (_sessionId, signal) {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        yield messageEvent('sevt_1', 'working');
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      async () => {},
      0,
    );

    watcher.watch('sess_1');
    await settle();
    watcher.unwatch('sess_1');

    expect(aborted).toBe(true);
    expect(watcher.getWatchedSessionIds()).toEqual([]);
  });

  it('reconnects a stream that fails before giving up', async () => {
    const published: StateChange[] = [];
    let attempts = 0;

    const watcher = new ClaudeSessionWatcher(
      async function* () {
        attempts++;
        if (attempts === 1) {
          throw new Error('connection reset');
        }
        yield messageEvent('sevt_1', 'recovered');
      },
      async (stateChange) => {
        published.push(stateChange);
      },
      0,
    );

    watcher.watch('sess_1');
    await settle();
    await settle();

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(published).toHaveLength(1);
  });
});

describe('toQuestionStateChange', () => {
  it('names the question and how it reached the user', () => {
    const stateChange = toQuestionStateChange(
      'Danish?',
      { status: 'asked', questionId: 'q1', channel: 'voice-announcement', reason: 'He is home.' },
      'sess_1',
      'sevt_3',
      { title: 'Add a greeting' },
    );

    expect(stateChange).toEqual({
      source: 'coding',
      stateType: 'coding_session_question_asked',
      stateData: {
        sessionId: 'sess_1',
        eventId: 'sevt_3',
        task: 'Add a greeting',
        question: 'Danish?',
        questionId: 'q1',
        channel: 'voice-announcement',
        reason: 'He is home.',
      },
    });
  });
});

describe('createSessionQuestionAsker', () => {
  afterEach(() => {
    forgetOpenQuestions();
  });

  it('asks the user, and hands his answer to the session that asked', async () => {
    const askSpy = spyOn(askQuestion, 'execute').mockImplementation(async () => ({
      success: true,
      channel: 'phone-call',
      reason: 'He is in the car.',
      message: 'Phone call initiated',
    }));
    const sent: { sessionId: string; message: string }[] = [];

    try {
      const asking = await createSessionQuestionAsker(async (sessionId, message) => {
        sent.push({ sessionId, message });
      })('sess_1', 'Danish, or English?', { title: 'Add a greeting' });

      expect(asking).toMatchObject({ status: 'asked', channel: 'phone-call' });
      expect(askSpy.mock.calls[0]?.[0]).toEqual({ question: 'Danish, or English?', about: 'Add a greeting' });

      const [question] = listOpenQuestions();
      expect(question).toMatchObject({ taskId: 'Add a greeting', agentId: 'coding', question: 'Danish, or English?' });
      if (!question || !isAnsweredByQuestion(question)) {
        throw new Error('The question was not opened with a function to answer it');
      }

      expect(await question.deliverAnswer('Danish, please.')).toContain('Add a greeting');
      expect(sent).toEqual([{ sessionId: 'sess_1', message: 'Danish, please.' }]);
    } finally {
      askSpy.mockRestore();
    }
  });

  it('keeps the question open when it could not be asked, for his next word to Jarvis', async () => {
    const askSpy = spyOn(askQuestion, 'execute').mockImplementation(async () => ({
      success: false,
      channel: 'voice-announcement',
      reason: 'He is home.',
      message: 'No Hey Jarvis voice device exposes an announce service.',
    }));

    try {
      const asking = await createSessionQuestionAsker(async () => {})('sess_1', 'Danish?', {});

      expect(asking).toEqual({ status: 'failed', error: 'No Hey Jarvis voice device exposes an announce service.' });
      expect(listOpenQuestions()).toMatchObject([{ question: 'Danish?', taskId: 'Claude Code session sess_1' }]);
    } finally {
      askSpy.mockRestore();
    }
  });
});
