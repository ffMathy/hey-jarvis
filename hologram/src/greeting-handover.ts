import { GREETING_SECONDS } from './greeting-voice';

/**
 * What a conversation opened behind the greeting asks ElevenLabs for: no first message.
 *
 * **The greeting is the first message.** Jarvis says "Hello sir, how can I help?" from a recording
 * the moment he is summoned, while the session is still being dialled behind it, so the agent must
 * not say it again once the session is up. An empty `firstMessage` is how ElevenLabs is told that,
 * and it is exactly what the voice firmware sends (`agent["first_message"] = ""` in
 * `home-assistant-voice-firmware/components/elevenlabs_stream/elevenlabs_stream.cpp`); the agent
 * allows the override (`overrides.conversationConfigOverride.agent.firstMessage` in
 * `elevenlabs/src/assets/agent-config.json`), so asking for it cannot take the session down.
 *
 * The shape is the SDK's `overrides` option, which `@elevenlabs/client` turns into
 * `conversation_config_override.agent.first_message` on the wire.
 */
export const WITHOUT_FIRST_MESSAGE = { agent: { firstMessage: '' } } as const;

/**
 * How long past the end of the recording the greeting is waited for before it is given up on.
 *
 * Playback can start late — a player still loading, a browser that refused to play without a tap —
 * and a greeting that never finishes would keep the microphone muted for ever. So the greeting is
 * over at the latest this long after it *should* have ended, whatever the player says.
 */
export const GREETING_GRACE_SECONDS = 1.5;

/** How close to the end of the recording counts as having reached it. Players stop a frame short. */
const END_TOLERANCE_SECONDS = 0.05;

/** Where a greeting has got to, as far as deciding whether it is over needs to know. */
export interface GreetingProgress {
  /** Seconds since the greeting was asked to play — a wall clock, not the player's. */
  secondsSinceAsked: number;
  /**
   * Where the player is in the recording, or `undefined` until it has been rewound to the start.
   *
   * Undefined rather than zero because a player that has greeted once is still parked at the end
   * of the recording until the rewind lands, and reading that as the position would end the next
   * greeting before it began.
   */
  positionSeconds: number | undefined;
  /** How long the player says the recording is, or 0 while it does not know yet. */
  durationSeconds: number;
}

/**
 * Whether the greeting is over, and the conversation can have Jarvis and the microphone back.
 *
 * Over when the player reaches the end of the recording, or — if it never gets there, because it
 * never started or stalled — once the recording's length and {@link GREETING_GRACE_SECONDS} have
 * passed on the wall clock. The recording's own length is preferred to {@link GREETING_SECONDS}
 * once the player knows it, so the microphone opens when the sound actually stops.
 */
export function isGreetingOver({ secondsSinceAsked, positionSeconds, durationSeconds }: GreetingProgress): boolean {
  const length = durationSeconds > 0 ? durationSeconds : GREETING_SECONDS;
  if (positionSeconds !== undefined && positionSeconds >= length - END_TOLERANCE_SECONDS) {
    return true;
  }
  return secondsSinceAsked >= length + GREETING_GRACE_SECONDS;
}
