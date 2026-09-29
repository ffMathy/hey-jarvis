import { describe, expect, it } from 'bun:test';
import { describeMicrophoneFailure, foldPermissionState } from './microphone';

describe('foldPermissionState', () => {
  it('keeps the three answers the page acts on', () => {
    expect(foldPermissionState('granted')).toBe('granted');
    expect(foldPermissionState('denied')).toBe('denied');
    expect(foldPermissionState('prompt')).toBe('prompt');
  });

  it('calls anything else unknown', () => {
    expect(foldPermissionState('')).toBe('unknown');
    expect(foldPermissionState('something-new')).toBe('unknown');
  });
});

describe('describeMicrophoneFailure', () => {
  function named(name: string, message = '') {
    const error = new Error(message);
    error.name = name;
    return error;
  }

  it('says what to do about each way getUserMedia fails', () => {
    expect(describeMicrophoneFailure(named('NotFoundError'))).toContain('no microphone');
    expect(describeMicrophoneFailure(named('NotReadableError'))).toContain('busy');
    expect(describeMicrophoneFailure(named('SecurityError'))).toContain('HTTPS');
  });

  it('passes anything else on with its own message', () => {
    expect(describeMicrophoneFailure(named('TypeError', 'no audio'))).toBe(
      'The microphone could not be opened: no audio',
    );
    expect(describeMicrophoneFailure('odd')).toBe('The microphone could not be opened.');
  });
});
