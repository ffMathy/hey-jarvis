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
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { isAssistLaunch } from './assist-link';
import { ConversationScreen } from './conversation-screen';
import type { ElevenLabsSettings } from './elevenlabs-settings';
import { SampleScreen } from './sample-screen';
import { SettingsScreen } from './settings-screen';
import { loadElevenLabsSettings, saveElevenLabsSettings } from './settings-storage';
import { theme } from './theme';

/** Which screen is showing. */
type Screen = 'loading' | 'sample' | 'settings' | 'conversation';

function chooseScreen(state: {
  isLoaded: boolean;
  hasSettings: boolean;
  isEditingSettings: boolean;
  isSampling: boolean;
}): Screen {
  if (!state.isLoaded) {
    return 'loading';
  }
  if (!state.hasSettings) {
    return state.isSampling ? 'sample' : 'settings';
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
  const [isLoaded, setIsLoaded] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSampling, setIsSampling] = useState(false);

  const launchUrl = Linking.useURL();
  // Two ways in, and they are genuinely different: the assistant's own window renders this
  // component directly, with nothing launched and so no URL to read, while a plain ASSIST intent
  // opens the app's own window with one.
  const wasSummoned = summoned || isAssistLaunch(launchUrl);

  useEffect(() => {
    void (async () => {
      setSettings(await loadElevenLabsSettings());
      setIsLoaded(true);
    })();
  }, []);

  // Summoned before there is anything to summon: show the hologram rather than a
  // form. Someone who pressed the assistant button asked for Jarvis, and a
  // settings screen is the least Jarvis-like answer available — sample mode at
  // least listens to them. `Back to setup` still leads where it says, and this
  // does not fire again once they have gone there, because nothing it depends on
  // has changed.
  useEffect(() => {
    if (wasSummoned && isLoaded && settings === undefined) {
      setIsSampling(true);
    }
  }, [wasSummoned, isLoaded, settings]);

  /**
   * Leaving sample mode, which is not the same thing in both places it can happen.
   *
   * Opened as an app, there is a settings screen behind it to go back to. Summoned, the app is
   * the assistant's window and there is nothing behind it but whatever the user was already
   * doing — so leaving means retracting that window, and changing screens under it would only
   * show them a form they did not ask for.
   */
  const leaveSample = () => {
    if (dismissAssistantWindow()) {
      return;
    }
    setIsSampling(false);
  };

  const save = (saved: ElevenLabsSettings) => {
    setSettings(saved);
    setIsEditingSettings(false);
    void saveElevenLabsSettings(saved);
  };

  const screen = chooseScreen({ isLoaded, hasSettings: settings !== undefined, isEditingSettings, isSampling });

  return (
    <ConversationProvider>
      <StatusBar style="light" />
      <View style={[styles.root, screen === 'sample' ? styles.seeThrough : styles.opaque]}>
        {screen === 'loading' ? <ActivityIndicator color={theme.colors.accent} /> : null}
        {screen === 'sample' ? <SampleScreen onLeave={leaveSample} /> : null}
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
