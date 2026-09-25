import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, useWindowDimensions } from 'react-native';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { useWholeScreenHologramSize } from './hologram-size';
import { SAMPLE_CANVAS, SampleSheet, sampleHologramSize } from './sample-sheet';

/** How the canvas is set up across the whole screen: see-through, as it always was there. */
const WHOLE_SCREEN_CANVAS: { opaque?: boolean; background?: string } = {};

interface ConversationSheetOptions {
  /** Whether the conversation is drawn in the bottom sheet at all. See `ConversationScreen`. */
  inSheet: boolean;
  /**
   * Whether this is the app drawn in the assistant's own window, rather than in its own activity.
   * Only that one may retract the window: see `leaveTheSheet`.
   */
  inAssistantWindow: boolean;
  /** Whether Jarvis has finished leaving, which is when the window — and the sheet — go too. */
  gone: boolean;
  /** Whether a conversation was ever open on this screen; one that was not has nothing to end. */
  opened: boolean;
  /** Ends the conversation, the way the agent hanging up would. */
  endConversation: () => void;
  /** Sends him straight to `gone`, for a conversation that never opened and so cannot end. */
  goNow: () => void;
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
 * Three things follow from being in it, and all of them are here:
 *
 * - **The square and the canvas are sample mode's**, for sample mode's reason: an opaque canvas is
 *   a `SurfaceView` that no parent can clip, so its size is what holds it inside the sheet.
 * - **Nothing is drawn until the sheet has stopped moving** (`settled`), because a `SurfaceView`
 *   does not move with the view tree.
 * - **Tapping beside it, or back, hangs up.** He then leaves the way he does when the agent hangs
 *   up, and the sheet follows him down.
 *
 * What brings it back up for the next summoning is not here: the screen answers a summoning
 * however it arrives, and the sheet simply follows `gone` going false. See `summonAgain` there.
 */
export function useConversationSheet({
  inSheet,
  inAssistantWindow,
  gone,
  opened,
  endConversation,
  goNow,
}: ConversationSheetOptions) {
  const wholeScreenSize = useWholeScreenHologramSize();
  const { width, height } = useWindowDimensions();
  const hologramSize = inSheet ? sampleHologramSize(width, height) : wholeScreenSize;
  const canvas = inSheet ? SAMPLE_CANVAS : WHOLE_SCREEN_CANVAS;
  const [settled, setSettled] = useState(!inSheet);

  // Leaving is when the sheet starts to move, so that is when nothing may be drawn any more. The
  // sheet says so again once it has come back up and stopped, because `gone` going false is what
  // moves it.
  useEffect(() => {
    if (gone && inSheet) {
      setSettled(false);
    }
  }, [gone, inSheet]);

  /**
   * The sheet is off the bottom of the screen: put the window away.
   *
   * The assistant's own window retracts. The app's own activity — opened by the plain assist
   * intent — has no such thing, and with its background see-through for the sheet it would be left
   * over the home screen as an invisible pane taking every touch, so it is closed instead.
   *
   * **Which of the two this is has to be known, not asked.** `dismissAssistantWindow` retracts
   * whichever assistant window is showing, and it used to be tried first from both. The activity
   * is often still alive behind the app the user is in, and when its conversation ended during a
   * summoning it took the assistant's window down with it: the greeting went on, and the sheet it
   * was meant to be in was gone. The same went for a conversation across the whole screen, which
   * used to retract the window the moment it was over — a leftover from when a summoned Jarvis
   * filled the screen, which he no longer does anywhere there is a window to retract.
   */
  const leaveTheSheet = useCallback(() => {
    if (inAssistantWindow) {
      dismissAssistantWindow();
    } else {
      BackHandler.exitApp();
    }
  }, [inAssistantWindow]);

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
