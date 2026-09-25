/**
 * Reading a session's history for the end of its turn.
 *
 * `waitForClaudeSessionTurn` polls a live session, which needs credentials; what it decides from
 * each poll is `readFinishedTurn`, and that is covered here against histories of the shape the
 * event list returns.
 */

import { describe, expect, it } from 'bun:test';
import { type ClaudeSessionEvent, readFinishedTurn } from './claude-sessions.js';

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
