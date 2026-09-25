import { useConversationInput } from '@elevenlabs/react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { isGreetingOver, WITHOUT_FIRST_MESSAGE } from '../greeting-handover';
import { createGreetingReaders } from '../greeting-voice';
import type { JarvisVoice } from '../voice-contract';
import { startCallAudio, stopCallAudio } from './call-audio';
import { useGreetingPlayer } from './greeting-player';

/** How often a greeting in progress is checked for having finished. */
const CHECK_EVERY_MS = 50;

/**
 * Jarvis greeting you from a recording while the conversation is still being dialled.
 *
 * **Why a recording.** A session takes a second or two to come up — a token, a room, a handshake —
 * and the agent's first message only starts after that, so being summoned used to mean a sphere
 * that said nothing for as long as it took. The voice firmware solved this long ago: it plays
 * "Hello sir, how can I help?" from flash the instant it wakes and connects to ElevenLabs behind it,
 * with the agent's own first message switched off. This is the same trick, on the phone and the
 * watch — he answers at once, and by the time he has finished saying so, he is usually listening.
 *
 * What a screen does with it:
 *
 * 1. `beginGreeting()` as it starts the conversation, before the token request. It resolves to
 *    whether a greeting is playing. On a phone and a watch it puts the device into the call's audio
 *    first and plays the recording *as* call audio, which is what makes him heard at all; see
 *    `call-audio.ts` and `greeting-player.ts`. In a browser, call it while the page still holds a
 *    microphone stream — that is what lets an untouched tab play it — and it resolves only once the
 *    browser has said yes or no. If the recording cannot play, it resolves false, and the agent
 *    keeps its own first message.
 * 2. `untilCallMayTakeTheAudio()` once the token is in hand, and `startSession` only if it resolves
 *    true. See the note on it for why a phone and a watch wait there and a browser does not.
 * 3. If a greeting is playing, `greetingSessionOptions` go to `startSession`: the override that
 *    switches the agent's first message off, and the moment the session exists, which mutes its
 *    microphone — the agent must not hear Jarvis greet through the speaker and take it for the user
 *    speaking.
 * 4. While `greeting` is true, the sphere follows `greetingVoice`, which reads the player's own
 *    position so it stays on the words however late playback started.
 *
 * When the recording ends — or is given up on, see `isGreetingOver` — the microphone is unmuted and
 * `greeting` goes false, and the screen hands the sphere back to the agent's voice. A session that
 * is not up by then simply goes on connecting, exactly as it would have without a greeting.
 *
 * `stopGreeting()` is for hanging up mid-greeting: he stops talking when you dismiss him.
 * `releaseCallAudio()` is for a conversation that failed before it started — a token that never
 * came — so the device is not left in call audio with no call.
 */
