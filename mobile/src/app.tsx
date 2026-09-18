// This import has to come first, and it has to be this package.
//
// `@elevenlabs/react-native` is a side-effect module: importing it installs the
// WebRTC globals and registers the React Native voice session strategy. Reaching
// for `@elevenlabs/react` or `@elevenlabs/client` instead — or importing one of
// them before this line — leaves the strategy unregistered, and the first
// attempt to talk fails at runtime with "No voice session setup strategy
// registered".
import { ConversationProvider } from '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import type { ElevenLabsSettings } from 'hologram';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useAnswerTheWatch } from './answer-the-watch';
import { isAssistLaunch } from './assist-link';
import { ConversationScreen } from './conversation-screen';
import { firstOnboardingStep } from './onboarding';
import { OnboardingScreen } from './onboarding-screen';
import { hasWalkedOnboarding, rememberOnboardingWalked } from './onboarding-storage';
import { SampleScreen } from './sample-screen';
import { SettingsScreen } from './settings-screen';
import { loadElevenLabsSettings, saveElevenLabsSettings } from './settings-storage';
import { theme } from './theme';

/**
 * How hard to try to read the settings before giving up and asking for them again.
 *
 * Only a read that *failed* is retried — settings that are simply not there are answered the first
 * time. See the effect that uses this.
 */
const READ_SETTINGS_ATTEMPTS = 4;
const READ_SETTINGS_AGAIN_MS = 200;

/** Which screen is showing. */
type Screen = 'loading' | 'sample' | 'onboarding' | 'settings' | 'conversation';

/**
 * Which one, given everything that has a say in it.
 *
 * The order is the argument. Sample mode comes first because it is a side trip taken *from*
 * somewhere and returned to — including from the tour, where it is offered on every step. The tour
 * comes next because a first run has nothing else worth showing. The bare settings screen is what
 * is left for an install that has been through the tour and has no credentials any more, which is
 * where this app opened before there was a tour at all.
 */
function chooseScreen(state: {
  isLoaded: boolean;
  hasSettings: boolean;
  isEditingSettings: boolean;
  isSampling: boolean;
  isTouring: boolean;
}): Screen {
  if (!state.isLoaded) {
    return 'loading';
  }
  if (state.isSampling) {
    return 'sample';
  }
  if (state.isTouring) {
    return 'onboarding';
  }
  if (!state.hasSettings) {
    return 'settings';
  }
  return state.isEditingSettings ? 'settings' : 'conversation';
}

export interface AppProps {
  /**
   * Set when the app is being drawn into the assistant's own window rather than its own.
   *
   * An initial prop from the native side — `JarvisVoiceInteractionSession` puts it there when it
   * renders this component into the window the system draws over whatever was on screen. There is
   * no launch URL in that case, because nothing was launched, so this is how a summoning announces
   * itself there.
   */
  summoned?: boolean;
}

/**
 * The whole app: a conversation, and the settings it needs in order to happen.
 *
 * No router. Two screens, one of which only exists until the other one can work,
 * is a `useState` — and an assistant that has to load a navigation tree before it
 * can answer is an assistant that answers late. The third, sample mode, is a
 * side trip from setup and back — and where a summoning lands when there is
 * nothing set up yet.
 */
