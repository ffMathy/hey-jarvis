import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { BackHandler, Platform, useWindowDimensions } from 'react-native';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { useWholeScreenHologramSize } from './hologram-size';
import { SAMPLE_CANVAS, SampleSheet, sampleHologramSize } from './sample-sheet';

/** What he is drawn on across the whole screen: nothing, see-through, as it always was there. */
const WHOLE_SCREEN_CANVAS: { background?: string } = {};

interface ConversationSheetOptions {
  /** Whether the conversation is drawn in the bottom sheet at all. See `ConversationScreen`. */
  inSheet: boolean;
  /**
   * Whether this is the app drawn in the assistant's own window, rather than in its own activity.
   * Only that one may retract the window: see `leaveTheSheet`.
   */
  inAssistantWindow: boolean;
  /** Whether the sheet has carried him off the bottom of the screen, which is when the window goes too. */
  gone: boolean;
  /** Ends the conversation, the way the agent hanging up would. */
  endConversation: () => void;
  /** Starts the sheet down, with him on it, without waiting for the session to report its end. */
  leave: () => void;
  /** Marks him as gone, once the sheet is off the bottom of the screen. */
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
 * - **The square and the background are sample mode's**, so he sits inside the sheet and on its
 *   colour.
 * - **Nothing is drawn until the sheet has stopped moving** (`settled`), so his arrival is not
 *   spent sliding.
 * - **Tapping beside it, or back, hangs up.** The sheet then goes the way it does when the agent
 *   hangs up: straight down, with him on it.
 *
 * What brings it back up for the next summoning is not here: the screen answers a summoning
 * however it arrives, and the sheet simply follows `gone` going false. See `summonAgain` there.
 */
export function useConversationSheet({
  inSheet,
  inAssistantWindow,
  gone,
  endConversation,
  leave,
  goNow,
}: ConversationSheetOptions) {
  const wholeScreenSize = useWholeScreenHologramSize();
  const { width, height } = useWindowDimensions();
  const hologramSize = inSheet ? sampleHologramSize(width, height) : wholeScreenSize;
  const canvas = inSheet ? SAMPLE_CANVAS : WHOLE_SCREEN_CANVAS;
  const [settled, setSettled] = useState(!inSheet);

  // He rides the sheet down rather than vanishing before it moves, so the canvas is let go only once
  // the sheet is off the bottom of the screen. The sheet says it has settled again once it has come
  // back up and stopped, because a new summoning is what moves it.
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
    goNow();
    if (inAssistantWindow) {
      dismissAssistantWindow();
    } else {
      BackHandler.exitApp();
    }
  }, [inAssistantWindow, goNow]);

  /**
   * Tapping beside him or pressing back: the sheet goes at once, whether or not a conversation ever
   * opened. Waiting for the session to report its end first was a beat of nothing between the tap
   * and anything moving.
   */
  const hangUp = useCallback(() => {
    endConversation();
    leave();
  }, [endConversation, leave]);

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
 * **The sheet goes the moment the conversation does, with him still on it.** He used to fade first
 * and the sheet followed once he had: `LEAVING_SECONDS` of him shrinking, then an empty sheet
 * sliding away, which is most of a second of a finished assistant still on the screen. The user
 * asked for the sheet simply to go, so in the sheet he does not fade at all. It slides off the
 * bottom with him drawn on it, as sample mode's always has.
 */
export function ConversationFrame({
  inSheet,
  leaving,
  sheet,
  children,
}: {
  inSheet: boolean;
  /** Whether the sheet is on its way down: from the moment the conversation ends, or is hung up. */
  leaving: boolean;
  sheet: Pick<ReturnType<typeof useConversationSheet>, 'onSettled' | 'leaveTheSheet' | 'hangUp'>;
  children: ReactNode;
}) {
  if (!inSheet) {
    return children;
  }
  return (
    <SampleSheet leaving={leaving} onSettled={sheet.onSettled} onGone={sheet.leaveTheSheet} onTapBeside={sheet.hangUp}>
      {children}
    </SampleSheet>
  );
}
