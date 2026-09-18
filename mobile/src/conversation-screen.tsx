import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import { type ElevenLabsSettings, PHONE_PARTICIPANT_NAME, requestConversationToken } from 'conversation';
import { useToolActivity } from 'conversation/react';
import * as Linking from 'expo-linking';
import { PARTICLE_COUNT } from 'hologram';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createAssistLaunchClaim } from './assist-link';
import { FrameRate } from './frame-rate';
import { useWholeScreenHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import { usePreferredHeadset } from './preferred-microphone';
import { useSparkDensity } from './spark-density';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
import { theme } from './theme';
import { TypedMessageField } from './typed-message-field';

interface ConversationScreenProps {
  settings: ElevenLabsSettings;
  onEditSettings: () => void;
}

/** Summonings already acted on in this process. */
const claimAssistLaunch = createAssistLaunchClaim();

/** Where the screen has to be bare, and where it does not. See the note on the component. */
const ON_A_PHONE = Platform.OS !== 'web';

/** Whether a conversation is open, or on its way to being open. */
function isLive(status: string): boolean {
  return status === 'connected' || status === 'connecting';
}

/**
 * The screen Jarvis answers from: him, and nothing else.
 *
 * **There is no button and no text on it.** There used to be a title, a status line, a Talk button
 * and three cards, and every one of them was there to explain something — which is the wrong shape
 * for an assistant. You do not press a button to talk to someone who is already listening, and you
 * do not read a paragraph about the microphone while they wait. So the conversation opens by
 * itself the moment the screen does, and what tells you which of the two of you is talking is what
 * the sphere is doing, which is the whole reason it was drawn.
 *
 * What is left when everything goes right is nothing to read. What is left when it does not is one
 * line saying so, because an assistant that has silently failed to connect looks exactly like one
 * that is listening, and there would otherwise be no way to tell.
 *
 * The one thing that does put something on the screen is a browser with no microphone, which gets a
 * field to type into instead — see `typed-message-field.tsx` and the note in `start`. It is the
 * exception that keeps the rule: there is still nothing to read, only somewhere to write.
 *
 * Settings are still reachable, and how depends on where this is running. On a phone it is a long
 * press anywhere, because this screen is the assistant and an assistant with a link on it is not
 * one. In a browser it is a plain link, because a browser is not an assistant — it is where this is
 * developed and demonstrated, it already differs in bigger ways (sample mode has no sheet there),
 * and react-native-web does not raise `onLongPress` for a held mouse at all, so the gesture would
 * be a door that only looks like one.
 *
 * The particle count is the phone's own, as sample mode's has been for a while and this screen's
 * never was: see `spark-density.ts`. It drew a fixed number on every phone, which on a fast one was
 * fewer than it could manage and on a slow one more.
 */
export function ConversationScreen({ settings, onEditSettings }: ConversationScreenProps) {
  const { startSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const voice = useJarvisVoice();
  const hologramSize = useWholeScreenHologramSize();
  const { frameRate, buildMilliseconds, particleShare, provenShare, startingShare } = useSparkDensity();
  // Onto the AirPods, if there are any. Only once the call is up, because the list of routes is
  // empty until LiveKit has started the audio session. See `preferred-microphone.ts`.
  usePreferredHeadset(status === 'connected');
  // What he is doing between hearing you and answering. See `tool-activity.ts`.
  const { thinking, toolHandlers, forgetToolCalls } = useToolActivity();

  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);
  // Set when the conversation opened without a microphone, which is the only thing that puts a
  // text field on this screen. See `start` below.
  const [typingInstead, setTypingInstead] = useState(false);

  const launchUrl = Linking.useURL();

  const start = useCallback(async () => {
    setProblem(undefined);
    setIsStarting(true);

    try {
      const canHear = await requestMicrophoneAccess();

      // On a phone a refusal is the end of it: the assistant gesture exists to be talked to, there
      // is no keyboard in front of you when you make it, and a text field would be answering a
      // question nobody asked. In a browser it is the opposite — this is where Jarvis is developed
      // and demonstrated, the keyboard is right there, and refusing the microphone is a thing you
      // do on purpose when you are in a call, in an open office, or want the same input twice.
      if (!canHear && ON_A_PHONE) {
        setProblem('Jarvis needs the microphone in order to listen.');
        return;
      }

      // Minted here rather than at launch, and never kept: a conversation token
      // is short-lived, and one fetched when the app opened may already be dead
      // by the time it is used.
      const { token } = await requestConversationToken({ settings, participantName: PHONE_PARTICIPANT_NAME });

      startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        // **This is what makes a conversation possible with no microphone at all.** ElevenLabs runs
        // the session as text on both sides: nothing is captured, and the reply comes back written
        // rather than spoken. That second half is the cost — with no speech to track, the sphere
        // idles rather than answering — so it is only ever asked for when there is no alternative.
        // He still visibly thinks, because a tool call is reported over the same channel and
        // `useToolActivity` does not care how the conversation is being held.
        textOnly: !canHear,
        onError: (message) => setProblem(message),
        ...toolHandlers,
      });
      setTypingInstead(!canHear);
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      setIsStarting(false);
    }
  }, [settings, startSession, toolHandlers]);

  /**
   * Opens the conversation as soon as there is a screen to open it on.
   *
   * Once, and only once, however this screen was reached — from the launcher, from the assistant
   * gesture, or by coming back from settings. `tried` is a ref rather than state because it must
   * not cause a render and must not reset when one happens: two starts in flight at the same time
   * is two WebRTC sessions, and the second tears down the first.
   *
   * Nothing retries. A conversation that failed to open failed for a reason — no microphone, no
   * network, a rejected key — and hammering ElevenLabs until one of those changes would be rude to
   * them and useless to the user, who can press and hold to fix the only one of those that is
   * fixable here.
   */
  // A call still running when the conversation drops never gets its answer, so the sphere would be
  // left mid-thought — and the next conversation would open with him already thinking about
  // something that stopped happening.
  useEffect(() => {
    if (!isLive(status)) {
      forgetToolCalls();
    }
  }, [status, forgetToolCalls]);

  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || isLive(status) || isStarting) {
      return;
    }
    tried.current = true;
    void start();
  }, [start, status, isStarting]);

  // A summoning that arrives while this screen is already open: claimed so it is acted on once,
  // and then left alone if a conversation is already under way, since starting again would tear
  // down the one that is.
  useEffect(() => {
    if (!claimAssistLaunch(launchUrl)) {
      return;
    }
    if (!isLive(status) && !isStarting) {
      void start();
    }
  }, [launchUrl, start, status, isStarting]);

  return (
    // The whole screen is the way into settings, not just the sphere. A long press has to land
    // somewhere, and on a screen with one round thing on it and nothing else, "somewhere" should
    // not mean "on the round thing" — most of what you would press is the dark around him. It is
    // also the only part a test can press: the drawing puts a `<canvas>` over the middle, and that
    // takes the pointer events for itself.
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel="Jarvis. Press and hold for ElevenLabs settings."
      style={styles.screen}
      onLongPress={ON_A_PHONE ? onEditSettings : undefined}
      testID="conversation"
    >
      <View style={{ width: hologramSize, height: hologramSize }} testID="hologram">
        <JarvisHologram
          size={hologramSize}
          voice={voice}
          quietestSpeech={QUIETEST_SPEECH_HERE}
          thinking={thinking}
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          provenShare={provenShare}
          startingShare={startingShare}
        />
      </View>

      {problem ? (
        <Text style={styles.problem} testID="conversation-problem">
          {problem}
        </Text>
      ) : null}

      {/*
        The way in when there is no microphone. Only ever rendered in a browser, because `start`
        only ever opens a text conversation there — a phone says so and stops instead.
      */}
      {typingInstead ? <TypedMessageField onSend={sendUserMessage} enabled={status === 'connected'} /> : null}

      {/*
        The instrument, left running in a browser and nowhere else.

        On a phone this screen is the assistant and has nothing on it at all; in a browser it is
        where the drawing is developed, and knowing what it is managing is worth a line of text so
        dark you have to look for it. `faint` is what makes it that.
      */}
      {ON_A_PHONE ? null : (
        <FrameRate
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          particles={PARTICLE_COUNT}
          faint
        />
      )}

      {ON_A_PHONE ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={onEditSettings}
          style={styles.settingsLink}
          testID="open-settings"
        >
          <Text style={styles.settingsLinkLabel}>ElevenLabs settings</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * Him in the middle, and nothing else in the layout to push him off it.
   *
   * The square is wider than the screen — see `useWholeScreenHologramSize` — so `overflow: hidden`
   * is what keeps what hangs off the sides from being something the screen can scroll to.
   */
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** The browser's way back to setup, which a phone does with a long press instead. */
  settingsLink: {
    position: 'absolute',
    bottom: theme.spacing.large,
    padding: theme.spacing.small,
  },
  settingsLinkLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
  /** Only ever on screen when something is wrong, and then it is the only thing on screen. */
  problem: {
    position: 'absolute',
    left: theme.spacing.large,
    right: theme.spacing.large,
    bottom: theme.spacing.large * 2,
    color: theme.colors.danger,
    textAlign: 'center',
  },
});
