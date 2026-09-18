// This import has to come first, and it has to be this package.
//
// `@elevenlabs/react-native` is a side-effect module: importing it installs the WebRTC globals and
// registers the React Native voice session strategy. Reaching for `@elevenlabs/react` or
// `@elevenlabs/client` instead — or importing one of them before this line — leaves the strategy
// unregistered, and the first attempt to talk fails at runtime with "No voice session setup
// strategy registered". The same note as at the top of `mobile/src/app.tsx`, and the same trap.
import { ConversationProvider } from '@elevenlabs/react-native';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ConversationScreen } from './conversation-screen';
import { usePhoneHandover } from './phone-settings';
import { WaitingForThePhone } from './waiting-for-the-phone';

/**
 * Jarvis on a watch: him, and a conversation with the same agent the phone talks to.
 *
 * **No router and no settings screen.** There are two states and the app is in whichever one the
 * store puts it in: it has the ElevenLabs credentials, in which case it opens a conversation the
 * moment the screen does, or it has not, in which case it asks the phone for them and turns while
 * it waits. Nothing is ever typed here — see `waiting-for-the-phone.tsx` for why a watch is not a
 * setup surface, and `phone-settings.ts` for how the asking works.
 *
 * The sphere is not a copy. It comes from `hologram/`, the same files the phone bundles, so
 * changing how Jarvis looks is one edit in one place and both apps follow. The conversation is
 * shared the same way, through `conversation/`: one token client, one set of ElevenLabs failures
 * explained once, one pair of voice readers.
 *
 * What a watch still does differently is only what a watch is: a round screen drawn edge to edge,
 * an assistant gesture that arrives as an intent rather than through a voice interaction session,
 * and a credential that arrives from the phone rather than from a keyboard.
 */
export function App() {
  const { settings, isLoaded, isPhoneInRange } = usePhoneHandover();

  return (
    <ConversationProvider>
      <StatusBar hidden />
      <View style={styles.screen}>
        {/*
          The loading frame is a spinner rather than the sphere, and briefly: reading the store is
          one synchronous native call. Drawing Jarvis for a frame and then remounting him — the
          conversation screen is a different tree — would cost his materialisation, which is the
          one bit of ceremony this app has.
        */}
        {isLoaded ? null : <ActivityIndicator color="#38bdf8" />}
        {isLoaded && settings ? <ConversationScreen settings={settings} /> : null}
        {isLoaded && !settings ? <WaitingForThePhone isPhoneInRange={isPhoneInRange} /> : null}
      </View>
    </ConversationProvider>
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
