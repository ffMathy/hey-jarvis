import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GREETING_GRACE_SECONDS, isGreetingOver, WITHOUT_FIRST_MESSAGE } from './greeting-handover';
import { GREETING_SECONDS } from './greeting-voice';

const REPOSITORY = join(import.meta.dir, '..', '..');

/** One value out of parsed JSON, followed key by key, or `undefined` wherever the path breaks. */
function readPath(value: unknown, keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (current, key) => (typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined),
    value,
  );
}

/**
 * When the recorded greeting hands the conversation back: to the agent's voice, and to the
 * microphone that was muted so the agent would not hear Jarvis greet through the speaker.
 */
describe('handing over from the recorded greeting to the conversation', () => {
  it('is still greeting while the recording plays', () => {
    expect(isGreetingOver({ secondsSinceAsked: 0.5, positionSeconds: 0.4, durationSeconds: 2 })).toBe(false);
  });

  it('is over the moment the player reaches the end of the recording', () => {
    expect(isGreetingOver({ secondsSinceAsked: 2.1, positionSeconds: 2, durationSeconds: 2 })).toBe(true);
    // A player stops a hair short of the last sample, and that is the end too.
    expect(isGreetingOver({ secondsSinceAsked: 2.1, positionSeconds: 1.97, durationSeconds: 2 })).toBe(true);
  });

  it('takes the recording at its word about how long it is, once it knows', () => {
    const longerThanExpected = GREETING_SECONDS + 1;
    expect(
      isGreetingOver({
        secondsSinceAsked: GREETING_SECONDS + 0.1,
        positionSeconds: GREETING_SECONDS + 0.1,
        durationSeconds: longerThanExpected,
      }),
    ).toBe(false);
  });

  it('does not read a player still parked at the end of the last greeting as this one finishing', () => {
    // Summoned a second time: until the rewind lands, the position is the old greeting's end.
    expect(isGreetingOver({ secondsSinceAsked: 0.01, positionSeconds: undefined, durationSeconds: 2 })).toBe(false);
  });

  it('gives up on a greeting that never plays, so the microphone is not muted for ever', () => {
    // A browser that refused to play without a tap, or a player that never loaded.
    const never = { positionSeconds: 0, durationSeconds: 0 };
    expect(isGreetingOver({ ...never, secondsSinceAsked: GREETING_SECONDS })).toBe(false);
    expect(isGreetingOver({ ...never, secondsSinceAsked: GREETING_SECONDS + GREETING_GRACE_SECONDS })).toBe(true);
  });

  it('gives up on a greeting that stalls part of the way through', () => {
    expect(
      isGreetingOver({ secondsSinceAsked: 2 + GREETING_GRACE_SECONDS, positionSeconds: 1, durationSeconds: 2 }),
    ).toBe(true);
  });
});

describe('what the conversation behind the greeting asks ElevenLabs for', () => {
  it('asks for an empty first message, so the agent does not greet a second time', () => {
    expect(WITHOUT_FIRST_MESSAGE).toEqual({ agent: { firstMessage: '' } });
  });

  it('asks for what the voice firmware asks for', () => {
    // The firmware has greeted this way for a long time, against the same agent: that is the
    // evidence the override is accepted. If it ever stops sending an empty first message, the
    // two have drifted and one of them is wrong.
    const firmware = readFileSync(
      join(REPOSITORY, 'home-assistant-voice-firmware', 'components', 'elevenlabs_stream', 'elevenlabs_stream.cpp'),
      'utf8',
    );
    expect(firmware).toContain('agent["first_message"] = this->initial_message_.empty() ? "" :');
  });

  it('is an override the agent allows, since an unaccepted one ends the conversation', () => {
    const agent: unknown = JSON.parse(
      readFileSync(join(REPOSITORY, 'elevenlabs', 'src', 'assets', 'agent-config.json'), 'utf8'),
    );
    const allowed = readPath(agent, [
      'platformSettings',
      'overrides',
      'conversationConfigOverride',
      'agent',
      'firstMessage',
    ]);
    expect(allowed).toBe(true);
  });
});
