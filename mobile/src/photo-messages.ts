/**
 * What the phone tells Jarvis about the camera: the words it puts into the conversation, and nothing
 * else.
 *
 * **Jarvis cannot see, and neither can the agent he speaks through.** What can is a model behind
 * `routePromptWorkflow` on sir's own Jarvis server, so a photo goes *there*, straight from the phone
 * (`photo-upload.ts`), and all the agent is ever given is the name the server filed it under. It then
 * asks about the photo by that name, the way it asks about anything else.
 *
 * **Two kinds of words, told apart by whether they take a turn.** A contextual update is background
 * the agent keeps: it neither starts a turn nor interrupts one, which is right for what only sets the
 * scene — that there is a camera button here, that sir has opened it, that he closed it again. A user
 * message takes a turn, as if sir had said it, which is right for what the agent has to act on now: a
 * photo that has arrived, or one that could not.
 *
 * **Every rule about what to do with them is the agent's prompt's** (`elevenlabs/src/assets/
 * agent-prompt.md`, "Photos"), stated once there rather than again in each message: the messages say
 * what happened, in plain words, and the prompt says what follows from it. So they are written the way
 * sir would say them, and the prompt quotes them — `photo-messages.contract.spec.ts` holds the two, and
 * the way the routing names a photo, together.
 *
 * Imports nothing, so the whole of the phone's side of that contract is a test with no SDK in it. The
 * hook that sends them is `use-photo-sending.ts`, and the flow they are sent in is `photo-sending.ts`.
 */

/**
 * What a phone that can send photos tells the agent once the conversation is up: that this device has
 * a camera button beside him.
 *
 * Only a phone that knows where the Jarvis server is says it, since only that one shows the button.
 * The same agent answers the watch, the headset, the house speakers and phone calls, none of which
 * has one, so the prompt counts photos as possible only where it has heard this — and sends sir to his
 * phone otherwise.
 */
export const CAMERA_BUTTON_HERE =
  "This device is sir's phone, and it has a camera button beside you: he can send you photos with it.";

/**
 * Sir has tapped the camera button, and is framing a shot.
 *
 * Nothing is asked of the agent yet but to wait: ElevenLabs asks it to speak again after a few
 * seconds of silence, and a finished request is ended then — so the prompt, having heard this, calls
 * `skip_turn` rather than `end_call` until the photo or a word from sir arrives.
 */
export const CAMERA_OPENED = 'Sir has opened the camera on his phone to send you a photo.';

/** He put the camera away without taking a photo, and the conversation carries on as it was. */
export const CAMERA_CLOSED = 'Sir closed the camera without sending a photo.';

/**
 * The photo is with the Jarvis server, filed as `photoId`.
 *
 * Said as sir, in the first person, because it is his turn: he has just sent it. The photo is named
 * exactly as the routing names one — "(photo photo3)" — so the agent can pass that on unchanged in
 * whatever it routes: what he asked for with it, or, if he asked for nothing, a look at what it shows,
 * after which he is asked what he would like done with it.
 */
export function photoSent(photoId: string): string {
  return `I've sent you a photo (photo ${photoId}).`;
}

/**
 * Why a photo did not reach Jarvis, as a short fixed phrase the phone chooses from what happened —
 * never anything a server said, which is not the agent's to read, or sir's to hear.
 */
export const PHOTO_PROBLEMS = {
  /** The conversation had no id the server could check, or the server found it not live on Jarvis's agent. */
  notLive: 'this conversation could not be confirmed as live',
  /** The server has no ElevenLabs key or agent to check a conversation with, so it opens no slots. */
  switchedOff: 'photo uploads are switched off on the Jarvis server',
  /** The server would not take a body that size. */
  tooLarge: 'it was larger than a photo can be',
  /**
   * Sir took or picked one, and the phone could not read it as a photo to send: a format the browser
   * cannot decode, or a file the camera app left that could not be read back. Not a camera closed
   * without one — he did send something, and is waiting to hear what became of it.
   */
  notReadable: 'it could not be read as a photo',
  /**
   * Anything else: no network, a server that did not answer in time, a tunnel in the way, an answer
   * that was not the server's.
   */
  unreachable: 'the Jarvis server could not be reached',
} as const;

/** One of {@link PHOTO_PROBLEMS}, by name. */
export type PhotoProblem = keyof typeof PHOTO_PROBLEMS;

/**
 * The photo sir took did not get to the Jarvis server, and why.
 *
 * A user message rather than a contextual update, because it has to be said: sir has pressed a button
 * and is waiting to hear about his photo, and a note the agent kept to itself would leave him waiting.
 */
export function photoNotSent(reason: string): string {
  return `The photo I took didn't reach you: ${reason}.`;
}
