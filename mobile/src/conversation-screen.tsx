import { useConversationControls, useConversationMode, useConversationStatus } from '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StatusBar as NativeStatusBar,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type AssistantRegistration, openAssistantSettings } from '../modules/jarvis-assistant';
import { createAssistLaunchClaim } from './assist-link';
import { requestConversationToken } from './conversation-token';
import type { ElevenLabsSettings } from './elevenlabs-settings';
import { useHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import { theme } from './theme';
import { useAssistantRegistration } from './use-assistant-registration';

interface ConversationScreenProps {
  settings: ElevenLabsSettings;
  onEditSettings: () => void;
}

/** Summonings already acted on in this process. */
const claimAssistLaunch = createAssistLaunchClaim();

/** Whether a conversation is open, or on its way to being open. */
function isLive(status: string): boolean {
  return status === 'connected' || status === 'connecting';
}

/**
 * The screen Jarvis answers from.
 *
 * One button, because a summoned assistant should need no reading. Everything
 * else on it is there to explain the two states the user cannot fix by pressing
 * that button: not being the phone's assistant, and not being able to reach
 * ElevenLabs.
 */
export function ConversationScreen({ settings, onEditSettings }: ConversationScreenProps) {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const { mode } = useConversationMode();
  const registration = useAssistantRegistration();
  const voice = useJarvisVoice();
  const hologramSize = useHologramSize();

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
      // by the time the user presses the button.
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

  // Opened by the assistant gesture rather than from the launcher: the user has
  // already said what amounts to "hey Jarvis", so making them press a button
  // afterwards would be asking twice. Each summoning is claimed once, for the
  // life of the process — see `createAssistLaunchClaim` for why neither a
  // per-render nor a per-mount guard is enough. A summoning that arrives while a
  // conversation is open or starting is claimed and left alone, since starting
  // again would tear down the one already under way.
  useEffect(() => {
    if (!claimAssistLaunch(launchUrl)) {
      return;
    }

    if (!isLive(status) && !isStarting) {
      void start();
    }
  }, [launchUrl, start, status, isStarting]);

  const live = isLive(status);
  const busy = isStarting || status === 'connecting';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>J.A.R.V.I.S.</Text>
      <Text style={styles.status} testID="conversation-status">
        {describeState(status, mode)}
      </Text>

      <View
        accessible
        accessibilityLabel="Jarvis hologram"
        style={{ width: hologramSize, height: hologramSize }}
        testID="hologram"
      >
        <JarvisHologram size={hologramSize} voice={voice} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={live ? 'End the conversation' : 'Talk to Jarvis'}
        style={[styles.talkButton, live && styles.talkButtonLive]}
        testID="talk"
        disabled={busy}
        onPress={() => (live ? endSession() : void start())}
      >
        {busy ? (
          <ActivityIndicator color={theme.colors.accentText} />
        ) : (
          <Text style={styles.talkButtonLabel}>{live ? 'End' : 'Talk'}</Text>
        )}
      </Pressable>

      {problem ? (
        <Text style={styles.problem} testID="conversation-problem">
          {problem}
        </Text>
      ) : null}

      <AssistantCard registration={registration} />

      <Pressable
        accessibilityRole="button"
        onPress={onEditSettings}
        style={styles.secondaryButton}
        testID="open-settings"
      >
        <Text style={styles.secondaryButtonLabel}>ElevenLabs settings</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Turns the two independent pieces of session state into one line of English. */
function describeState(status: string, mode: string): string {
  if (status === 'connecting') {
    return 'Connecting…';
  }

  if (status === 'error') {
    return 'Something went wrong.';
  }

  if (status !== 'connected') {
    return 'Standing by.';
  }

  return mode === 'speaking' ? 'Speaking…' : 'Listening…';
}

/**
 * Says whether the phone will actually summon Jarvis, and offers the only fix
 * there is.
 */
function AssistantCard({ registration }: { registration: AssistantRegistration }) {
  const [problem, setProblem] = useState<string | undefined>(undefined);

  // On web every signal below reads false, and it would read false forever: the
  // assistant role is Android's, and no amount of tapping changes that. Saying so
  // is better than showing a setup step that leads nowhere.
  if (Platform.OS === 'web') {
    return (
      <View style={styles.card}>
        <Text style={styles.cardHeading} testID="assistant-card-heading">
          Talking to Jarvis in a browser
        </Text>
        <Text style={styles.cardBody}>
          The conversation works here. Taking over the assist gesture — holding home or power — is something only the
          Android app can do.
        </Text>
      </View>
    );
  }

  if (registration.roleHeld && registration.voiceInteractionActive) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardHeading}>Jarvis is your assistant</Text>
        <Text style={styles.cardBody}>Hold the home button or the power button, and he answers.</Text>
      </View>
    );
  }

  if (!registration.settingsReachable) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardHeading}>This phone has no assistant picker</Text>
        <Text style={styles.cardBody}>
          The manufacturer has removed the setting, so Jarvis cannot take over the assistant gesture here. The button
          above still works.
        </Text>
      </View>
    );
  }

  const heading = registration.roleHeld ? 'Jarvis answers, but only partly' : 'Jarvis is not your assistant yet';
  const body = registration.roleHeld
    ? 'This phone sends Jarvis the short form of the assist gesture, so he opens in front of what you were doing rather than over it.'
    : 'Open Assist & voice input, choose Digital assistant app, and pick Jarvis.';

  return (
    <View style={styles.card}>
      <Text style={styles.cardHeading}>{heading}</Text>
      <Text style={styles.cardBody}>{body}</Text>

      {registration.roleHeld ? null : (
        <Pressable
          accessibilityRole="button"
          style={styles.cardButton}
          onPress={() => {
            try {
              openAssistantSettings();
              setProblem(undefined);
            } catch (error: unknown) {
              setProblem(error instanceof Error ? error.message : 'Settings could not be opened.');
            }
          }}
        >
          <Text style={styles.cardButtonLabel}>Open assistant settings</Text>
        </Pressable>
      )}

      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.large,
    // The app draws edge to edge, and with the hologram the screen is taller than
    // a small phone: scrolled to the top, the title would sit under the status bar.
    paddingTop: theme.spacing.large + (NativeStatusBar.currentHeight ?? 0),
    gap: theme.spacing.large,
  },
  title: {
    color: theme.colors.text,
    fontSize: 28,
    letterSpacing: 6,
    fontWeight: '600',
  },
  status: {
    color: theme.colors.mutedText,
    fontSize: 16,
  },
  // A pill rather than the large disc it used to be: the hologram above it is
  // what the eye should land on, and the button only has to be easy to hit.
  talkButton: {
    minWidth: 168,
    height: 56,
    borderRadius: 28,
    paddingHorizontal: theme.spacing.large,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  talkButtonLive: {
    backgroundColor: theme.colors.danger,
  },
  talkButtonLabel: {
    color: theme.colors.accentText,
    fontSize: 22,
    fontWeight: '700',
  },
  problem: {
    color: theme.colors.danger,
    textAlign: 'center',
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.spacing.medium,
    gap: theme.spacing.small,
  },
  cardHeading: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  cardBody: {
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  cardButton: {
    marginTop: theme.spacing.small,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.small,
    alignItems: 'center',
  },
  cardButtonLabel: {
    color: theme.colors.accentText,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: theme.spacing.small,
  },
  secondaryButtonLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
});
