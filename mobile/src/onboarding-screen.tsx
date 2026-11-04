import type { Pairing } from 'hologram';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { type AssistantSettingsScreen, openAssistantSettings } from '../modules/jarvis-assistant';
import {
  firstOnboardingStep,
  type OnboardingGround,
  type OnboardingStep,
  onboardingProgress,
  stepAfterOnboardingStep,
  stepBeforeOnboardingStep,
} from './onboarding';
import { ServerPairing } from './server-pairing';
import { theme } from './theme';
import { useAssistantRegistration } from './use-assistant-registration';
import { WatchCard } from './watch-card';

interface OnboardingScreenProps {
  /** The Jarvis server's address as it was read, if one was. See `jarvis-server.ts`. */
  serverAddress: string | undefined;
  /**
   * This device's pairing with the server, once there is one: what the watch card hands the watch.
   * Its arriving is also what completes the server step — see {@link OnboardingGround}.
   */
  pairing: Pairing | undefined;
  /** A browser was paired with the server there and then (`server-pairing.tsx`). */
  onPaired: (pairing: Pairing) => void;
  /** The phone app is opening the server's pairing page for this address. */
  onPairingAddress: (address: string) => void;
  /** The tour is over — walked to the end, or skipped from the last step. */
  onFinished: () => void;
  /** Off to sample mode, which is a side trip: the tour is still here to come back to. */
  onSkipToSample: () => void;
}

/** What each step is called, at the top of the screen. */
const TITLES: Record<OnboardingStep, string> = {
  server: 'Jarvis lives on your Jarvis server',
  assistant: 'Let him answer from anywhere',
};

/** Where {@link openAssistantSettings} landed, and so what is left for the user to tap. */
const WHERE_TO_GO: Record<AssistantSettingsScreen, string> = {
  'voice-input': 'You are on Assist & voice input. Tap Digital assistant app, then choose Jarvis.',
  'default-apps': 'You are in Default apps. Open Digital assistant app, then choose Jarvis.',
  settings: 'Look for Apps, then Default apps, then Digital assistant app, and choose Jarvis.',
};

/** The way to the picker when this phone has no picker to send anyone to. */
const FIND_IT_BY_HAND =
  'This phone has no assistant picker to open from here. Look in Settings for Apps, then Default apps, then Digital assistant app.';

/**
 * What the Jarvis server is, and pairing this device with it — the whole of setting Jarvis up.
 *
 * The step has no Next: pairing is what moves it on (see `OnboardingScreen`), because without it
 * there is nothing on the far side of the tour to talk to. On a phone the pairing finishes in the
 * browser and comes back on the app's own link, so the step waits for it rather than for a tap.
 */
function ServerStep({
  serverAddress,
  paired,
  onPaired,
  onPairingAddress,
}: {
  serverAddress: string | undefined;
  paired: boolean;
  onPaired: (pairing: Pairing) => void;
  onPairingAddress: (address: string) => void;
}) {
  return (
    <>
      <Text style={styles.body}>
        This app is his face and his voice. Jarvis himself runs on your own Jarvis server: it holds the ElevenLabs key
        and the agent, reaches your calendar, your shopping list and your house, and starts every conversation you have
        with him — on this phone, your watch and your headset alike.
      </Text>
      <Text style={styles.body}>
        So the one thing to set up here is which server is yours. Pair with it once, and nothing else is ever typed in.
      </Text>
      <ServerPairing
        storedAddress={serverAddress}
        paired={paired}
        onPaired={onPaired}
        onPairingAddress={onPairingAddress}
      />
    </>
  );
}

/**
 * The recommendation to hand Jarvis the assistant role, and the button that opens the picker.
 *
 * **There is no way to ask for the role.** Android marks it not requestable, so the API that looks
 * like it would ask shows nothing at all — the choice has to be made on a screen this app does not
 * own. All this can do is open the nearest screen to it and say what to tap, which is why the
 * guidance changes depending on where {@link openAssistantSettings} managed to land.
 *
 * It answers again when the app comes back to the foreground, because that is the only moment the
 * answer can have changed without anything here being called. See `use-assistant-registration.ts`.
 */
