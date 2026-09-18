import { JarvisHologram } from 'hologram/react';
import { StyleSheet, Text, View } from 'react-native';
import { silentVoice } from './silent-voice';
import { useWatchDensity, WATCH_PARTICLE_COUNT } from './watch-density';
import { useWatchHologramSize } from './watch-screen';

interface WaitingForThePhoneProps {
  /** Whether the last ask found a phone at all, which is the only thing worth saying differently. */
  isPhoneInRange: boolean;
}

/**
 * The watch's whole setup screen: Jarvis idling, and one line saying what is missing.
 *
 * **There is no form here and there should never be one.** An ElevenLabs API key is fifty
 * characters beginning `sk_`, and the phone already has it; the Data Layer exists to carry exactly
 * that, and `watch/app.config.ts` shares the phone's package name and signing key so that it can.
 * See `phone-settings.ts` for the asking. A watch keyboard is not a setup surface.
 *
 * So the only two things this screen can be is waiting, or waiting and knowing why. The sphere
 * turns behind both, because somebody who just installed this on their watch should see Jarvis
 * rather than a spinner — and because the sphere idling *is* the honest picture of the state: he
 * is here, he simply has nothing to talk to yet.
 */
export function WaitingForThePhone({ isPhoneInRange }: WaitingForThePhoneProps) {
  const size = useWatchHologramSize();
  // Handing these over is what turns the density loop on at all — the drawing skips it
  // entirely when there is nowhere to write the frame rate. See `watch-density.ts`.
  const { frameRate, buildMilliseconds, particleShare, provenShare } = useWatchDensity();

  return (
    <View style={styles.screen}>
      <View
        accessible
        accessibilityLabel="Jarvis, waiting for your phone"
        style={{ width: size, height: size }}
        testID="hologram"
      >
        <JarvisHologram
          size={size}
          voice={silentVoice}
          particleCount={WATCH_PARTICLE_COUNT}
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          provenShare={provenShare}
          opaque
          background="#000000"
        />
      </View>

      <Text style={styles.waiting} testID="waiting-for-the-phone">
        {isPhoneInRange ? 'Open Jarvis on your phone' : 'Bring your phone nearer'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  /**
   * Low on the screen and over the sphere, which fills it.
   *
   * A round display has no margins to lay anything out in, so the one line this screen has sits on
   * top of him near the bottom, where a round bezel still leaves it readable.
   */
  waiting: {
    position: 'absolute',
    bottom: '18%',
    left: 20,
    right: 20,
    color: '#94a3b8',
    textAlign: 'center',
    fontSize: 13,
  },
});
