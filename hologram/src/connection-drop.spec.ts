import { describe, expect, it } from 'bun:test';
import { isDroppedLine } from './connection-drop';

/**
 * Each ending in the shape `@elevenlabs/client` 1.24.0 gives it (read from `WebRTCConnection`,
 * `WebSocketConnection` and `BaseConversation`), with LiveKit 2.22's reasons as numbers.
 */
describe('telling a dropped line from a call that is over', () => {
  it('counts LiveKit giving up on the room as the line', () => {
    expect(
      isDroppedLine({
        reason: 'error',
        message: 'LiveKit connection state changed to disconnected',
        context: { type: 'connection_state_changed' },
      }),
    ).toBe(true);
  });

  it('counts the agent seeming to leave, as LiveKit rejoining from scratch makes it, as the line', () => {
    expect(isDroppedLine({ reason: 'agent', context: { type: 'close', reason: 'agent disconnected' } })).toBe(true);
  });

  it('counts a written conversation’s socket failing or closing abnormally as the line', () => {
    expect(
      isDroppedLine({
        reason: 'error',
        message: 'The connection was closed due to a socket error.',
        context: { type: 'error' },
      }),
    ).toBe(true);
    expect(
      isDroppedLine({
        reason: 'error',
        message: 'The connection was closed by the server.',
        context: { type: 'close', code: 1006 },
      }),
    ).toBe(true);
  });

  it('leaves the call over when the agent hangs up, the room is closed, or the server ends it', () => {
    expect(isDroppedLine({ reason: 'agent', context: { type: 'end_call', reason: 'Agent ended the call' } })).toBe(
      false,
    );
    // `RoomEvent.Disconnected` with `ROOM_DELETED`.
    expect(isDroppedLine({ reason: 'agent', context: { type: 'close', reason: '5' } })).toBe(false);
    expect(isDroppedLine({ reason: 'agent', context: { type: 'close', code: 1000 } })).toBe(false);
    expect(
      isDroppedLine({
        reason: 'error',
        message: 'Maximum conversation duration exceeded',
        context: { type: 'max_duration_exceeded' },
      }),
    ).toBe(false);
    expect(isDroppedLine({ reason: 'error', message: 'Quota exceeded', context: { type: 'close', code: 1008 } })).toBe(
      false,
    );
    expect(isDroppedLine({ reason: 'user' })).toBe(false);
  });
});
