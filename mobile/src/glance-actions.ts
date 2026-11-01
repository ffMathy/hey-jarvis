import { type Glance, type GlanceAction, type GlanceActionResult, glanceActionNamed } from 'hologram';
import { type BridgeResult, bridgeResult } from './glance-bridge';

/**
 * One press of a button on a glance's page, from the page naming an action to the page — and sir —
 * hearing how it went.
 *
 * **Sir confirms what the server will run, not what the button said.** The page was written by a
 * model from email content, so its label is no promise: a button reading "Track parcel" could name
 * the action that unlocks the front door. So the action is looked up in the glance the server sent,
 * and sir is asked, natively, with that action's own `prompt` — the words the server holds and will
 * run — before anything is sent. An id the glance does not list is ignored: nothing is asked, sent or
 * answered.
 */

/** What answers sir is cancelled, said to the page. */
export const CANCELLED_RESULT: GlanceActionResult = { ok: false, message: 'Cancelled' };

/** The question sir is asked before an action is run: its title, and the prompt the server will run. */
export interface ActionConfirmation {
  readonly title: string;
  readonly prompt: string;
}

/** What asking sir to confirm the action needs to say. */
export function confirmationOf(action: GlanceAction): ActionConfirmation {
  return { title: 'Ask Jarvis to do this?', prompt: action.prompt };
}

/** What one press needs from outside itself, so a spec can hand it fakes. */
export interface GlanceActionRun {
  glance: Glance;
  actionId: string;
  /** Asks sir, natively, and resolves with whether he said yes. */
  confirm: (confirmation: ActionConfirmation) => Promise<boolean>;
  /** Sends the action to the server and resolves with its answer (`ServerLink.requestGlanceAction`). */
  request: (glanceId: string, actionId: string) => Promise<GlanceActionResult>;
  /** Tells the page. */
  deliver: (result: BridgeResult) => void;
  /** Tells sir, natively, once the server has answered. Not for a cancel: he knows. */
  report: (result: GlanceActionResult) => void;
}

/**
 * Runs one press: looks the action up, asks sir, sends it on a yes, and tells the page — and sir —
 * what came of it; on a no, tells the page it was cancelled. Resolves once it has, and with whether
 * anything was asked at all (`false` for an id the glance does not list). Never rejects: a request
 * that throws is told as one that failed.
 */
export async function runGlanceAction({
  glance,
  actionId,
  confirm,
  request,
  deliver,
  report,
}: GlanceActionRun): Promise<boolean> {
  const action = glanceActionNamed(glance, actionId);
  if (action === undefined) return false;

  if (!(await confirm(confirmationOf(action)))) {
    deliver(bridgeResult(action.id, CANCELLED_RESULT));
    return true;
  }

  const result = await request(glance.id, action.id).catch(
    (error: unknown): GlanceActionResult => ({
      ok: false,
      message: error instanceof Error ? error.message : 'The Jarvis server could not be asked.',
    }),
  );
  deliver(bridgeResult(action.id, result));
  report(result);
  return true;
}
