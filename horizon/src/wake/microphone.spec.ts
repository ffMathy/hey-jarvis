import { describe, expect, it } from 'bun:test';
import {
  describeMicrophoneError,
  MICROPHONE_BLOCKED,
  MICROPHONE_TIMEOUT_MILLISECONDS,
  type MicrophoneTimers,
  microphoneConstraints,
  microphonePermission,
  openMicrophoneFrom,
} from './microphone';

/** A stream whose one track records being stopped. */
function fakeStream() {
  const track = {
    stopped: false,
    stop() {
      track.stopped = true;
    },
  };
  return { stream: { getTracks: () => [track] }, track };
}

/** Timers the test fires by hand. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  const next = 1;
  const timers: MicrophoneTimers = {
    setTimeout: (callback, milliseconds) => {
      expect(milliseconds).toBe(MICROPHONE_TIMEOUT_MILLISECONDS);
      pending.set(next, callback);
      return setTimeout(() => undefined, 0);
    },
    clearTimeout: () => pending.clear(),
  };
  return {
    timers,
    fire: () => {
      for (const callback of pending.values()) callback();
      pending.clear();
    },
    pending,
  };
}

describe('the microphone constraints', () => {
  it('turn the processing on for the processed profile, as the ElevenLabs SDK does', () => {
    expect(microphoneConstraints('processed')).toEqual({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  });

  it('turn it all off for the raw profile', () => {
    expect(microphoneConstraints('raw')).toEqual({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  });
});

describe('a microphone failure', () => {
  it('reads as what to do about it', () => {
    expect(describeMicrophoneError(new DOMException('denied', 'NotAllowedError'))).toBe(MICROPHONE_BLOCKED);
    expect(describeMicrophoneError(new DOMException('none', 'NotFoundError'))).toBe('No microphone was found.');
    expect(describeMicrophoneError(new DOMException('busy', 'NotReadableError'))).toContain('busy');
    expect(describeMicrophoneError(new Error('odd'))).toBe('The microphone could not be opened: odd');
    expect(describeMicrophoneError('odd')).toBe('The microphone could not be opened: odd');
  });
});

describe('opening the wake microphone', () => {
  it('asks for the profile’s constraints and resolves the stream', async () => {
    const { stream } = fakeStream();
    const asked: MediaStreamConstraints[] = [];
    const { timers, pending } = manualTimers();
    const opened = await openMicrophoneFrom(
      'raw',
      {
        getUserMedia: async (constraints) => {
          asked.push(constraints);
          return stream;
        },
      },
      timers,
    );
    expect(opened).toBe(stream);
    expect(asked).toEqual([microphoneConstraints('raw')]);
    expect(pending.size).toBe(0);
  });

  it('rejects with readable words when the browser refuses', async () => {
    const { timers } = manualTimers();
    const refused = openMicrophoneFrom(
      'processed',
      { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
      timers,
    );
    await expect(refused).rejects.toThrow(MICROPHONE_BLOCKED);
  });

  it('gives up after 8 s, and stops a stream that arrives after that', async () => {
    const { stream, track } = fakeStream();
    let answer: (stream: ReturnType<typeof fakeStream>['stream']) => void = () => undefined;
    const { timers, fire } = manualTimers();
    const opening = openMicrophoneFrom(
      'processed',
      {
        getUserMedia: () =>
          new Promise<ReturnType<typeof fakeStream>['stream']>((resolve) => {
            answer = resolve;
          }),
      },
      timers,
    );
    fire();
    await expect(opening).rejects.toThrow('did not answer within 8 seconds');
    answer(stream);
    await Promise.resolve();
    expect(track.stopped).toBe(true);
  });

  it('says so when the page has no microphone API at all', async () => {
    await expect(openMicrophoneFrom('processed', undefined, manualTimers().timers)).rejects.toThrow('HTTPS');
  });
});

describe('the microphone permission', () => {
  it('is what the browser says', async () => {
    for (const state of ['granted', 'denied', 'prompt'] as const) {
      const permission = await microphonePermission({
        query: async (descriptor) => {
          expect(descriptor).toEqual({ name: 'microphone' });
          return { state };
        },
      });
      expect(permission).toBe(state);
    }
  });

  it('is unknown where the browser cannot say', async () => {
    expect(await microphonePermission(undefined)).toBe('unknown');
    expect(
      await microphonePermission({
        query: () => Promise.reject(new TypeError('microphone is not a valid permission name')),
      }),
    ).toBe('unknown');
  });
});
