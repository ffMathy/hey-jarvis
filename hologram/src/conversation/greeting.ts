import { useConversationInput } from '@elevenlabs/react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isGreetingOver, WITHOUT_FIRST_MESSAGE } from '../greeting-handover';
import { createGreetingReaders } from '../greeting-voice';
import type { JarvisVoice } from '../voice-contract';
import { GREETING_SOUND } from './greeting-sound';

/** How often a greeting in progress is checked for having finished. */
const CHECK_EVERY_MS = 50;

/** The one time this process sets the audio mode, shared by every greeting after it. */
let audioModeSet: Promise<void> | undefined;

/**
 * Lets the greeting play *alongside* the call that is being dialled behind it.
 *
 * **Without this the call would silence him mid-sentence.** expo-audio on Android asks for audio
 * focus before it plays unless it is told to mix, and LiveKit asks for focus of its own when the
 * session connects — so the player would be handed a focus loss and pause, which is exactly when
 * the connection lands: a second into "Hello sir". `mixWithOthers` asks for no focus at all, so
 * there is nothing to lose.
 *
 * **Once per process, and before the first session.** On Android this call also writes
 * `AudioManager.mode` — to `MODE_NORMAL`, since the greeting is not routed through the earpiece —
 * and LiveKit puts it in `MODE_IN_COMMUNICATION` for the call. Run again while a call is up, it
 * would take the call out of the mode its echo cancellation depends on. Nothing else in either
 * app plays through expo-audio, so there is nothing for a second call to change anyway.
 */
function mixWithTheCall(): Promise<void> {
  audioModeSet ??= setAudioModeAsync({ interruptionMode: 'mixWithOthers', playsInSilentMode: true }).catch(() => {
    // Left as it was: he still greets, and the next summoning tries again.
    audioModeSet = undefined;
  });
  return audioModeSet;
}

/**
 * Whether this is somewhere a sound may start without a tap first.
 *
 * Only ever "no" in a browser that has not been touched since the page loaded — a reload straight
 * onto the conversation — which refuses to play and, in expo-audio's web player, does so as an
 * unhandled rejection. A greeting that cannot be heard must not also take the agent's own first
 * message away, so there it is not attempted at all. A phone and a watch have no such rule, and no
 * `navigator.userActivation` to say otherwise.
 */
function maySoundUnprompted(): boolean {
  return typeof navigator === 'undefined' || navigator.userActivation?.hasBeenActive !== false;
}

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
 *    whether a greeting is playing.
 * 2. If it is, `greetingSessionOptions` go to `startSession`: the override that switches the agent's
 *    first message off, and the moment the session exists, which mutes its microphone — the agent
 *    must not hear Jarvis greet through the speaker and take it for the user speaking.
 * 3. While `greeting` is true, the sphere follows `greetingVoice`, which reads the player's own
 *    position so it stays on the words however late playback started.
 *
 * When the recording ends — or is given up on, see `isGreetingOver` — the microphone is unmuted and
 * `greeting` goes false, and the screen hands the sphere back to the agent's voice. A session that
 * is not up by then simply goes on connecting, exactly as it would have without a greeting.
 *
 * `stopGreeting()` is for hanging up mid-greeting: he stops talking when you dismiss him.
 */
export function useGreeting() {
  const player = useAudioPlayer(GREETING_SOUND);
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

  const finishGreeting = useCallback(() => {
    inProgress.current = false;
    setGreeting(false);
    if (!mutedForGreeting.current) {
      return;
    }
    mutedForGreeting.current = false;
    try {
      setMuted(false);
    } catch {
      // The session ended while he was greeting, and took the microphone with it.
    }
  }, [setMuted]);

  const beginGreeting = useCallback(async () => {
    if (!maySoundUnprompted()) {
      return false;
    }
    await mixWithTheCall();
    askedAt.current = Date.now();
    rewound.current = false;
    inProgress.current = true;
    setGreeting(true);
    // Summoned before, the player is parked at the end of the last greeting.
    player
      .seekTo(0)
      .catch(() => undefined)
      .then(() => {
        if (!inProgress.current) {
          return;
        }
        rewound.current = true;
        player.play();
      });
    return true;
  }, [player]);

  const stopGreeting = useCallback(() => {
    if (!inProgress.current) {
      return;
    }
    player.pause();
    finishGreeting();
  }, [player, finishGreeting]);

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
        finishGreeting();
      }
    }, CHECK_EVERY_MS);
    return () => clearInterval(checking);
  }, [greeting, player, finishGreeting]);

  const greetingSessionOptions = useMemo(
    () => ({
      overrides: WITHOUT_FIRST_MESSAGE,
      /**
       * The earliest the microphone can be reached: the SDK calls this as the session is created,
       * before it reports `connected`. The SDK's own `setMuted` rather than the conversation's, so
       * `useConversationInput().isMuted` — which `useUserVoice` reads — says so too.
       */
      onConversationCreated: () => {
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

  return { greeting, greetingVoice, beginGreeting, stopGreeting, greetingSessionOptions };
}
