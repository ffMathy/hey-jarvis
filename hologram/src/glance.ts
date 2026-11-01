import { parseJarvisServerAddress } from './jarvis-server-address';

/**
 * A glance: the page the Jarvis server put together ahead of time from what it has lately seen —
 * an email saying a delivery is due today, say, and so a button to unlock the front door — for the
 * phone to show when sir opens it rather than summons Jarvis. The server pushes it to every device
 * over the line each one holds open (`jarvis-server-link.ts`), in a `glance` message, right after
 * `ready` when it has a current one and again whenever it makes a new one.
 *
 * **The page is not trusted; the message is.** The page's HTML was written by a model from email and
 * calendar content, so what its buttons say cannot be believed. What a button does is one of the
 * message's `actions`, held by the server, and the page only names it by id: a device asks sir to
 * confirm with the action's own `prompt` — the words the server will run — before it sends
 * `glanceAction` back. A page naming an id the message does not list is ignored.
 *
 * The message comes from a server this device does not control, over the network, so it is read as
 * strictly as an entity (`affected-entities.ts`): the declared shape only, every value trimmed and
 * within its limit, a page at an `https` address (or `http` on this very computer, as the server's
 * own address may be), and anything else dropped — an unusable action on its own, the glance without
 * it; an unusable glance whole.
 */

/** Something a glance's page can ask for, run by the server once sir has confirmed it. */
export interface GlanceAction {
  /** Opaque, as the page names it to `window.jarvis.act`: compared, never parsed. */
  readonly id: string;
  /** What the server calls it. For a log or a fallback; the page draws its own buttons. */
  readonly label: string;
  /** What the server will run if sir confirms: shown to him, word for word, before anything is sent. */
  readonly prompt: string;
}

/** One glance, as the server sent it. */
export interface Glance {
  /** Opaque, named back to the server with each action. */
  readonly id: string;
  /** The page itself: public, and loadable without any header. */
  readonly url: string;
  readonly title: string;
  /** When the server made it, as ISO 8601. */
  readonly generatedAt: string;
  readonly actions: readonly GlanceAction[];
}

/** What the server said of an action it was asked to run. */
export interface GlanceActionResult {
  readonly ok: boolean;
  /** In words, for sir: what was done, or why not. */
  readonly message: string;
}

/** The longest glance, action or request id that is taken. Longer than any the server makes. */
export const GLANCE_ID_MAX_LENGTH = 200;

/** The longest page address that is taken. */
export const GLANCE_URL_MAX_LENGTH = 2048;

/** The longest title that is taken: a heading, not a paragraph. */
export const GLANCE_TITLE_MAX_LENGTH = 200;

/** The longest `generatedAt` that is taken: ISO 8601 is never longer. */
const GENERATED_AT_MAX_LENGTH = 40;

/** The longest action label that is taken. */
export const GLANCE_ACTION_LABEL_MAX_LENGTH = 120;

/** The longest prompt that is taken: long enough to say what will be done, short enough to read in a dialog. */
export const GLANCE_ACTION_PROMPT_MAX_LENGTH = 2000;

/** The most actions one glance offers. */
export const GLANCE_ACTIONS_MAX = 12;

/** The longest result message that is taken: a line for sir, not a report. */
export const GLANCE_ACTION_RESULT_MESSAGE_MAX_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trimmed, and only if something is left that is no longer than `maxLength`. */
function usableText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 && text.length <= maxLength ? text : undefined;
}

