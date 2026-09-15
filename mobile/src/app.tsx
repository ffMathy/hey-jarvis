// This import has to come first, and it has to be this package.
//
// `@elevenlabs/react-native` is a side-effect module: importing it installs the
// WebRTC globals and registers the React Native voice session strategy. Reaching
// for `@elevenlabs/react` or `@elevenlabs/client` instead — or importing one of
// them before this line — leaves the strategy unregistered, and the first
// attempt to talk fails at runtime with "No voice session setup strategy
// registered".
import { ConversationProvider } from '@elevenlabs/react-native';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ConversationScreen } from './conversation-screen';
import type { ElevenLabsSettings } from './elevenlabs-settings';
import { SettingsScreen } from './settings-screen';
import { loadElevenLabsSettings, saveElevenLabsSettings } from './settings-storage';
import { theme } from './theme';

/**
 * The whole app: a conversation, and the settings it needs in order to happen.
 *
 * No router. Two screens, one of which only exists until the other one can work,
 * is a `useState` — and an assistant that has to load a navigation tree before it
 * can answer is an assistant that answers late.
 */
export function App() {
  const [settings, setSettings] = useState<ElevenLabsSettings | undefined>(undefined);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isEditingSettings, setIsEditingSettings] = useState(false);

  useEffect(() => {
    void (async () => {
      setSettings(await loadElevenLabsSettings());
      setIsLoaded(true);
    })();
  }, []);

  const save = (saved: ElevenLabsSettings) => {
    setSettings(saved);
    setIsEditingSettings(false);
    void saveElevenLabsSettings(saved);
  };

  return (
    <ConversationProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {!isLoaded ? (
          <ActivityIndicator color={theme.colors.accent} />
        ) : !settings || isEditingSettings ? (
          <SettingsScreen
            settings={settings}
            onSave={save}
            onCancel={settings ? () => setIsEditingSettings(false) : undefined}
          />
        ) : (
          <ConversationScreen settings={settings} onEditSettings={() => setIsEditingSettings(true)} />
        )}
      </View>
    </ConversationProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
  },
});
