import type { JarvisConversation } from 'hologram/conversation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CAMERA_BUTTON_HERE } from './photo-messages';
import { seeThePhotoThrough } from './photo-sending';
import { openPhotoSlot, sendPhoto } from './photo-upload';
import { takePhoto } from './take-photo';

/** How often sir is said to be still there while the camera is open. See the heartbeat below. */
const STILL_HERE_EVERY_MS = 5_000;

/** As much of the screen's conversation (`useJarvisSession`) as the camera uses. */
export type CameraConversation = Pick<
  JarvisConversation,
  'status' | 'sendText' | 'sendContextualUpdate' | 'sendUserActivity' | 'liveConversationId'
>;

/**
 * Showing Jarvis a photo: the camera button beside him, and everything its tap sets going.
 *
 * **Only sir opens the camera.** The agent has no way to — no tool, nothing it can call — so the
 * button is the only way in, and the flow is a straight line (`photo-sending.ts`): the tap opens the
 * camera, asks sir's Jarvis server for somewhere to send a photo with the id of the conversation under
 * way, and tells the agent the camera is open; the photo goes to the server; and the agent is told
 * what it was filed as, as sir's turn, or why it did not arrive. What happens next — whether it is
 * looked at at once, or sir is asked what he wants done with it — is the agent's prompt's and the
 * routing's to decide, from whether he has said.
 *
 * **Only a phone that knows where the Jarvis server is offers it.** Without an address there is
 * nowhere to send a photo, so `canSendPhotos` keeps the button off the screen and the agent is told
 * nothing. With one, the phone tells the agent once per conversation that there is a camera button
 * here ({@link CAMERA_BUTTON_HERE}), so it can suggest it — and knows, where it has not heard that,
 * that photos cannot come from this device.
 *
 * **The address a photo goes to is the one this hook was given, as it is at the tap.** The session is
 * the conversation screen's and ends with it, so an address changed on the settings screen reaches
 * the next conversation, and one read again for a summoning (`app.tsx`) reaches the next tap.
 *
 * **Nothing here holds the call open while sir frames the shot; the agent does.** A finished request
 * is hung up on by the agent itself, after its `turnTimeout`, and the note that the camera is open is
 * what its prompt waits on instead: a nudge then gets `skip_turn` rather than `end_call`. The
 * heartbeat below sends `user_activity` in case it holds off ElevenLabs' own silence timeout — which
 * ElevenLabs does not document that it does — and it cannot run while JavaScript's timers are paused
 * behind the camera app.
 *
 * **A photo belongs to the conversation it was taken in.** Each conversation is numbered as it ends,
 * and a photo in flight carries the number of the one it was taken in: it is still sent once that
 * one has ended — the server keeps it as a photo nobody has looked at, and routing brings it up later
 * — but it is never told to the conversation after, and the button is not held busy for it there.
 *
 * Called after the screen's session (`useJarvisSession` in `hologram`), with its conversation: the
 * camera only speaks into the conversation, and hands the session nothing.
 */
export function usePhotoSending({
  inAssistantWindow,
  serverAddress,
  conversation: { status, sendText, sendContextualUpdate, sendUserActivity, liveConversationId },
}: {
  inAssistantWindow: boolean;
  /** The Jarvis server's origin, or `undefined` when sir has not given this phone one. See `jarvis-server.ts`. */
  serverAddress: string | undefined;
  /** The conversation the photo is for: its status, its id, and the ways the camera speaks into it. */
  conversation: CameraConversation;
}) {
  /** Which conversation a photo in flight belongs to: moved on every time one ends. */
  const conversationNumber = useRef(0);
  /** Whether a tap is being seen through, for a second tap in the same commit, which state cannot see. */
  const busyNow = useRef(false);
  /** The same, for the screen: the camera is open, or its photo is on its way. */
  const [busy, setBusy] = useState(false);

  const connected = status === 'connected';
  const canSendPhotos = serverAddress !== undefined;

  // A phone that can send photos says so once per conversation, so the agent knows the button is here.
  useEffect(() => {
    if (connected && canSendPhotos) {
      sendContextualUpdate(CAMERA_BUTTON_HERE);
    }
  }, [connected, canSendPhotos, sendContextualUpdate]);

  // Anything but `connected` is the end of the conversation a photo in flight was taken in.
  useEffect(() => {
    if (connected) {
      return;
    }
    conversationNumber.current += 1;
    busyNow.current = false;
    setBusy(false);
  }, [connected]);

  /**
   * Sir framing a shot, or his photo on its way, is sir still there.
   *
   * ElevenLabs ends a call a while after the user last spoke, whatever its agent is waiting on, and
   * someone pointing a camera says nothing. `user_activity` is what its client events offer for
   * activity that is not speech, though not documented as holding that off. The first is sent in the
   * tap itself (`photo-sending.ts`), and these follow it. JavaScript's timers stop while the app is
   * behind the camera, so this covers the browser and the moments either side of the camera app rather
   * than the whole of it.
   */
  useEffect(() => {
    if (!busy) {
      return;
    }
    const stillHere = setInterval(sendUserActivity, STILL_HERE_EVERY_MS);
    return () => clearInterval(stillHere);
  }, [busy, sendUserActivity]);

  /**
   * The camera button's tap. `takePhoto` is called before anything else, and before any `await`,
   * because in a browser a picker opened a moment too late is not opened at all.
   */
  const sendJarvisAPhoto = useCallback(() => {
    if (busyNow.current || serverAddress === undefined) {
      return;
    }
    const takenIn = conversationNumber.current;
    const stillInTheConversation = () => takenIn === conversationNumber.current;
    const photo = takePhoto({ inAssistantWindow, stillTalking: stillInTheConversation });

    busyNow.current = true;
    setBusy(true);
    void seeThePhotoThrough({
      photo,
      conversationId: liveConversationId(),
      server: {
        openSlot: (conversationId) => openPhotoSlot({ serverAddress, conversationId }),
        sendPhoto: (taken, uploadPath) => sendPhoto({ serverAddress, uploadPath, photo: taken }),
      },
      conversation: { sendText, sendContextualUpdate, sendUserActivity },
      stillInTheConversation,
    }).finally(() => {
      if (stillInTheConversation()) {
        busyNow.current = false;
        setBusy(false);
      }
    });
  }, [inAssistantWindow, serverAddress, liveConversationId, sendText, sendContextualUpdate, sendUserActivity]);

  return { canSendPhotos, cameraBusy: busy, sendJarvisAPhoto };
}
