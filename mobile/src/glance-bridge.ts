import { GLANCE_ID_MAX_LENGTH, type GlanceActionResult, glanceOrigin } from 'hologram';

/**
 * The phone's half of the bridge between a glance's page and the app showing it.
 *
 * The server injects a script into every glance (`window.jarvis.act(actionId)`), which posts
 * `JSON.stringify({ type: 'jarvisAction', actionId })` to `window.ReactNativeWebView.postMessage` on
 * a phone and to `window.parent.postMessage` in a browser's `<iframe>`. The app answers with
 * `{ type: 'jarvisActionResult', actionId, ok, message }`: on a phone as a `jarvisactionresult`
 * event dispatched on the page's `window` by injected JavaScript, in a browser posted to the frame,
 * which the bridge dispatches as the same event.
 *
 * **Everything the page says is untrusted.** It was written by a model from email content, so it is
 * read as strictly as anything from the network: a message that is not exactly an action naming an
 * id is no message at all, and an id is only ever looked up in the glance's own list, never acted on
 * by itself (`glance-actions.ts`).
 */

/** What the page asked for: the id of one of its glance's actions, as it named it. */
export interface BridgeAction {
  readonly actionId: string;
}

/** What the page is told of an action it asked for. */
export interface BridgeResult extends GlanceActionResult {
  readonly type: 'jarvisActionResult';
  readonly actionId: string;
}

/** The event the bridge listens for on the page's `window`, as the server's script names it. */
export const BRIDGE_RESULT_EVENT = 'jarvisactionresult';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The JSON a string holds, or `undefined` for one that is not JSON. Anything else as it is. */
function parsedMessage(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/**
 * The action a message from the page asks for, or `undefined` for anything else: a message that is
 * not a `jarvisAction`, or one whose `actionId` is not text of a length an action's id can have.
 * Never throws, whatever the page posts.
 */
export function bridgeActionOf(data: unknown): BridgeAction | undefined {
  const message = parsedMessage(data);
  if (!isRecord(message) || message.type !== 'jarvisAction' || typeof message.actionId !== 'string') return undefined;
  const actionId = message.actionId.trim();
  return actionId.length > 0 && actionId.length <= GLANCE_ID_MAX_LENGTH ? { actionId } : undefined;
}

/** What the page is told of `actionId`. */
export function bridgeResult(actionId: string, result: GlanceActionResult): BridgeResult {
  return { type: 'jarvisActionResult', actionId, ok: result.ok, message: result.message };
}

/**
 * The JavaScript a phone's WebView runs in the page to tell it `result`: the event the bridge listens
 * for, dispatched on its `window`. Every value is written as JSON, so nothing in a message can close
 * the string it is in; and it ends in `true`, which is what `injectJavaScript` asks a script to end in.
 */
export function resultDeliveryScript(result: BridgeResult): string {
  const detail = JSON.stringify({ actionId: result.actionId, ok: result.ok, message: result.message });
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(BRIDGE_RESULT_EVENT)}, { detail: ${detail} })); true;`;
}

/**
 * What to do with a navigation the page starts, on a phone:
 *
 * - `load` it, in the glance, when it is on the glance's own origin — exactly, not merely starting
 *   with it, so `https://jarvis.example.com.evil.example` is not;
 * - `open-outside` — in the phone's browser — any other `https` (or this computer's `http`) page, so
 *   a link in a glance still goes where it says, outside the app;
 * - `block` everything else: `javascript:`, `file:`, `intent:`, a phone number, an app's deep link.
 *   A page the model wrote has no business opening another app.
 */
export type NavigationVerdict = 'load' | 'open-outside' | 'block';

export function navigationVerdict(url: string, glanceOriginOfPage: string): NavigationVerdict {
  const origin = glanceOrigin(url);
  if (origin === undefined) return 'block';
  return origin === glanceOriginOfPage ? 'load' : 'open-outside';
}
