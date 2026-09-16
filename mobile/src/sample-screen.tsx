import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useWholeScreenHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { moodOf, nextSampleMode, type SampleMode } from './sample-mode';
import { useSampleVoice } from './sample-voice';
import { useSimulatedVoice } from './simulated-voice';
import { QUIETEST_SPEECH_HERE } from './speech-floor';

interface SampleScreenProps {
  onLeave: () => void;
}

/**
 * Sample mode: the hologram, listening to the user instead of Jarvis.
 *
 * Offered before the app is set up, so there is something to see — and a way to check the hologram
 * really follows a voice — without an ElevenLabs account. Nothing leaves the device: no
 * conversation is started and no audio is kept.
 *
 * Drawn as a sheet over whatever is behind the app rather than as a screen of its own. Summoned by
 * the assistant gesture, that is the live screen underneath, drawn by the system into the
 * assistant's own window; opened as an app, it is the app's see-through window
 * (`withTransparentWindow` in `app.config.ts`) over the wallpaper.
 *
 * **Jarvis and nothing else.** There is no title, no status line, no microphone readout and no way
 * out but tapping beside him — the user asked for every word gone, and an assistant that hovers
 * over your home screen with a paragraph attached is a dialog rather than a presence. The cost is
 * that a microphone that cannot open now says so nowhere: `useSampleVoice` still reports it, and
 * `sample-voice.ts` logs it, but the screen does not show it.
 *
 * **Tapping him walks through what he does** — hearing you, speaking, working, at rest. With no
 * words on the screen there is nowhere to put buttons, so the sphere is its own control, and the
 * four are told apart by how he looks, which is the whole reason for showing them together. Only
 * the first opens the microphone; see `sample-mode.ts` for the order and `simulated-voice.ts` for
 * where the other two come from.
 */
/** What a screen reader is told Jarvis is doing, since nothing on screen says it. */
const MODE_LABELS: Record<SampleMode, string> = {
  microphone: 'Jarvis, listening to your voice. Tap to see him speak.',
  speaking: 'Jarvis, speaking. Tap to see him think.',
  thinking: 'Jarvis, working through something. Tap to see him at rest.',
  idle: 'Jarvis, at rest. Tap to let him hear you again.',
};

export function SampleScreen({ onLeave }: SampleScreenProps) {
  const [mode, setMode] = useState<SampleMode>('microphone');
  const { voice: heard } = useSampleVoice(mode === 'microphone');
  const imagined = useSimulatedVoice(moodOf(mode));
  const hologramSize = useWholeScreenHologramSize();

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.scrim} onPress={onLeave}>
      {/* Jarvis is the control. Tapping him walks the moods; tapping beside him leaves. */}
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={MODE_LABELS[mode]}
        style={{ width: hologramSize, height: hologramSize }}
        onPress={() => setMode(nextSampleMode(mode))}
        testID="hologram"
      >
        <JarvisHologram
          size={hologramSize}
          voice={mode === 'microphone' ? heard : imagined}
          quietestSpeech={QUIETEST_SPEECH_HERE}
        />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /**
   * Nothing at all between the hologram and what is behind the app.
   *
   * It used to be a 55% dark wash, to read the text against. That works, and it also announces
   * itself: what was behind came through visibly dimmed, which is not what an assistant hovering
   * over your screen should look like. Nothing needs reading against it now, and what makes the
   * sphere carry against a bright background is its own backdrop — a radial shadow inside the
   * drawing, so the watch and the browser get it too. See `drawBackdrop` in `hologram-drawing.ts`.
   */
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
});
