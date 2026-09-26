/**
 * Reading a session's history for the end of its turn.
 *
 * `waitForClaudeSessionTurn` polls a live session, which needs credentials; what it decides from
 * each poll is `readLatestTurn` over `readFinishedTurn`, and both are covered here against
 * histories of the shape the event list returns.
 */

import { describe, expect, it } from 'bun:test';
import { type ClaudeSessionEvent, readFinishedTurn, readLatestMessages, readLatestTurn } from './claude-sessions.js';

const PROCESSED_AT = '2026-09-25T10:00:00Z';

function running(id: string): ClaudeSessionEvent {
  return { id, type: 'session.status_running', processed_at: PROCESSED_AT };
}

function message(id: string, ...texts: string[]): ClaudeSessionEvent {
  return {
    id,
    type: 'agent.message',
    processed_at: PROCESSED_AT,
    content: texts.map((text) => ({ type: 'text', text })),
  };
}

function idle(id: string): ClaudeSessionEvent {
  return { id, type: 'session.status_idle', processed_at: PROCESSED_AT, stop_reason: { type: 'end_turn' } };
}

function terminated(id: string): ClaudeSessionEvent {
  return { id, type: 'session.status_terminated', processed_at: PROCESSED_AT };
}

function thinking(id: string): ClaudeSessionEvent {
  return { id, type: 'agent.thinking', processed_at: PROCESSED_AT };
}

describe('readFinishedTurn', () => {
  it('is not finished before anything has happened', () => {
    expect(readFinishedTurn([])).toBeUndefined();
  });

  it('is not finished while the session is still working', () => {
    expect(readFinishedTurn([running('1'), message('2', 'Looking into it.'), thinking('3')])).toBeUndefined();
  });

  it('returns the last thing the agent said once it goes idle', () => {
    const turn = readFinishedTurn([
      running('1'),
      message('2', 'Building the page.'),
      thinking('3'),
      message('4', 'Done.', 'https://claude.ai/artifact/abc'),
      idle('5'),
    ]);

    expect(turn).toEqual({ stopReason: 'end_turn', finalMessage: 'Done.\nhttps://claude.ai/artifact/abc' });
  });

  it('reports a session that ended for good as terminated', () => {
    expect(readFinishedTurn([running('1'), message('2', 'Giving up.'), terminated('3')])).toEqual({
      stopReason: 'terminated',
      finalMessage: 'Giving up.',
    });
  });

  it('carries the stop reason through when the session stopped for another reason', () => {
    const waiting: ClaudeSessionEvent = {
      id: '3',
      type: 'session.status_idle',
      processed_at: PROCESSED_AT,
      stop_reason: { type: 'retries_exhausted' },
    };

    expect(readFinishedTurn([running('1'), message('2', 'Trying.'), waiting])?.stopReason).toBe('retries_exhausted');
  });

  it('does not answer with a message from an earlier turn', () => {
    // A turn that ends in silence has no final message of its own, whatever the one before it said.
    const turn = readFinishedTurn([running('1'), message('2', 'First answer.'), idle('3'), running('4'), idle('5')]);

    expect(turn).toEqual({ stopReason: 'end_turn', finalMessage: '' });
  });

  it('is not finished when an earlier turn ended and a new one is under way', () => {
    expect(readFinishedTurn([running('1'), message('2', 'First answer.'), idle('3'), running('4')])).toBeUndefined();
  });
});

/**
 * A history as the event list hands it back newest first, counting how much of it was read.
 *
 * Every event read is one the API had to send, and once a page runs out the next is one more
 * request in series, so how little is read is the point of reading from the end.
 */
function newestFirst(history: ClaudeSessionEvent[]) {
  const reading = { eventsRead: 0 };

  async function* events() {
    for (const event of [...history].reverse()) {
      reading.eventsRead++;
      yield event;
    }
  }

  return { events: events(), reading };
}

/** A session that worked through many turns, the way a long analysis leaves its history. */
function longHistory(turns: number): ClaudeSessionEvent[] {
  return Array.from({ length: turns }, (_, turn) => [
    running(`${turn}-running`),
    message(`${turn}-message`, `Answer ${turn}.`),
    idle(`${turn}-idle`),
  ]).flat();
}

describe('readLatestTurn', () => {
  it('reads no further back than the start of the latest turn', async () => {
    const history = longHistory(50);
    const { events, reading } = newestFirst(history);

    expect(await readLatestTurn(events)).toEqual({ stopReason: 'end_turn', finalMessage: 'Answer 49.' });
    expect(reading.eventsRead).toBe(3);
  });

  it('answers what the whole history would have answered', async () => {
    const histories = [
      [],
      [running('1'), message('2', 'Looking into it.')],
      [running('1'), message('2', 'First answer.'), idle('3'), running('4'), idle('5')],
      [running('1'), message('2', 'First answer.'), idle('3'), running('4')],
      [running('1'), message('2', 'Giving up.'), terminated('3')],
      longHistory(3),
    ];

    for (const history of histories) {
      expect(await readLatestTurn(newestFirst(history).events)).toEqual(readFinishedTurn(history));
    }
  });
});

describe('readLatestMessages', () => {
  it('returns the latest messages oldest first, and stops reading once it has them', async () => {
    const { events, reading } = newestFirst(longHistory(50).filter((event) => event.type === 'agent.message'));

    expect(await readLatestMessages(events, 3)).toEqual(['Answer 47.', 'Answer 48.', 'Answer 49.']);
    expect(reading.eventsRead).toBe(3);
  });

  it('passes over messages with no text in them', async () => {
    const { events } = newestFirst([message('1', 'Started.'), message('2'), message('3', '  '), message('4', 'Done.')]);

    expect(await readLatestMessages(events, 5)).toEqual(['Started.', 'Done.']);
  });

  it('reads nothing when no messages are wanted', async () => {
    const { events, reading } = newestFirst([message('1', 'Started.')]);

    expect(await readLatestMessages(events, 0)).toEqual([]);
    expect(reading.eventsRead).toBe(0);
  });
});
