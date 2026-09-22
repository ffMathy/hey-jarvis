import { useIsForeground } from 'hologram/react/lifecycle';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, useWindowDimensions } from 'react-native';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { useWholeScreenHologramSize } from './hologram-size';
import { SAMPLE_CANVAS, SampleSheet, sampleHologramSize } from './sample-sheet';

/** How the canvas is set up across the whole screen: see-through, as it always was there. */
const WHOLE_SCREEN_CANVAS: { opaque?: boolean; background?: string } = {};

interface ConversationSheetOptions {
  /** Whether the conversation is drawn in the bottom sheet at all. See `ConversationScreen`. */
  inSheet: boolean;
  /** Whether Jarvis has finished leaving, which is when the window — and the sheet — go too. */
  gone: boolean;
  /** Whether a conversation was ever open on this screen; one that was not has nothing to end. */
  opened: boolean;
  /** Ends the conversation, the way the agent hanging up would. */
  endConversation: () => void;
  /** Sends him straight to `gone`, for a conversation that never opened and so cannot end. */
  goNow: () => void;
  /** Opens a fresh conversation, for a summoning that finds him already gone. */
  summonAgain: () => void;
}

/**
 * Everything that differs about a conversation when it is summoned into the bottom sheet rather
 * than drawn across the whole screen.
 *
 * **The sheet exists because a summoning comes over another app**, and one that blacks the screen
 * out has replaced that app rather than come to help — the argument `sample-sheet.tsx` makes, and
 * the one the user made when a summoned conversation took the whole screen. It used to, and nobody
 * chose that: the sheet was only ever written for sample mode, which is what a summoning showed
 * before there were credentials, so a phone that had been set up simply stopped seeing it.
 *
 * Four things follow from being in it, and all of them are here:
 *
 * - **The square and the canvas are sample mode's**, for sample mode's reason: an opaque canvas is
 *   a `SurfaceView` that no parent can clip, so its size is what holds it inside the sheet.
 * - **Nothing is drawn until the sheet has stopped moving** (`settled`), because a `SurfaceView`
 *   does not move with the view tree.
 * - **Tapping beside it, or back, hangs up.** He then leaves the way he does when the agent hangs
 *   up, and the sheet follows him down.
 * - **A summoning after he has gone brings it back.** The assistant's window is retracted rather
 *   than torn down, so the screen that answers the next summoning is this one, still showing a
 *   conversation that ended — and that window has no launch URL to say it was summoned again.
 *   Coming back to the foreground is the one signal it gets.
 */
export function useConversationSheet({
  inSheet,
  gone,
  opened,
  endConversation,
  goNow,
  summonAgain,
}: ConversationSheetOptions) {
  const wholeScreenSize = useWholeScreenHologramSize();
  const { width, height } = useWindowDimensions();
  const hologramSize = inSheet ? sampleHologramSize(width, height) : wholeScreenSize;
  const canvas = inSheet ? SAMPLE_CANVAS : WHOLE_SCREEN_CANVAS;
  const [settled, setSettled] = useState(!inSheet);
  const isForeground = useIsForeground();

  // Across the whole screen the window goes as soon as he has. In the sheet it waits one step
  // longer, for the sheet to follow him down — see `leaveTheSheet`.
  useEffect(() => {
    if (gone && !inSheet) {
      dismissAssistantWindow();
    }
  }, [gone, inSheet]);

  /**
   * The sheet is off the bottom of the screen: put the window away.
   *
   * The assistant's own window retracts. The app's own activity — a summoning that fell back to
   * opening it — has no such thing, and with its background see-through for the sheet it would be
   * left over the home screen as an invisible pane taking every touch, so it is closed instead.
   */
  const leaveTheSheet = useCallback(() => {
    if (!dismissAssistantWindow()) {
      BackHandler.exitApp();
    }
  }, []);

  const hangUp = useCallback(() => {
    endConversation();
    if (!opened) {
      goNow();
    }
  }, [endConversation, goNow, opened]);

  // Android only, and only in the sheet: across the whole screen the system's own answer to back
  // is the one it has always had.
  useEffect(() => {
    if (!inSheet || Platform.OS !== 'android') {
      return;
    }
    const press = BackHandler.addEventListener('hardwareBackPress', () => {
      hangUp();
      return true;
    });
    return () => press.remove();
  }, [inSheet, hangUp]);

  // Once per return to the foreground, and only when there is no conversation to return to: one
  // still running when the window was put away is simply shown again. `settled` goes back to false
  // so nothing is drawn while the sheet slides up; the sheet says so again when it stops, because
  // `gone` going false is what moves it.
  const wasForeground = useRef(isForeground);
  useEffect(() => {
    const cameBack = isForeground && !wasForeground.current;
    wasForeground.current = isForeground;
    if (!inSheet || !cameBack || !gone) {
      return;
    }
    setSettled(false);
    summonAgain();
  }, [inSheet, isForeground, gone, summonAgain]);

  const onSettled = useCallback(() => setSettled(true), []);

  return { hologramSize, canvas, settled, onSettled, leaveTheSheet, hangUp };
}

/**
 * The conversation as it is framed: in the sheet when summoned, and as it is otherwise.
 *
 * He fades first and the sheet follows him down once he has: `gone` is set `LEAVING_SECONDS` after
 * the conversation ends, which is exactly the order sample mode leaves in.
 */
export function ConversationFrame({
  inSheet,
  gone,
  sheet,
  children,
}: {
  inSheet: boolean;
  gone: boolean;
  sheet: Pick<ReturnType<typeof useConversationSheet>, 'onSettled' | 'leaveTheSheet' | 'hangUp'>;
  children: ReactNode;
}) {
  if (!inSheet) {
    return children;
  }
  return (
    <SampleSheet leaving={gone} onSettled={sheet.onSettled} onGone={sheet.leaveTheSheet} onTapBeside={sheet.hangUp}>
      {children}
    </SampleSheet>
  );
}
