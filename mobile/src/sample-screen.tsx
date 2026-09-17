import { PARTICLE_COUNT, startFromRemembered } from 'hologram';
import { LEAVING_SECONDS, useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, useWindowDimensions } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { FrameRate } from './frame-rate';
import { JarvisHologram } from './jarvis-hologram';
import { ModeToast } from './mode-toast';
import { moodOf, nextSampleMode, type SampleMode } from './sample-mode';
import { SAMPLE_CANVAS, SampleSheet, sampleHologramSize } from './sample-sheet';
import { useSampleVoice } from './sample-voice';
import { useSimulatedVoice } from './simulated-voice';
import { readProvenSparks, rememberProvenSparks } from './spark-memory';
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
 * Drawn in a solid sheet that slides up from the bottom, over whatever is behind the app —
 * summoned by the assistant gesture, that is the live screen underneath.
 *
 * **Jarvis is not drawn until the sheet has stopped moving**, which is a performance decision
 * before it is a flourish: see `sample-sheet.tsx`. It happens to be the right flourish too. The
 * sheet arrives, and then he forms inside it, which is what his materialisation was always for.
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
/** How often the remembered count is looked at, and how much better it has to be to be written. */
const REMEMBER_EVERY_MS = 4000;
const REMEMBER_WHEN_BETTER_BY = 0.03;

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
  // Nothing is drawn until the sheet has stopped moving; see `sample-sheet.tsx` for why.
  const [settled, setSettled] = useState(false);
  const { voice: heard } = useSampleVoice(mode === 'microphone' && settled && !leaving);
  const imagined = useSimulatedVoice(settled ? moodOf(mode) : undefined);
  const { width, height } = useWindowDimensions();
  // How big the square is, and whether there is a sheet around it at all, are the same decision —
  // so both live in `sample-sheet.tsx` rather than being worked out again here. On a phone it is
  // the sheet's shorter side inset from its edge, which an opaque canvas has to be because a
  // `SurfaceView` is its own hardware layer that no parent can clip. On the web there is no sheet
  // and no `SurfaceView`, and he simply fills the middle of the window.
  const hologramSize = sampleHologramSize(width, height);
  const going = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isForeground = useIsForeground();
  // Filled in on the UI thread by the hologram, read twice a second by the readout in the corner.
  const frameRate = useSharedValue(0);
  const buildMilliseconds = useSharedValue(0);
  // Nought means "nothing measured yet", which is what lets the hologram tell a first mount from a
  // rebuilt one and carry the count across the second.
  const particleShare = useSharedValue(0);
  const provenShare = useSharedValue(0);
  const [startingShare, setStartingShare] = useState<number | undefined>(undefined);

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
    // Jarvis fades first and the sheet follows him down, so the two together take longer than
    // either; `onGone` below is what says the whole of it is over.
    going.current = setTimeout(() => undefined, LEAVING_SECONDS * 1000);
  }, []);

  /**
   * Everything has gone: the sheet is off the bottom of the screen and there is nothing to see.
   *
   * Summoned, the app *is* the assistant's window and there is nothing behind it but whatever the
   * user was already doing, so finishing means retracting that window; opened as an app, there is
   * a settings screen behind it to go back to.
   */
  const finish = useCallback(() => {
    if (!dismissAssistantWindow()) {
      onLeave();
    }
  }, [onLeave]);

  useEffect(() => () => clearTimeout(going.current), []);

  // What this phone managed last time, so the climb does not have to happen in front of anyone.
  useEffect(() => {
    let wanted = true;
    void readProvenSparks().then((proven) => {
      if (wanted && proven > 0) {
        setStartingShare(startFromRemembered(proven));
      }
    });
    return () => {
      wanted = false;
    };
  }, []);

  // And writing it back. Rarely, and only when it has actually gone up: this is a keystore write,
  // not a counter, and the value only ever rises anyway.
  useEffect(() => {
    let written = 0;
    const timer = setInterval(() => {
      const proven = provenShare.value;
      if (proven > written + REMEMBER_WHEN_BETTER_BY) {
        written = proven;
        void rememberProvenSparks(proven);
      }
    }, REMEMBER_EVERY_MS);
    return () => clearInterval(timer);
  }, [provenShare]);

  // Summoned again after leaving, this screen is the one that was already here: retracting the
  // assistant's window does not unmount it, so without this it would come back still on its way
  // out, faded to nothing and unable to leave a second time.
  //
  // **Not on the first run, which is the mount**, and there is nothing to reset then. That looked
  // harmless for as long as the sheet was the only thing announcing `onSettled`, because it does so
  // a quarter of a second later, long after any mount effect. On the web there is no sheet and
  // nothing to wait for, so it announces during its own mount effect — and a child's effects run
  // before its parent's, so this one fired straight afterwards and set `settled` back to false for
  // good. Jarvis never drew and the microphone never opened.
  const summonedBefore = useRef(false);
  useEffect(() => {
    if (!summonedBefore.current) {
      summonedBefore.current = true;
      return;
    }
    if (isForeground) {
      clearTimeout(going.current);
      going.current = undefined;
      setLeaving(false);
      setSettled(false);
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
    <SampleSheet leaving={leaving} onSettled={() => setSettled(true)} onGone={finish} onTapBeside={leave}>
      {/* Jarvis is the control. Tapping him walks the moods; tapping beside him leaves. */}
      <Pressable
        accessible
        accessibilityRole="button"
        accessibilityLabel={MODE_LABELS[mode]}
        style={{ width: hologramSize, height: hologramSize }}
        onPress={() => !leaving && setMode(nextSampleMode(mode))}
        testID="hologram"
      >
        {settled ? (
          <JarvisHologram
            size={hologramSize}
            voice={mode === 'microphone' ? heard : imagined}
            quietestSpeech={QUIETEST_SPEECH_HERE}
            thinking={mode === 'thinking'}
            leaving={leaving}
            frameRate={frameRate}
            buildMilliseconds={buildMilliseconds}
            particleShare={particleShare}
            provenShare={provenShare}
            startingShare={startingShare}
            opaque={SAMPLE_CANVAS.opaque}
            background={SAMPLE_CANVAS.background}
          />
        ) : null}
      </Pressable>
      <ModeToast mode={mode} />
      <FrameRate
        frameRate={frameRate}
        buildMilliseconds={buildMilliseconds}
        particleShare={particleShare}
        particles={PARTICLE_COUNT}
      />
    </SampleSheet>
  );
}
