import { LEAVING_SECONDS, useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { FrameRate } from './frame-rate';
import { useWholeScreenHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { ModeToast } from './mode-toast';
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
  const [leaving, setLeaving] = useState(false);
  const { voice: heard } = useSampleVoice(mode === 'microphone' && !leaving);
  const imagined = useSimulatedVoice(moodOf(mode));
  const hologramSize = useWholeScreenHologramSize();
  const going = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isForeground = useIsForeground();
  // Filled in on the UI thread by the hologram, read twice a second by the readout in the corner.
  const frameRate = useSharedValue(0);

  /**
   * Starts the way out, and finishes it once Jarvis has gone.
   *
   * He shrinks and fades over `LEAVING_SECONDS` rather than being cut off mid-turn — see the
   * `leaving` prop — so the screen it is on has to stay there for exactly that long.
   *
   * Then the two ways out differ. Summoned, the app *is* the assistant's window and there is
   * nothing behind it but whatever the user was already doing, so finishing means retracting that
   * window; opened as an app, there is a settings screen behind it to go back to. Idempotent,
   * because the scrim, the back button and a second tap can all ask at once.
   */
  const leave = useCallback(() => {
    if (going.current) {
      return;
    }
    setLeaving(true);
    going.current = setTimeout(() => {
      if (!dismissAssistantWindow()) {
        onLeave();
      }
    }, LEAVING_SECONDS * 1000);
  }, [onLeave]);

  useEffect(() => () => clearTimeout(going.current), []);

  // Summoned again after leaving, this screen is the one that was already here: retracting the
  // assistant's window does not unmount it, so without this it would come back still on its way
  // out, faded to nothing and unable to leave a second time.
  useEffect(() => {
    if (isForeground) {
      clearTimeout(going.current);
      going.current = undefined;
      setLeaving(false);
    }
  }, [isForeground]);

  // The back button leaves the same way a tap does, rather than closing the window from under him.
  // In the assistant's own window this arrives because the session hands the press to React Native
  // before taking it itself; see `JarvisVoiceInteractionSession.onBackPressed`.
  //
  // Android only, and checked rather than left to the shim: react-native-web's `BackHandler` logs
  // an error to the console for even asking, and a browser has no back button to catch anyway.
  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }
    const press = BackHandler.addEventListener('hardwareBackPress', () => {
      leave();
      return true;
    });
    return () => press.remove();
  }, [leave]);

  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Close" style={styles.scrim} onPress={leave}>
      {/* Jarvis is the control. Tapping him walks the moods; tapping beside him leaves. */}
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={MODE_LABELS[mode]}
        style={[
          styles.jarvis,
          {
            width: hologramSize,
            height: hologramSize,
            marginLeft: -hologramSize / 2,
            marginTop: -hologramSize / 2,
          },
        ]}
        onPress={() => !leaving && setMode(nextSampleMode(mode))}
        testID="hologram"
      >
        <JarvisHologram
          size={hologramSize}
          voice={mode === 'microphone' ? heard : imagined}
          quietestSpeech={QUIETEST_SPEECH_HERE}
          thinking={mode === 'thinking'}
          leaving={leaving}
          frameRate={frameRate}
        />
      </Pressable>
      <ModeToast mode={mode} />
      <FrameRate frameRate={frameRate} />
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
    // The square Jarvis is drawn in is wider than the screen, deliberately — see `CHIP_HEADROOM`.
    // This is what keeps that from being anybody else's problem: what falls outside the screen is
    // cut off here, which on a phone is invisible and in a browser is the difference between a
    // page and a page with a scroll bar and a white margin down the side of it.
    overflow: 'hidden',
  },
  /**
   * Centred without taking part in the layout.
   *
   * Laid out in flow, a square wider than the screen pushes the page around instead of
   * overflowing it: in a browser it blew the whole document out and left the app in the top-left
   * corner of a white page. Absolutely placed at the middle and pulled back by half its own size,
   * it is centred at any size at all and nothing else moves.
   */
  jarvis: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
});
