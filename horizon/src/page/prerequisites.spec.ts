import { describe, expect, it } from 'bun:test';
import { canOpenWithoutAgent, microphoneHelp, type PageFacts, primaryButton } from './prerequisites';

/** Everything done: the button enters the room. Each test takes one step away. */
const READY: PageFacts = {
  xr: 'supported',
  hasSettings: true,
  preparation: { state: 'done' },
  microphone: 'granted',
  room: 'outside',
};

describe('primaryButton', () => {
  it('enters the room once every step is done', () => {
    expect(primaryButton(READY)).toEqual({ label: 'Enter your room', enabled: true, action: 'enter-room' });
  });

  it('waits while the browser is being checked, and says where to go when it cannot open a room', () => {
    expect(primaryButton({ ...READY, xr: 'checking' })).toEqual({
      label: 'Checking this browser…',
      enabled: false,
      action: 'none',
    });
    expect(primaryButton({ ...READY, xr: 'unsupported' }).label).toBe('Open this page on a Meta Quest');
  });

  it('asks for the ElevenLabs key before anything else', () => {
    const button = primaryButton({ ...READY, hasSettings: false, preparation: { state: 'running', fraction: 0.2 } });
    expect(button).toEqual({ label: 'Add your ElevenLabs key first', enabled: false, action: 'none' });
  });

  it('shows how far getting ready has got, in whole percent', () => {
    expect(primaryButton({ ...READY, preparation: { state: 'running', fraction: 0.426 } })).toEqual({
      label: 'Getting Jarvis ready… 42%',
      enabled: false,
      action: 'none',
      progress: 0.426,
    });
    expect(primaryButton({ ...READY, preparation: { state: 'running', fraction: 1.3 } }).progress).toBe(1);
  });

  it('offers to try again when getting ready failed', () => {
    expect(primaryButton({ ...READY, preparation: { state: 'failed', problem: 'offline' } })).toEqual({
      label: 'Try getting ready again',
      enabled: true,
      action: 'retry-preparation',
    });
  });

  it('asks for the microphone as its own step, before the room', () => {
    for (const microphone of ['prompt', 'unknown'] as const) {
      expect(primaryButton({ ...READY, microphone })).toEqual({
        label: 'Allow the microphone',
        enabled: true,
        action: 'ask-microphone',
      });
    }
    expect(primaryButton({ ...READY, microphone: 'asking' }).enabled).toBe(false);
  });

  it('cannot help when the microphone is blocked', () => {
    expect(primaryButton({ ...READY, microphone: 'denied' })).toEqual({
      label: 'The microphone is blocked',
      enabled: false,
      action: 'none',
    });
  });

  it('skips the microphone for a room that does not listen', () => {
    expect(primaryButton({ ...READY, microphone: undefined }).action).toBe('enter-room');
  });

  it('says so while the room is opening and while it is open', () => {
    expect(primaryButton({ ...READY, room: 'entering' }).label).toBe('Opening your room…');
    expect(primaryButton({ ...READY, room: 'inside' })).toEqual({
      label: 'Jarvis is in your room',
      enabled: false,
      action: 'none',
    });
  });

  it('walks the steps in order as each is done', () => {
    const walk: PageFacts[] = [
      { ...READY, hasSettings: false, preparation: { state: 'running', fraction: 0 }, microphone: 'prompt' },
      { ...READY, preparation: { state: 'running', fraction: 0.5 }, microphone: 'prompt' },
      { ...READY, microphone: 'prompt' },
      { ...READY, microphone: 'asking' },
      READY,
      { ...READY, room: 'entering' },
      { ...READY, room: 'inside' },
      READY,
    ];
    expect(walk.map((facts) => primaryButton(facts).label)).toEqual([
      'Add your ElevenLabs key first',
      'Getting Jarvis ready… 50%',
      'Allow the microphone',
      'Allow the microphone…',
      'Enter your room',
      'Opening your room…',
      'Jarvis is in your room',
      'Enter your room',
    ]);
  });
});

describe('canOpenWithoutAgent', () => {
  it('needs only a browser that can open a room, and nobody in it', () => {
    expect(canOpenWithoutAgent({ ...READY, hasSettings: false, preparation: { state: 'running', fraction: 0 } })).toBe(
      true,
    );
    expect(canOpenWithoutAgent({ ...READY, microphone: 'denied' })).toBe(true);
    expect(canOpenWithoutAgent({ ...READY, xr: 'unsupported' })).toBe(false);
    expect(canOpenWithoutAgent({ ...READY, xr: 'checking' })).toBe(false);
    expect(canOpenWithoutAgent({ ...READY, room: 'entering' })).toBe(false);
    expect(canOpenWithoutAgent({ ...READY, room: 'inside' })).toBe(false);
  });
});

describe('microphoneHelp', () => {
  it('explains how to unblock the microphone, and offers sample mode', () => {
    const help = microphoneHelp('denied');
    expect(help).toContain('lock icon');
    expect(help).toContain('reload');
    expect(help).toContain('without it');
  });

  it('has nothing to say otherwise', () => {
    for (const microphone of ['granted', 'prompt', 'unknown', 'asking', undefined] as const) {
      expect(microphoneHelp(microphone)).toBeUndefined();
    }
  });
});