function AssistantStep({ pairing }: { pairing: Pairing | undefined }) {
  const { roleHeld, voiceInteractionActive, settingsReachable } = useAssistantRegistration();
  const [went, setWent] = useState<AssistantSettingsScreen | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const go = useCallback(() => {
    setProblem(undefined);
    try {
      setWent(openAssistantSettings());
    } catch {
      setProblem(FIND_IT_BY_HAND);
    }
  }, []);

  if (roleHeld) {
    return (
      <>
        <Text style={styles.body} testID="assistant-held">
          Jarvis is your assistant. Hold the power button, or make whatever gesture this phone uses, and he comes up
          over whatever you were doing.
        </Text>
        {voiceInteractionActive ? null : (
          <Text style={styles.body}>
            This phone only sends the cut-down assist intent, so he opens as an app rather than over the top of one.
            Everything else works the same.
          </Text>
        )}
        <WatchCard pairing={pairing} />
      </>
    );
  }

  return (
    <>
      <Text style={styles.body}>
        Android sends the assistant gesture to whichever app holds the role — by default that is Gemini. Hand it to
        Jarvis and he is who answers, from any app and from the lock screen.
      </Text>
      <Text style={styles.body}>
        Android will not let an app take the role for itself, so the last tap has to be yours. This opens the screen it
        is chosen on.
      </Text>

      {settingsReachable ? (
        <Pressable accessibilityRole="button" style={styles.primaryButton} onPress={go} testID="choose-assistant">
          <Text style={styles.primaryButtonLabel}>Open the assistant setting</Text>
        </Pressable>
      ) : (
        <Text style={styles.body} testID="assistant-by-hand">
          {FIND_IT_BY_HAND}
        </Text>
      )}

      {went ? (
        <Text style={styles.body} testID="assistant-directions">
          {WHERE_TO_GO[went]}
        </Text>
      ) : null}
      {problem ? (
        <Text style={styles.problem} testID="assistant-problem">
          {problem}
        </Text>
      ) : null}

      <WatchCard pairing={pairing} />
    </>
  );
}

/**
 * The tour a new install opens with: what Jarvis is, pairing with him, and how to be summoned.
 *
 * Two steps, or one in a browser — see `onboarding.ts`, which decides that. Skipping straight to
 * sample mode is offered on all of them, because somebody who just installed this wants to see
 * whether it is worth setting anything up at all, and the honest answer to that is the sphere
 * rather than another paragraph.
 *
 * **It is not a router.** The app has no navigation tree on purpose — an assistant that loads one
 * before it can answer is an assistant that answers late, see `app.tsx` — and a wizard is a
 * `useState` holding which of its screens is showing.
 */
