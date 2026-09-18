import * as Linking from 'expo-linking';
import type { ElevenLabsSettings } from 'hologram';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type AssistantSettingsScreen, openAssistantSettings } from '../modules/jarvis-assistant';
import { ElevenLabsFields } from './elevenlabs-fields';
import {
  AGENT_LINKS,
  CREDENTIAL_LINKS,
  firstOnboardingStep,
  type OnboardingGround,
  type OnboardingLink,
  type OnboardingStep,
  onboardingProgress,
  stepAfterOnboardingStep,
  stepBeforeOnboardingStep,
} from './onboarding';
import { theme } from './theme';
import { useAssistantRegistration } from './use-assistant-registration';
import { WatchCard } from './watch-card';

interface OnboardingScreenProps {
  /** Credentials already stored, which happens when the tour is resumed. See {@link OnboardingGround}. */
  settings: ElevenLabsSettings | undefined;
  /**
   * Called the moment the two values parse, rather than at the end of the tour.
   *
   * The step after this one sends the user out to Android's settings, from where the app is not
   * guaranteed to come back alive. Holding a pasted API key in component state across that would
   * be a way to lose it.
   */
  onSaveSettings: (settings: ElevenLabsSettings) => void;
  /** The tour is over — walked to the end, or skipped from the last step. */
  onFinished: () => void;
  /** Off to sample mode, which is a side trip: the tour is still here to come back to. */
  onSkipToSample: () => void;
}

/** What each step is called, at the top of the screen. */
const TITLES: Record<OnboardingStep, string> = {
  agent: 'Jarvis is an ElevenLabs agent',
  credentials: 'Point this app at your agent',
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
 * Opens a link, and says so when it cannot.
 *
 * The URL is in the message on purpose. A link that will not open is not an error the user can do
 * anything about, but an address they can type on another device is — and every one of these goes
 * somewhere they will want on a laptop anyway, since none of this is work for a phone keyboard.
 */
function useLinkOpener(): { open: (link: OnboardingLink) => void; problem: string | undefined } {
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const open = useCallback((link: OnboardingLink) => {
    setProblem(undefined);
    void Linking.openURL(link.url).catch(() => setProblem(`Nothing here could open that. It is ${link.url}`));
  }, []);

  return { open, problem };
}

function TourLink({ link, onOpen }: { link: OnboardingLink; onOpen: (link: OnboardingLink) => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityHint={link.hint}
      style={styles.link}
      onPress={() => onOpen(link)}
      testID={`link-${link.id}`}
    >
      <Text style={styles.linkLabel}>{link.label}</Text>
      <Text style={styles.linkHint}>{link.hint}</Text>
    </Pressable>
  );
}

/** Several of them, with the one failure message they share underneath. */
function TourLinks({ links }: { links: readonly OnboardingLink[] }) {
  const { open, problem } = useLinkOpener();

  return (
    <View style={styles.links}>
      {links.map((link) => (
        <TourLink key={link.id} link={link} onOpen={open} />
      ))}
      {problem ? (
        <Text style={styles.problem} testID="link-problem">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * What an agent is, and that it is the thing to go and make.
 *
 * The third paragraph is the one this step exists for. Everything else about setting Jarvis up
 * reads like configuring an app; what is actually being set up is an assistant that can be given
 * your calendar, your shopping list and your house, and none of that wiring happens in this app.
 */
function AgentStep() {
  return (
    <>
      <Text style={styles.body}>
        This app is his face and his voice. The thinking happens in an agent you own on ElevenLabs — a model with a
        voice, a personality and a name, which you can change whenever you like without touching the app.
      </Text>
      <Text style={styles.body}>
        Everything he can actually do is wired up there too. An agent can be given tools: a webhook to your own server,
        or an MCP server full of them. That is how asking about tomorrow reaches a calendar, and how asking for the
        lights off reaches the lights.
      </Text>
      <Text style={styles.body}>
        So the first part of setting this up happens on their site, not here. You need an account, an agent, and two
        values from it — which the next step asks for.
      </Text>
      <TourLinks links={AGENT_LINKS} />
    </>
  );
}

function CredentialsStep({
  settings,
  onSubmit,
}: {
  settings: ElevenLabsSettings | undefined;
  onSubmit: (settings: ElevenLabsSettings) => void;
}) {
  return (
    <>
      <Text style={styles.body}>
        Two values, both from the ElevenLabs dashboard: which agent is Jarvis, and a key that lets this app open a
        conversation with him. The key goes to ElevenLabs and nowhere else.
      </Text>
      <TourLinks links={CREDENTIAL_LINKS} />
      <ElevenLabsFields settings={settings} submitLabel="Continue" onSubmit={onSubmit} />
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
function AssistantStep({ settings }: { settings: ElevenLabsSettings | undefined }) {
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
        <WatchCard settings={settings} />
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

      <WatchCard settings={settings} />
    </>
  );
}

/**
 * The tour a new install opens with: what Jarvis is, what he needs, and how to be summoned.
 *
 * Three steps, or two in a browser — see `onboarding.ts`, which decides that and holds every link.
 * Skipping straight to sample mode is offered on all of them, because somebody who just installed
 * this wants to see whether it is worth signing up for anything at all, and the honest answer to
 * that is the sphere rather than another paragraph.
 *
 * **It is not a router.** The app has no navigation tree on purpose — an assistant that loads one
 * before it can answer is an assistant that answers late, see `app.tsx` — and a wizard is a
 * `useState` holding which of three screens is showing.
 */
export function OnboardingScreen({ settings, onSaveSettings, onFinished, onSkipToSample }: OnboardingScreenProps) {
  /**
   * The shape of the tour, fixed when it opens rather than recomputed as it is walked.
   *
   * It has to be frozen. Saving the credentials changes `hasSettings`, which would take the
   * credentials step out of the tour from under the user standing on it — and then "the step after
   * this one" would be nothing, and the tour would end one step early, which is exactly the step
   * that recommends the assistant role.
   */
  const [ground] = useState<OnboardingGround>(() => ({
    canBeTheAssistant: Platform.OS === 'android',
    hasSettings: settings !== undefined,
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

  /** The credentials step saves and moves on in one action, so its button is the form's. */
  const saveAndGoOn = useCallback(
    (saved: ElevenLabsSettings) => {
      onSaveSettings(saved);
      forward();
    },
    [onSaveSettings, forward],
  );

  return (
    <ScrollView contentContainerStyle={styles.container} testID={`onboarding-${step}`}>
      <Text style={styles.progress}>
        Step {position} of {total}
      </Text>
      <Text style={styles.title}>{TITLES[step]}</Text>

      {step === 'agent' ? <AgentStep /> : null}
      {step === 'credentials' ? <CredentialsStep settings={settings} onSubmit={saveAndGoOn} /> : null}
      {step === 'assistant' ? <AssistantStep settings={settings} /> : null}

      {/*
        The credentials step's own button is what moves it on, so it does not get a second one.

        Elsewhere it is the brightest thing on the screen while there is a step after this one, and
        deliberately not on the last — there the loud button belongs to the recommendation the step
        is making, and two bright buttons side by side would be the screen declining to say which
        of them it wants pressed.
      */}
      {step === 'credentials' ? null : (
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
  links: {
    gap: theme.spacing.small,
  },
  /** A card rather than underlined text: each of these is a whole errand, not an aside. */
  link: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.card,
    padding: theme.spacing.medium,
    gap: 4,
  },
  linkLabel: {
    color: theme.colors.accent,
    fontWeight: '600',
  },
  linkHint: {
    color: theme.colors.mutedText,
    lineHeight: 18,
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
