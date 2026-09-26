/**
 * Hanging up once a finished request is followed by quiet: when, and what calls it off.
 *
 * **The agent asks; the device decides.** At the end of every request it has finished, the Jarvis
 * agent calls the client tool {@link HANG_UP_WHEN_QUIET_TOOL} — configured with no parameters,
 * `expectsResponse: false`, and `executionMode: 'post_tool_speech'`, so the call arrives once he has
 * finished saying the answer. The agent cannot hear the silence that follows; the device can. So
 * the call only *arms* the hang-up, and the device ends the conversation itself if nobody says
 * anything for {@link QUIET_BEFORE_HANGING_UP_MS}. It is the voice firmware's announcement rule —
 * wait for the room to stay quiet, then hang up — brought to the phone and the watch.
 *
 * Three rules, and each has a reason:
 *
 * - **The clock only runs while Jarvis is quiet.** He may start speaking again — a follow-up
 *   thought, a second tool's answer — and a clock that ran through him would end the call in the
 *   middle of his own sentence. Starting to speak puts it back to nothing; stopping starts it again.
 *   He stays armed throughout: the request he finished has not been answered by anyone.
 * - **The user speaking calls it off for good**, until the next finished request arms it again.
 *   Someone who has started a follow-up has answered the question the silence was asking. Heard
 *   through `vad_score` at {@link USER_SPEECH_THRESHOLD}, or through anything they said or typed.
 * - **What is heard while he speaks is ignored**, because it is him. His voice comes out of the
 *   speaker centimetres from the microphone and ElevenLabs scores it as the user — the rule
 *   `vad-score.ts` keeps for the listening lattice, and the firmware for the same reason.
 *
 * Kept free of timers and of React, with the time handed in, so every one of those rules is a test
 * with no clock in it. The hook that drives it, sets the timer and ends the session is
 * `useHangUpWhenQuiet` in `hologram/conversation`.
 */

/**
 * The client tool the agent calls at the end of every finished request.
 *
 * The one spelling on this side of the contract; the agent's own configuration names the same tool.
 */
export const HANG_UP_WHEN_QUIET_TOOL = 'hangUpWhenQuiet';

/**
 * How long nobody may say anything, after Jarvis has finished, before the call ends.
 *
 * Three seconds is long enough for someone to start a follow-up — the first syllable is all it
 * takes to call it off — and short enough that a request that was the whole conversation ends
 * like one, rather than leaving a microphone open to a room that has gone back to what it was doing.
 */
export const QUIET_BEFORE_HANGING_UP_MS = 3_000;

/**
 * How sure ElevenLabs has to be that the user is speaking for that to call the hang-up off.
 *
 * The firmware's `ANNOUNCEMENT_SPEECH_THRESHOLD`, for the firmware's reason: "more likely than
 * not". Deliberately stricter than the listening lattice's 0.25 (`HEARING_THRESHOLD`), which is
 * meant to be twitchy — here that twitchiness would let a fridge or a passing car hold the call
 * open for ever, and a miss only ends a conversation nobody was having.
 */
export const USER_SPEECH_THRESHOLD = 0.5;

/** Where the hang-up stands. */
export interface QuietWatch {
  /** Whether a finished request has asked for the call to end once it goes quiet. */
  armed: boolean;
  /** Whether Jarvis is speaking, as far as this has been told. Kept whether armed or not. */
  jarvisSpeaking: boolean;
  /** When the current quiet began, in milliseconds; `undefined` unless armed and he is quiet. */
  quietSince: number | undefined;
}

/** Not armed, and nobody speaking: where every conversation starts. */
export const NOT_WATCHING: QuietWatch = { armed: false, jarvisSpeaking: false, quietSince: undefined };

/** Something that happened that the hang-up has to hear about. `at` is milliseconds, any clock. */
export type QuietEvent =
  /** The agent called {@link HANG_UP_WHEN_QUIET_TOOL}: a request is finished. */
  | { type: 'hangUpRequested'; at: number }
  /** Jarvis started or stopped speaking. */
  | { type: 'jarvisSpeaking'; speaking: boolean; at: number }
  /** A voice-activity score from ElevenLabs, 0–1. */
  | { type: 'vadScore'; score: number }
  /** The user said or typed something that reached the conversation. */
  | { type: 'userSpoke' }
  /** The session ended, failed, or is being replaced — or the hang-up has just happened. */
  | { type: 'sessionOver' };

/**
 * The hang-up after one more thing has happened.
 *
 * Returns the very object it was given when nothing changed, which is most of the time — scores
 * arrive many times a second — so a caller holding it in React state is not re-rendered for them.
 */
export function afterQuietEvent(watch: QuietWatch, event: QuietEvent): QuietWatch {
  switch (event.type) {
    case 'hangUpRequested':
      // A second request finishing while armed starts the quiet over: it has just been asked again.
      return { ...watch, armed: true, quietSince: watch.jarvisSpeaking ? undefined : event.at };

    case 'jarvisSpeaking':
      return afterJarvisSpeaking(watch, event.speaking, event.at);

    case 'vadScore':
      // His own voice, heard back through the speaker, is not the user answering.
      return watch.jarvisSpeaking || !(event.score >= USER_SPEECH_THRESHOLD) ? watch : disarmed(watch);

    case 'userSpoke':
    case 'sessionOver':
      return disarmed(watch);
  }
}

/** Jarvis started or stopped: the clock stops with him, and starts again from nothing after. */
function afterJarvisSpeaking(watch: QuietWatch, speaking: boolean, at: number): QuietWatch {
  if (speaking === watch.jarvisSpeaking) {
    return watch;
  }
  if (!watch.armed) {
    return { ...watch, jarvisSpeaking: speaking };
  }
  return { ...watch, jarvisSpeaking: speaking, quietSince: speaking ? undefined : at };
}

/** No longer armed — or the same object, when it already was not. */
function disarmed(watch: QuietWatch): QuietWatch {
  return watch.armed ? { ...watch, armed: false, quietSince: undefined } : watch;
}

/** When the call should end, in the clock the events were given in — or `undefined` if not yet. */
export function hangUpDueAt(watch: QuietWatch): number | undefined {
  return watch.armed && watch.quietSince !== undefined ? watch.quietSince + QUIET_BEFORE_HANGING_UP_MS : undefined;
}

/** Whether it has been quiet for long enough, at `now`. */
export function isTimeToHangUp(watch: QuietWatch, now: number): boolean {
  const dueAt = hangUpDueAt(watch);
  return dueAt !== undefined && now >= dueAt;
}
