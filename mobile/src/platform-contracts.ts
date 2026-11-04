/**
 * The shapes the platform-split modules have to keep.
 *
 * A few things in this app genuinely differ between a phone and a browser, and
 * each is a pair of files Metro picks between by platform: `key-value-store.ts`
 * against `key-value-store.web.ts`, `microphone-permission.ts` against
 * `microphone-permission.web.ts`, the voice the hologram listens to —
 * `jarvis-voice.ts`, with a `.web.ts` beside it — the camera, `take-photo.ts`
 * against `take-photo.web.ts`, the screen Jarvis was summoned over,
 * `summoning-screenshot.ts` against `summoning-screenshot.web.ts`, and a glance's
 * page — `glance-view.tsx`, a WebView, against `glance-view.web.tsx`, an `<iframe>`
 * — with the question asked before one of its actions runs,
 * `confirm-glance-action.ts` against `confirm-glance-action.web.ts` — and pairing with the Jarvis
 * server, `pair-with-server.ts` against `pair-with-server.web.ts`.
 *
 * The contracts live here rather than in either implementation so that neither
 * half can drift: nothing else in the app would notice if the web one grew an
 * argument the native one does not take, because nothing else imports both.
 */

/**
 * The voice contract itself lives in the `hologram` package, because the sphere is what reads
 * it and the sphere is shared with the watch. Re-exported here so the rest of the app carries on
 * asking this file what a voice looks like.
 */
import type { FollowAgentVoice, JarvisVoice, Pairing } from 'hologram';
import type { Ref } from 'react';

export type { JarvisVoice };

export type ReadStoredValue = (key: string) => Promise<string | undefined>;

export type WriteStoredValue = (key: string, value: string) => Promise<void>;

/**
 * A microphone that was given, and may still be held open by the asking.
 *
 * A browser holds it, because a page using the microphone may play sound without
 * a click and the recorded greeting starts before the session opens a stream of
 * its own. `release` lets go of it once the greeting has started; see
 * `microphone-permission.web.ts`. On a phone there is nothing to let go of.
 */
export interface MicrophoneAccess {
  release: () => void;
}

/**
 * Asks for the microphone up front, and says whether it was given: `undefined`
 * if it was not.
 *
 * Up front because WebRTC would otherwise ask in the middle of connecting, and a
 * refusal then surfaces as a failed connection rather than as the permission
 * question it actually was.
 */
export type RequestMicrophoneAccess = () => Promise<MicrophoneAccess | undefined>;

/**
 * How this platform listens to Jarvis's track in the conversation's LiveKit room, for the session's
 * `followAgentVoice`: natively on Android, through Web Audio in a browser.
 */
export type FollowJarvisVoice = FollowAgentVoice;

/**
 * The voice the sphere follows in a conversation, given the session's. Both platforms hand the
 * session's straight back; it is a hook of its own so the emulator check can swap in a recording.
 */
export type UseJarvisVoice = (sessionVoice: JarvisVoice) => JarvisVoice;

/**
 * Moves the conversation onto a headset, if one is connected, for as long as `inCall` is true.
 *
 * Both halves of it: on Android the call's output and its *input* are one route, so sending the
 * audio to a pair of AirPods is also what makes Jarvis listen through their microphone rather than
 * through the phone's. Which is the whole point — a phone in your pocket hears your pocket.
 */
export type UsePreferredHeadset = (inCall: boolean) => void;

/**
 * What the camera came back with, told three ways because each is told to Jarvis differently:
 *
 * - `photo`: the photo, as a JPEG ready to send.
 * - `closed`: none was taken — sir went back without one, or there was no camera to take it with.
 * - `notReadable`: sir took or picked one, and it could not be read as a photo — a file the browser
 *   cannot decode, or a photo the camera app left that could not be made ready or read back. Not
 *   `closed`, because he did send something, and is waiting to hear what became of it.
 */
export type CameraAnswer = { photo: Blob } | { closed: true } | { notReadable: true };

/**
 * Takes one photo for Jarvis, and resolves with what the camera came back with ({@link CameraAnswer}).
 *
 * On a phone it is the phone's own camera app, reached from wherever the conversation is drawn:
 * `inAssistantWindow` says whether that is the assistant's window, which has to make way for it.
 * In a browser it is the file picker, which a phone's browser opens on its camera.
 *
 * **Call it straight from a tap, before anything is awaited.** A browser opens its picker only
 * inside the gesture that asked for it, so a call that comes after an `await` in the press handler
 * is refused without a word. A phone does not mind either way.
 */
export type TakePhoto = (options: {
  inAssistantWindow: boolean;
  /**
   * Whether the conversation is still open, asked once the camera has closed: the assistant's window
   * was put away for it and comes back only to a conversation that is.
   */
  stillTalking: () => boolean;
}) => Promise<CameraAnswer>;

/**
 * What was on sir's screen when he summoned Jarvis, as a JPEG ready to send — or `undefined` when there
 * is none to send.
 *
 * Only a phone summoned by its assistant gesture has one: the system hands the assistant's window a
 * screenshot of the screen it came up over. A browser is never summoned over anything.
 */
export type ReadSummoningScreenshot = () => Promise<Blob | undefined>;

/**
 * Asks sir, natively, whether to run a glance's action, showing the prompt the server will run — and
 * resolves with whether he said yes. An Android dialog on a phone, `window.confirm` in a browser:
 * never anything the glance's own page draws, since the page cannot be trusted to say what a button
 * does (`glance-actions.ts`).
 */
export type ConfirmGlanceAction = (confirmation: { title: string; prompt: string }) => Promise<boolean>;

/** How the screen speaks to the glance's page once it is showing. */
export interface GlanceViewHandle {
  /** Tells the page how an action it asked for went (`BridgeResult` in `glance-bridge.ts`). */
  deliverResult: (result: { type: 'jarvisActionResult'; actionId: string; ok: boolean; message: string }) => void;
}

/**
 * A glance's page, filling what it is put in: a WebView on a phone, an `<iframe>` in a browser.
 *
 * Only `origin` is loaded in it; on a phone anything else the page navigates to opens in the
 * browser, or not at all (`navigationVerdict` in `glance-bridge.ts`). Each `jarvisAction` the page
 * posts, from `origin` alone, reaches `onAction` as the id it named, read by `bridgeActionOf` and
 * looked up by nothing yet.
 */
export interface GlanceViewProps {
  url: string;
  origin: string;
  title: string;
  onAction: (actionId: string) => void;
  ref?: Ref<GlanceViewHandle>;
}

/**
 * Where pairing with the Jarvis server got to, told three ways because each is shown differently:
 *
 * - `paired`: the server paired this device there and then, and here is its token — a browser,
 *   which sends the request itself with Access's cookie.
 * - `inTheBrowser`: the server's pairing page is open in the phone's browser, and the token will
 *   arrive later on the link the page opens the app with — the phone app, which holds no cookie.
 * - `problem`: it could not start, and why; with the server to sign in to, when it did not answer.
 */
export type PairingOutcome = { paired: Pairing } | { inTheBrowser: true } | { problem: string; signIn?: string };

/**
 * Pairs this device with the Jarvis server at what was typed ({@link PairingOutcome}).
 * `rememberAddress` is told the address before the browser is opened, since the token comes back
 * on a link that names no server.
 */
export type PairWithServer = (
  typedAddress: string,
  rememberAddress: (address: string) => void,
) => Promise<PairingOutcome>;