export function App({ summoned = false }: AppProps) {
  const [settings, setSettings] = useState<ElevenLabsSettings | undefined>(undefined);
  /**
   * Whether the first-run tour is already behind this install.
   *
   * True until told otherwise, so that nothing shows a tour in the frame before the answer
   * arrives — and so that a store that cannot be read shows none either. See
   * `onboarding-storage.ts`.
   */
  const [hasWalkedTour, setHasWalkedTour] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSampling, setIsSampling] = useState(false);

  // Hands the credentials to the watch whenever it asks, for as long as this app is open. See
  // `answer-the-watch.ts`; the watch only ever asks when it has none of its own.
  useAnswerTheWatch(settings);

  const launchUrl = Linking.useURL();
  // Two ways in, and they are genuinely different: the assistant's own window renders this
  // component directly, with nothing launched and so no URL to read, while a plain ASSIST intent
  // opens the app's own window with one.
  const wasSummoned = summoned || isAssistLaunch(launchUrl);

  /**
   * Reads the settings, and tries again if the *reading* failed rather than the settings being
   * absent.
   *
   * The two are not the same thing and used to be answered the same way. A read that throws in the
   * assistant's own window — a surface the system has only just created, where a native module can
   * still be coming up — would land here as "nothing configured", and a summoned Jarvis would open
   * sample mode with credentials sitting in the keystore the whole time. That is what the blank
   * sheet was. A handful of attempts a fifth of a second apart costs nothing and covers it; if they
   * all fail the settings screen opens, which is the right answer for a keystore that genuinely
   * cannot be read any more.
   */
  useEffect(() => {
    let wanted = true;
    void (async () => {
      // Started here and awaited below: the tour flag is one read that never throws, and making
      // it wait its turn behind the retries above would hold the whole app on a spinner.
      const walking = hasWalkedOnboarding();

      for (let attempt = 0; attempt < READ_SETTINGS_ATTEMPTS && wanted; attempt++) {
        const stored = await loadElevenLabsSettings();
        if (stored.kind === 'settings') {
          setSettings(stored.settings);
          break;
        }
        if (stored.kind === 'nothing') {
          break;
        }
        await new Promise((wait) => setTimeout(wait, READ_SETTINGS_AGAIN_MS));
      }

      const walked = await walking;
      if (wanted) {
        setHasWalkedTour(walked);
        setIsLoaded(true);
      }
    })();
    return () => {
      wanted = false;
    };
  }, []);

  // Summoned before there is anything to summon: show the hologram rather than a
  // form. Someone who pressed the assistant button asked for Jarvis, and a
  // settings screen is the least Jarvis-like answer available — sample mode at
  // least listens to them. Tapping beside him still leaves for setup, and this
  // does not fire again once they have gone there, because nothing it depends on
  // has changed.
  useEffect(() => {
    if (wasSummoned && isLoaded && settings === undefined) {
      setIsSampling(true);
    }
  }, [wasSummoned, isLoaded, settings]);

  const save = (saved: ElevenLabsSettings) => {
    setSettings(saved);
    setIsEditingSettings(false);
    void saveElevenLabsSettings(saved);
  };

  /**
   * The tour is over, and is not to be offered again.
   *
   * Remembered rather than inferred from the credentials being there, because the last step comes
   * *after* they are saved: see `onboarding-storage.ts`.
   */
  const finishTour = () => {
    setHasWalkedTour(true);
    void rememberOnboardingWalked();
  };

  // Nothing left to walk is the same as having walked it — a browser whose credentials were saved
  // before the tour finished has no step remaining, since the assistant step does not exist there.
  const tourHasSteps =
    firstOnboardingStep({
      canBeTheAssistant: Platform.OS === 'android',
      hasSettings: settings !== undefined,
    }) !== undefined;

  const screen = chooseScreen({
    isLoaded,
    hasSettings: settings !== undefined,
    isEditingSettings,
    isSampling,
    // Never to somebody who just made the assistant gesture. They asked for Jarvis, and the answer
    // to that is him — sample mode, if there is nothing set up — rather than a guided tour.
    isTouring: !hasWalkedTour && !wasSummoned && tourHasSteps,
  });

  return (
    <ConversationProvider>
      <StatusBar style="light" />
      <View style={[styles.root, screen === 'sample' ? styles.seeThrough : styles.opaque]}>
        {screen === 'loading' ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {screen === 'sample' ? <SampleScreen onLeave={() => setIsSampling(false)} /> : null}
        {screen === 'onboarding' ? (
          <OnboardingScreen
            settings={settings}
            onSaveSettings={save}
            onFinished={finishTour}
            onSkipToSample={() => setIsSampling(true)}
          />
        ) : null}
        {screen === 'settings' ? (
          <SettingsScreen
            settings={settings}
            onSave={save}
            onCancel={settings ? () => setIsEditingSettings(false) : undefined}
            onTrySample={settings ? undefined : () => setIsSampling(true)}
          />
        ) : null}
        {screen === 'conversation' && settings ? (
          <ConversationScreen settings={settings} onEditSettings={() => setIsEditingSettings(true)} />
        ) : null}
      </View>
    </ConversationProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
  },
  /**
   * The app's window is see-through — see `withTransparentWindow` in `app.config.ts` — so
   * whatever paints a background has to be here. Everything but sample mode wants one.
   */
  opaque: {
    backgroundColor: theme.colors.background,
  },
  /**
   * Sample mode floats over the home screen, and paints its own scrim instead.
   *
   * On Android only. A browser has nothing behind the page to float over, so leaving the root
   * unpainted there shows the document's own white — which is what the published site looked
   * like: Jarvis on a white page. On web it keeps the same dark the rest of the app uses.
   */
  seeThrough: {
    backgroundColor: Platform.OS === 'android' ? 'transparent' : theme.colors.background,
  },
});