export function OnboardingScreen({
  serverAddress,
  pairing,
  onPaired,
  onPairingAddress,
  onFinished,
  onSkipToSample,
}: OnboardingScreenProps) {
  const paired = pairing !== undefined;
  /**
   * The shape of the tour, fixed when it opens rather than recomputed as it is walked.
   *
   * It has to be frozen. Pairing changes `isPaired`, which would take the server step out of the
   * tour from under the user standing on it — and then "the step after this one" would be nothing,
   * and the tour would end one step early, which is exactly the step that recommends the assistant
   * role.
   */
  const [ground] = useState<OnboardingGround>(() => ({
    canBeTheAssistant: Platform.OS === 'android',
    isPaired: paired,
  }));
  /**
   * Where it opens. The fallback is unreachable — `app.tsx` does not render this screen when there
   * is no step to walk — and is the last step rather than the first so that a tour reached by some
   * route nobody has thought of yet ends on the next tap instead of starting over.
   */
  const [step, setStep] = useState<OnboardingStep>(() => firstOnboardingStep(ground) ?? 'assistant');

  const { position, total } = onboardingProgress(step, ground);
  const back = stepBeforeOnboardingStep(step, ground);
  const next = stepAfterOnboardingStep(step, ground);

  /** Forward, or out: the last step's "next" is the end of the tour. */
  const forward = useCallback(() => {
    if (next) {
      setStep(next);
      return;
    }
    onFinished();
  }, [next, onFinished]);

  /**
   * A new pairing completes the server step, however it arrived: from the browser's own request, or
   * — on a phone — on the link the server's pairing page opened the app with, long after the tap.
   * A new token rather than "paired", so that pairing again after going Back moves on as well, and
   * a pairing that was already there when the step was shown does not.
   */
  const deviceToken = pairing?.deviceToken;
  const seenToken = useRef(deviceToken);
  useEffect(() => {
    if (deviceToken === seenToken.current) return;
    seenToken.current = deviceToken;
    if (deviceToken !== undefined && step === 'server') forward();
  }, [deviceToken, step, forward]);

  /**
   * A browser is paired there and then, and moves on in the same tap. Not through the effect above:
   * pairing a browser can leave no step to walk, and the app then shows the conversation instead of
   * this screen before that effect would run — and the tour would never be remembered as walked.
   */
  const pairAndGoOn = useCallback(
    (paired: Pairing) => {
      seenToken.current = paired.deviceToken;
      onPaired(paired);
      forward();
    },
    [onPaired, forward],
  );

  return (
    <ScrollView contentContainerStyle={styles.container} testID={`onboarding-${step}`}>
      {/* No count for a tour of one step: "Step 1 of 1" says nothing. */}
      {total > 1 ? (
        <Text style={styles.progress} testID="onboarding-progress">
          Step {position} of {total}
        </Text>
      ) : null}
      <Text style={styles.title}>{TITLES[step]}</Text>

      {step === 'server' ? (
        <ServerStep
          serverAddress={serverAddress}
          paired={paired}
          onPaired={pairAndGoOn}
          onPairingAddress={onPairingAddress}
        />
      ) : null}
      {step === 'assistant' ? <AssistantStep pairing={pairing} /> : null}

      {/*
        The server step is moved on by pairing, so it gets no button of its own until it is paired.

        Elsewhere it is the brightest thing on the screen while there is a step after this one, and
        deliberately not on the last — there the loud button belongs to the recommendation the step
        is making, and two bright buttons side by side would be the screen declining to say which
        of them it wants pressed.
      */}
      {step === 'server' && !paired ? null : (
        <Pressable
          accessibilityRole="button"
          style={next ? styles.primaryButton : styles.secondaryButton}
          onPress={forward}
          testID="onboarding-next"
        >
          <Text style={next ? styles.primaryButtonLabel : styles.secondaryButtonLabel}>{next ? 'Next' : 'Done'}</Text>
        </Pressable>
      )}

      {back ? (
        <Pressable
          accessibilityRole="button"
          style={styles.secondaryButton}
          onPress={() => setStep(back)}
          testID="onboarding-back"
        >
          <Text style={styles.secondaryButtonLabel}>Back</Text>
        </Pressable>
      ) : null}

      <Pressable accessibilityRole="button" style={styles.secondaryButton} onPress={onSkipToSample} testID="try-sample">
        <Text style={styles.secondaryButtonLabel}>Skip all this and just look at him</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: theme.spacing.large,
    gap: theme.spacing.medium,
  },
  /** Faint, above the title: a wizard owes you the count, and owes it no emphasis. */
  progress: {
    color: theme.colors.mutedText,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  body: {
    color: theme.colors.mutedText,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.button,
    paddingVertical: theme.spacing.medium,
    alignItems: 'center',
  },
  primaryButtonLabel: {
    color: theme.colors.accentText,
    fontWeight: '700',
  },
  secondaryButton: {
    paddingVertical: theme.spacing.small,
    alignItems: 'center',
  },
  secondaryButtonLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
  problem: {
    color: theme.colors.danger,
  },
});
