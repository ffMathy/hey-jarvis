/**
 * What pressing back does on the conversation screen, as the listener to give `BackHandler`: `true`
 * when it handled back, `false` when the system is to go on and do what it always does.
 *
 * - **In the sheet**, nothing here: back is the sheet's, and hangs up (`conversation-sheet.tsx`).
 * - **Opened onto a glance**, back goes to the glance, and nothing further.
 * - **Opened from the launcher with no glance**, back hangs up, and still leaves the app as back
 *   always does. It used to only leave: Android puts an app's last activity behind the launcher
 *   rather than finishing it, so the screen — and the session it holds — stayed alive, and he went
 *   on listening and talking with nothing on screen. Hanging up lets a tool call in flight finish
 *   first, as every dismissal does (`hangUpAfterWork`), and does nothing when no conversation is
 *   open.
 */
export function backOnTheConversation({
  inSheet,
  onBackToGlance,
  hangUp,
}: {
  inSheet: boolean;
  onBackToGlance: (() => void) | undefined;
  hangUp: () => void;
}): (() => boolean) | undefined {
  if (inSheet) return undefined;
  if (onBackToGlance) {
    return () => {
      onBackToGlance();
      return true;
    };
  }
  return () => {
    hangUp();
    return false;
  };
}
