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
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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

/**
 * The whole app: a conversation, and the settings it needs in order to happen.
 *
 * No router. Two screens, one of which only exists until the other one can work,
 * is a `useState` — and an assistant that has to load a navigation tree before it
 * can answer is an assistant that answers late. The third, sample mode, is a
 * side trip from setup and back — and where a summoning lands when there is
 * nothing set up yet.
 */
export function App() {
  const [settings, setSettings] = useState<ElevenLabsSettings | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isSampling, setIsSampling] = useState(false);

  const launchUrl = Linking.useURL();
  const wasSummoned = isAssistLaunch(launchUrl);

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
        {screen === 'sample' ? <SampleScreen onLeave={() => setIsSampling(false)} /> : null}
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
  /** Sample mode floats over the home screen, and paints its own scrim instead. */
  seeThrough: {
    backgroundColor: 'transparent',
  },
});