/** A page address up to its path: the scheme and the authority, and nothing after them. */
const ORIGIN_OF_URL = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*)(?:[/?#].*)?$/s;

/**
 * The origin a page address is on — `https://host` or `https://host:port`, in lower case — or
 * `undefined` for an address that is not one a glance may be at: anything but `https`, `http` other
 * than on this very computer, or a user name in it. The same rules as the server's own address
 * (`parseJarvisServerAddress`), since a glance is a page that server serves.
 *
 * A regular expression rather than `URL`, for the reason `jarvis-server-address.ts` gives: React
 * Native's `URL` has none of the parts this reads.
 */
export function glanceOrigin(url: string): string | undefined {
  const origin = ORIGIN_OF_URL.exec(url)?.[1];
  if (origin === undefined || !/^https?:\/\//i.test(origin)) return undefined;
  const parsed = parseJarvisServerAddress(origin);
  return 'address' in parsed ? parsed.address : undefined;
}

/** Whether `generatedAt` is a moment: ISO 8601 as `Date.parse` reads it. */
function usableMoment(value: unknown): string | undefined {
  const moment = usableText(value, GENERATED_AT_MAX_LENGTH);
  return moment !== undefined && !Number.isNaN(Date.parse(moment)) ? moment : undefined;
}

/** One action, or `undefined` for one with anything unusable in it. */
export function glanceActionOf(listed: unknown): GlanceAction | undefined {
  if (!isRecord(listed)) return undefined;
  const id = usableText(listed.id, GLANCE_ID_MAX_LENGTH);
  const label = usableText(listed.label, GLANCE_ACTION_LABEL_MAX_LENGTH);
  const prompt = usableText(listed.prompt, GLANCE_ACTION_PROMPT_MAX_LENGTH);
  return id === undefined || label === undefined || prompt === undefined ? undefined : { id, label, prompt };
}

/**
 * A glance, `{ id, url, title, generatedAt, actions }` — the `glance` of a `glance` message, or one a
 * device kept — or `undefined` for one that is not usable: any of its four fields missing or out of
 * bounds, a page at an address no glance may be at ({@link glanceOrigin}), or `actions` not an array.
 * Unusable actions are left out, each id is kept once (the first), and no more than
 * {@link GLANCE_ACTIONS_MAX} of them. Never throws, whatever it is handed.
 */
export function glanceOf(value: unknown): Glance | undefined {
  if (!isRecord(value) || !Array.isArray(value.actions)) return undefined;
  const id = usableText(value.id, GLANCE_ID_MAX_LENGTH);
  const url = usableText(value.url, GLANCE_URL_MAX_LENGTH);
  const title = usableText(value.title, GLANCE_TITLE_MAX_LENGTH);
  const generatedAt = usableMoment(value.generatedAt);
  if (id === undefined || url === undefined || title === undefined || generatedAt === undefined) return undefined;
  if (glanceOrigin(url) === undefined) return undefined;

  const actions: GlanceAction[] = [];
  for (const listed of value.actions) {
    const action = glanceActionOf(listed);
    if (action === undefined || actions.some((kept) => kept.id === action.id)) continue;
    actions.push(action);
    if (actions.length === GLANCE_ACTIONS_MAX) break;
  }
  return { id, url, title, generatedAt, actions };
}

/** The action of `glance` a page named, or `undefined` for an id it does not list. */
export function glanceActionNamed(glance: Glance, actionId: string): GlanceAction | undefined {
  return glance.actions.find((action) => action.id === actionId);
}

/** A `glanceActionResult` message's answer, with the request it answers. */
export interface GlanceActionAnswer extends GlanceActionResult {
  readonly requestId: string;
}

/**
 * The answer in a `glanceActionResult` message, or `undefined` for one that is not usable: a request
 * id that is not one a device could have sent, `ok` not a boolean, or a message that is not text. A
 * message too long or empty is still an answer, said in the device's own words instead
 * ({@link UNREADABLE_RESULT_MESSAGE}), since the request it answers would otherwise wait for nothing.
 */
export function glanceActionAnswerOf(message: unknown): GlanceActionAnswer | undefined {
  if (!isRecord(message) || typeof message.ok !== 'boolean' || typeof message.message !== 'string') return undefined;
  const requestId = usableText(message.requestId, GLANCE_REQUEST_ID_MAX_LENGTH);
  if (requestId === undefined) return undefined;
  const said = usableText(message.message, GLANCE_ACTION_RESULT_MESSAGE_MAX_LENGTH);
  return { requestId, ok: message.ok, message: said ?? (message.ok ? DONE_RESULT_MESSAGE : UNREADABLE_RESULT_MESSAGE) };
}

/** The longest request id a device sends: the server takes no longer. */
export const GLANCE_REQUEST_ID_MAX_LENGTH = 64;

/** What a done action says when the server's own words could not be shown. */
export const DONE_RESULT_MESSAGE = 'Done.';

/** What a failed action says when the server's own words could not be shown. */
export const UNREADABLE_RESULT_MESSAGE = 'The Jarvis server could not do that.';

/** What an action asked for while the line is not connected comes back as, at once. */
export const NOT_CONNECTED_RESULT: GlanceActionResult = {
  ok: false,
  message: 'The Jarvis server is not connected, so nothing was done.',
};

/** What an action comes back as when the server has not answered within {@link GLANCE_ACTION_TIMEOUT_MS}. */
export const TIMED_OUT_RESULT: GlanceActionResult = {
  ok: false,
  message: 'The Jarvis server did not answer in time. It may still be doing it.',
};

/** What an action comes back as when the line dropped, or was closed, before the server answered. */
export const DROPPED_RESULT: GlanceActionResult = {
  ok: false,
  message: 'The line to the Jarvis server went before it answered. It may still have done it.',
};

/**
 * How long an action waits for the server's answer. Long, because the server runs the prompt through
 * Jarvis's agents — unlocking a door is a Home Assistant call behind a plan — but not for ever.
 */
export const GLANCE_ACTION_TIMEOUT_MS = 60_000;

/** The `glanceAction` frame asking the server to run `actionId` of the glance `glanceId`. */
export function glanceActionFrame(requestId: string, glanceId: string, actionId: string): string {
  return JSON.stringify({ type: 'glanceAction', requestId, glanceId, actionId });
}
