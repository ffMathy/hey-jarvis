import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createAssistLaunchClaim } from './assist-link';
import { requestConversationToken } from './conversation-token';
import type { ElevenLabsSettings } from './elevenlabs-settings';
import { useWholeScreenHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import { usePreferredHeadset } from './preferred-microphone';
import { useSparkDensity } from './spark-density';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
import { theme } from './theme';

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
  const { startSession } = useConversationControls();
  const { status } = useConversationStatus();
  const voice = useJarvisVoice();
  const hologramSize = useWholeScreenHologramSize();
  const { frameRate, buildMilliseconds, particleShare, provenShare, startingShare } = useSparkDensity();
  // Onto the AirPods, if there are any. Only once the call is up, because the list of routes is
  // empty until LiveKit has started the audio session. See `preferred-microphone.ts`.
  usePreferredHeadset(status === 'connected');

  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);

  const launchUrl = Linking.useURL();

  const start = useCallback(async () => {
    setProblem(undefined);
    setIsStarting(true);

    try {
      if (!(await requestMicrophoneAccess())) {
        setProblem('Jarvis needs the microphone in order to listen.');
        return;
      }

      // Minted here rather than at launch, and never kept: a conversation token
      // is short-lived, and one fetched when the app opened may already be dead
      // by the time it is used.
      const { token } = await requestConversationToken(settings);

      startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        onError: (message) => setProblem(message),
      });
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      setIsStarting(false);
    }
  }, [settings, startSession]);

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
