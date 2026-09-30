import { describe, expect, it } from 'bun:test';
import {
  CONNECTION_PROBLEM,
  DROPPED_PROBLEM,
  describeDisconnect,
  describeStartFailure,
  describeTokenFailure,
  ENDED_UNEXPECTEDLY_PROBLEM,
  MICROPHONE_PROBLEM,
  OFFLINE_PROBLEM,
  UNREACHABLE_PROBLEM,
} from './failure-text';

/**
 * What a failed summoning says. The phone's texts wherever it had one; the raw texts it used to
 * show verbatim — the platform's word for being offline and LiveKit's for a closed room — replaced.
 */
describe('explaining a failed summoning', () => {
  it('passes the token request’s own explanations on as they are', () => {
    const explained = new Error('ElevenLabs rejected the API key. Check it in the settings.');
    expect(describeTokenFailure(explained)).toBe('ElevenLabs rejected the API key. Check it in the settings.');
  });

  it('says the device is offline, whichever platform’s words for it arrived', () => {
    const words = [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'Network request failed',
    ];
    for (const said of words) {
      expect(describeTokenFailure(new TypeError(said))).toBe(OFFLINE_PROBLEM);
      expect(describeStartFailure(new TypeError(said))).toBe(OFFLINE_PROBLEM);
    }
  });

  it('says it in the device’s own words when it has some', () => {
    const headset = 'ElevenLabs could not be reached. Check that the headset is connected to the internet.';
    expect(describeTokenFailure(new TypeError('Failed to fetch'), headset)).toBe(headset);
    expect(describeStartFailure(new TypeError('Failed to fetch'), headset)).toBe(headset);
  });

  it('names a refused microphone', () => {
    expect(describeStartFailure(new DOMException('Permission denied', 'NotAllowedError'))).toBe(MICROPHONE_PROBLEM);
    expect(describeStartFailure(new DOMException('Insecure', 'SecurityError'))).toBe(MICROPHONE_PROBLEM);
  });

  it('says the connection could not be opened rather than repeating LiveKit’s signalling', () => {
    // Shaped like livekit-client's own: an Error named `ConnectionError`, with this very message
    // from a browser whose socket to LiveKit was closed.
    const refused = Object.assign(
      new Error('could not establish signal connection: Websocket got closed during a (re)connection attempt:'),
      { name: 'ConnectionError' },
    );
    expect(describeStartFailure(refused)).toBe(CONNECTION_PROBLEM);
  });

  it('falls back to the phone’s words when there is nothing to say, or nothing safe to say', () => {
    expect(describeStartFailure(new Error('   '))).toBe(UNREACHABLE_PROBLEM);
    expect(describeStartFailure(undefined)).toBe(UNREACHABLE_PROBLEM);
    expect(describeTokenFailure(new Error('rejected sk_abcdef123456'))).toBe(UNREACHABLE_PROBLEM);
    expect(describeStartFailure('wss://livekit/rtc?access_token=abc')).toBe(UNREACHABLE_PROBLEM);
  });

  it('says the connection dropped instead of LiveKit’s sentence about its state', () => {
    expect(describeDisconnect('LiveKit connection state changed to disconnected')).toBe(DROPPED_PROBLEM);
  });

  it('passes any other ending on, or the phone’s words when it came with none', () => {
    expect(describeDisconnect('Maximum conversation duration exceeded')).toBe('Maximum conversation duration exceeded');
    expect(describeDisconnect(undefined)).toBe(ENDED_UNEXPECTEDLY_PROBLEM);
    expect(describeDisconnect('')).toBe(ENDED_UNEXPECTEDLY_PROBLEM);
    expect(describeDisconnect('token eyJhbGciOiJIUzI1NiJ9 expired')).toBe(ENDED_UNEXPECTEDLY_PROBLEM);
  });
});
