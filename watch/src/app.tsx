import { StatusBar } from 'expo-status-bar';
import { JarvisHologram } from 'hologram/react';
import { StyleSheet, View } from 'react-native';
import { silentVoice } from './silent-voice';
import { useWatchDensity, WATCH_PARTICLE_COUNT } from './watch-density';
import { useWatchHologramSize } from './watch-screen';

/** Black to the edges: on a round OLED screen the corners are neither lit nor shown, and black
 * costs no light at all. The canvas is told the same value, because an opaque one paints its
 * own background rather than letting this show through. */
const SCREEN_BLACK = '#000000';

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
  // Handing these over is what lets the drawing find a count this watch can hold — and what
  // stopped it being able to is that they were not handed over at all. See `watch-density.ts`.
  const { frameRate, buildMilliseconds, particleShare, provenShare } = useWatchDensity();

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View accessible accessibilityLabel="Jarvis" style={{ width: size, height: size }} testID="hologram">
        <JarvisHologram
          size={size}
          voice={silentVoice}
          particleCount={WATCH_PARTICLE_COUNT}
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          provenShare={provenShare}
          // A `SurfaceView` rather than a `TextureView`, which saves copying every frame into a
          // texture and syncing with the UI thread to composite it — worth more here than anywhere.
          // It has to be told what to paint: a `SurfaceView` is its own hardware layer with nothing
          // behind it, so an opaque canvas with no background is a hole. Black, which is what the
          // screen behind it already is, and on an OLED is the screen switched off.
          opaque
          background={SCREEN_BLACK}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SCREEN_BLACK,
  },
});
