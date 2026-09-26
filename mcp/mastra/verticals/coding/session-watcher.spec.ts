import { describe, expect, it } from 'bun:test';
import type { StateChange } from '../synapse/state-change.js';
import type { ClaudeSessionEvent } from './claude-sessions.js';
import { ClaudeSessionWatcher, toStateChange } from './session-watcher.js';

function messageEvent(id: string, text: string): ClaudeSessionEvent {
  return { id, type: 'agent.message', text };
}

function runningEvent(id: string): ClaudeSessionEvent {
  return { id, type: 'session.status_running' };
}

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

describe('ClaudeSessionWatcher', () => {
  function watcherOver(events: ClaudeSessionEvent[][]): {
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
    );

    return { watcher, published, streamedSessionIds };
  }

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
