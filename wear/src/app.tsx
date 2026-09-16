import { JarvisHologram } from 'hologram/react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { silentVoice } from './silent-voice';
import { useWatchHologramSize } from './watch-screen';

/**
 * Jarvis on a watch: the sphere, and nothing else.
 *
 * There is no conversation here yet and no microphone. What this app is for, today, is the one
 * question a watch asks that a phone does not — whether the hardware can draw him at a frame rate
 * worth looking at — and the answer to that is the same whether or not he is being spoken to.
 *
 * The sphere is not a copy. It comes from `hologram/`, the same files the phone bundles, so
 * changing how Jarvis looks is one edit in one place and both apps follow.
 */
export function App() {
  const size = useWatchHologramSize();

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View
        accessible
        accessibilityLabel="Jarvis"
        style={{ width: size, height: size }}
        testID="hologram"
      >
        <JarvisHologram size={size} voice={silentVoice} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Black to the edges: on a round OLED screen the corners are neither lit nor shown. */
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
});