export function useGreeting() {
  const player = useGreetingPlayer();
  const { setMuted } = useConversationInput();
  const [greeting, setGreeting] = useState(false);
  /** The same fact as `greeting`, for the session callback, which must see it without a render. */
  const inProgress = useRef(false);
  /** When the greeting was asked for, on the wall clock. */
  const askedAt = useRef(0);
  /** Whether the player has been rewound for this greeting yet; see `GreetingProgress`. */
  const rewound = useRef(false);
  /** Whether it is the greeting that muted the microphone, so only the greeting unmutes it. */
  const mutedForGreeting = useRef(false);
  /** Whoever is waiting in `untilCallMayTakeTheAudio`, told whether he finished or was stopped. */
  const waitingForTheEnd = useRef<((finished: boolean) => void)[]>([]);
  /**
   * Whether the call's audio was started for the greeting and no session has taken it over yet —
   * the only time it is the greeting's to stop. Once a session exists, the SDK stops it as the
   * conversation ends.
   */
  const holdingCallAudio = useRef(false);

  const releaseCallAudio = useCallback(() => {
    if (!holdingCallAudio.current) {
      return;
    }
    holdingCallAudio.current = false;
    stopCallAudio().catch(() => {
      // Nothing to put back: it never started.
    });
  }, []);

  const finishGreeting = useCallback(
    (finished: boolean) => {
      inProgress.current = false;
      setGreeting(false);
      for (const answer of waitingForTheEnd.current.splice(0)) {
        answer(finished);
      }
      if (!finished) {
        // Stopped rather than heard out: hung up on, so no session is coming to take the audio.
        releaseCallAudio();
      }
      if (!mutedForGreeting.current) {
        return;
      }
      mutedForGreeting.current = false;
      try {
        setMuted(false);
      } catch {
        // The session ended while he was greeting, and took the microphone with it.
      }
    },
    [setMuted, releaseCallAudio],
  );

  const stopGreeting = useCallback(() => {
    if (!inProgress.current) {
      return;
    }
    player.pause();
    finishGreeting(false);
  }, [player, finishGreeting]);

  const beginGreeting = useCallback(async () => {
    try {
      await startCallAudio();
      holdingCallAudio.current = true;
    } catch {
      // He still greets; whether he can be heard without it is the device's business.
    }
    askedAt.current = Date.now();
    rewound.current = false;
    inProgress.current = true;
    setGreeting(true);
    const playing = await player.playFromStart();
    if (!inProgress.current) {
      // Hung up on while it was starting.
      player.pause();
      return false;
    }
    if (playing) {
      rewound.current = true;
      return true;
    }
    stopGreeting();
    return false;
  }, [player, stopGreeting]);

  useEffect(() => {
    if (!greeting) {
      return;
    }
    const checking = setInterval(() => {
      const over = isGreetingOver({
        secondsSinceAsked: (Date.now() - askedAt.current) / 1000,
        positionSeconds: rewound.current ? player.currentTime : undefined,
        durationSeconds: player.duration,
      });
      if (over) {
        finishGreeting(true);
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(checking);
  }, [greeting, player, finishGreeting]);

  /**
   * Resolves once the call may have the device's audio: `true` to go on and start the session, or
   * `false` if the greeting was stopped meanwhile — the conversation was hung up, and dialling it
   * now would open a call nobody is waiting for.
   *
   * **On a phone and a watch that is not until he has finished greeting.** Dialled behind him, the
   * session's arrival was heard as the greeting switching mid-word into a thin voice and cutting
   * off. The call's audio is now started before he speaks (`call-audio.ts`), which takes away the
   * mode switch that most likely did that — but WebRTC's own audio device coming up under a
   * recording has not been heard on a device, so the session still waits for him. That costs the
   * handshake after the greeting rather than during it.
   *
   * **A browser does not wait.** It has no audio mode to switch, so the session goes on being
   * dialled behind the greeting there, with its microphone muted until he has finished.
   */
  const untilCallMayTakeTheAudio = useCallback((): Promise<boolean> => {
    if (Platform.OS === 'web' || !inProgress.current) {
      return Promise.resolve(true);
    }
    return new Promise((answer) => {
      waitingForTheEnd.current.push(answer);
    });
  }, []);

  const greetingSessionOptions = useMemo(
    () => ({
      overrides: WITHOUT_FIRST_MESSAGE,
      /**
       * The earliest the microphone can be reached: the SDK calls this as the session is created,
       * before it reports `connected`. The SDK's own `setMuted` rather than the conversation's, so
       * `useConversationInput().isMuted` — which `useUserVoice` reads — says so too.
       */
      onConversationCreated: () => {
        // The session has the call's audio now, and stops it when the conversation ends.
        holdingCallAudio.current = false;
        if (!inProgress.current) {
          return;
        }
        mutedForGreeting.current = true;
        setMuted(true);
      },
    }),
    [setMuted],
  );

  const greetingVoice = useMemo<JarvisVoice>(
    () => ({
      listening: true,
      speaking: true,
      // Silence until the recording is actually playing, and after it stops: the sphere follows
      // what can be heard, not what was asked for.
      ...createGreetingReaders(() => (inProgress.current && player.playing ? player.currentTime : -1)),
    }),
    [player],
  );

  return {
    greeting,
    greetingVoice,
    beginGreeting,
    stopGreeting,
    untilCallMayTakeTheAudio,
    releaseCallAudio,
    greetingSessionOptions,
  };
}
