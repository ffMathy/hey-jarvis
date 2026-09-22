import { moodOf, nextSampleMode, SAMPLE_MODE_LABELS, type SampleMode } from 'hologram';
import { JarvisHologram } from 'hologram/react';
import { FrameRate, ModeToast, useSimulatedVoice } from 'hologram/react/sample';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useWatchDensity, WATCH_PARTICLE_COUNT } from './watch-density';
import { useWatchHologramSize } from './watch-screen';

interface WaitingForThePhoneProps {
  /** Whether the last ask found a phone at all, which is the only thing worth saying differently. */
  isPhoneInRange: boolean;
}

/**
 * The watch's whole setup screen: Jarvis in sample mode, and one line saying what is missing.
 *
 * **There is no form here and there should never be one.** An ElevenLabs API key is fifty
 * characters beginning `sk_`, and the phone already has it; the Data Layer exists to carry exactly
 * that, and `watch/app.config.ts` shares the phone's package name and signing key so that it can.
 * See `phone-settings.ts` for the asking. A watch keyboard is not a setup surface.
 *
 * So what this screen says is only ever waiting, or waiting and knowing why. The sphere turns
 * behind it, because somebody who just installed this on their watch should see Jarvis rather than
 * a spinner — and since there is nothing else for him to do yet, he is the phone's sample mode:
 * tapping him walks speaking, thinking and at rest, the name of the mood shows for a moment, and
 * how fast he is being drawn and with how many particles sits at the top. Those moods, their order
 * and the readout are the phone's own, from `hologram/react/sample`; only where they sit is this
 * screen's, laid out for a round face.
 *
 * The readout is on this screen and not on the conversation screen, deliberately: once there is
 * somebody to talk to, the watch is the assistant and has nothing on it but him.
 */
export function WaitingForThePhone({ isPhoneInRange }: WaitingForThePhoneProps) {
  const size = useWatchHologramSize();
  const [mode, setMode] = useState<SampleMode>('speaking');
  const voice = useSimulatedVoice(moodOf(mode));
  // Handing these over is what turns the density loop on at all — the drawing skips it
  // entirely when there is nowhere to write the frame rate. See `watch-density.ts`.
  const { frameRate, buildMilliseconds, particleShare, provenShare } = useWatchDensity();

  return (
    <View style={styles.screen}>
      {/* Jarvis is the control: there is no room on a watch face for buttons, and no text to hang them off. */}
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={SAMPLE_MODE_LABELS[mode]}
        style={{ width: size, height: size }}
        onPress={() => setMode(nextSampleMode(mode))}
        testID="hologram"
      >
        <JarvisHologram
          size={size}
          voice={voice}
          thinking={mode === 'thinking'}
          particleCount={WATCH_PARTICLE_COUNT}
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          provenShare={provenShare}
          opaque
          background="#000000"
        />
      </Pressable>

      <FrameRate
        frameRate={frameRate}
        buildMilliseconds={buildMilliseconds}
        particleShare={particleShare}
        particles={WATCH_PARTICLE_COUNT}
        withBuildTime={false}
        style={styles.frameRate}
      />
      <ModeToast mode={mode} style={styles.toast} />
      <Text style={styles.waiting} testID="waiting-for-the-phone">
        {isPhoneInRange ? 'Open Jarvis on your phone' : 'Bring your phone nearer'}
      </Text>
    </View>
  );
}

/**
 * A round display has no margins to lay anything out in, so everything this screen says sits on
 * top of him, centred, and far enough in from the top and bottom that the bezel's curve still
 * leaves each line its width: a line 12% of the way down has about 65% of the diameter to use, and
 * at 18% about 77%.
 */
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    // The square is wider than the screen — see `watch-screen.ts` — and what hangs off it is not
    // something to scroll to.
    overflow: 'hidden',
  },
  /** Small and centred at the top: an instrument, not something to read at a glance. */
  frameRate: {
    top: '12%',
    alignSelf: 'center',
    color: '#94a3b8',
    fontSize: 10,
    letterSpacing: 0.5,
  },
  /** Just above the line saying what is missing, so the two never overlap. */
  toast: {
    bottom: '27%',
    color: '#e2e8f0',
    fontSize: 12,
    letterSpacing: 1,
  },
  /** Low on the screen and over the sphere, which fills it. */
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
