import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import { OPEN_CAMERA_TOOL } from 'hologram';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CAMERA_ON_THIS_DEVICE,
  NO_PHOTO_UPLOAD_KEY,
  PHOTO_KEY_REFUSED,
  PHOTO_NOT_SENT,
  photoShown,
  REPLACED_BY_A_LATER_CALL,
  readOfferedUploadUrl,
  SHOWING_YOU_SOMETHING,
} from './camera-answers';
import { afterPhotoEvent, NOTHING_REQUESTED, nextLook, type PhotoEvent, type PhotoStep } from './photo-request';
import { sendPhoto } from './photo-upload';
import { CAMERA_OPENS_WITHOUT_A_TAP, takePhoto } from './take-photo';

/** How often sir is said to be still there while the camera is open. See the heartbeat below. */
const STILL_HERE_EVERY_MS = 5_000;

/**
 * Showing Jarvis something: the agent's `openCamera` client tool, answered here, and the camera
 * button beside him that does the same from sir's side.
 *
 * **Jarvis asks, or sir offers, and either way it is one photo to one call.** Before the agent calls,
 * it has Mastra mint an upload URL, and the answer reaches this device as an MCP tool event — which
 * is the only place the URL is taken from, never from the model (see `camera-answers.ts` for why). Sir's tap opens the camera at once and asks Jarvis to do all that in the same
 * breath (`SHOWING_YOU_SOMETHING`). The photo is sent when a call and a photo are both in hand,
 * whichever came second — `photo-request.ts` decides, and says why — and the call is answered with
 * the id Mastra filed it under, or with what happened instead. The agent then asks about it through
 * `routePromptWorkflow`, where a model that can see is.
 *
 * **Nothing here throws at the SDK.** A client tool that throws is reported through `onError`, which
 * on a phone is a failed conversation in red and a toast — so a camera closed empty-handed, a URL
 * that is not an upload URL and a photo that could not be sent are all *answers*.
 *
 * **Only this device's camera is offered.** Once connected, it tells the agent it has one
 * (`CAMERA_ON_THIS_DEVICE`); the agent's prompt asks for photos only where it has heard that, so the
 * watch, the house speakers and phone calls are never asked.
 *
 * **And only with the photo upload key.** Mastra refuses a photo without it (`photo-upload-key.ts`
 * says why it asks), so a phone that has not been given one offers no camera at all: it tells the
 * agent nothing, `canSendPhotos` keeps the button off the screen, and a call that comes anyway is
 * answered at once with where to add the key (`NO_PHOTO_UPLOAD_KEY`) rather than opening a camera
 * for a photo that could only be turned away. A key the server refuses is answered apart from any
 * other failure (`PHOTO_KEY_REFUSED`), because it is the one sir can fix and retrying cannot.
 *
 * **The key a conversation uses is the one this hook was given, as it is now.** The session keeps
 * the tool and the MCP handler of the screen that started it, even after that screen has gone, so a
 * key changed on the settings screen ends the conversation there and the next is built with the new
 * one (`settings-screen.tsx`). The one change that reaches a conversation still running here is a
 * summoning reading the key again (`app.tsx`), and the tool and `send` read it through a ref for that.
 *
 * **Nothing here holds the call open while sir frames the shot; the agent does.** A finished
 * request is hung up on by the agent itself, after its `turnTimeout`, and while the camera is open
 * its `openCamera` call is still waiting — which the prompt counts as the conversation waiting on
 * him, so a nudge then gets `skip_turn` rather than `end_call`. `cameraBusy` is only for the button,
 * which fades while the camera is open or its photo is on the way. `cameraWanted` is a browser's:
 * the agent has asked, the camera cannot open without a tap there, and the button says so.
 *
 * The session options go to `startSession` beside the other hooks' — `clientTools` as they are,
 * since this is the only client tool the agent has, and `onMCPToolCall` combined with the sphere's,
 * never spread, or one replaces the other. Both are built once per session and read everything live
 * through refs, the key included.
 */
export function useCameraTool({
  inAssistantWindow,
  photoUploadKey,
}: {
  inAssistantWindow: boolean;
  /** The key Mastra asks for before it takes a photo, or `undefined` when sir has not given one. */
  photoUploadKey: string | undefined;
}) {
  const { status } = useConversationStatus();
  const { sendUserMessage, sendContextualUpdate, sendUserActivity } = useConversationControls();

  // Refs rather than state: the tool is handed to the session once, and has to find these without
  // a render. What the screen draws from is mirrored into state below.
  const request = useRef(NOTHING_REQUESTED);
  /** Answers the agent's waiting call. Only ever one: a later call answers the earlier first. */
  const answerTheCall = useRef<((answer: string) => void) | undefined>(undefined);
  /** A photo sir took before the call asking for it had arrived. */
  const heldPhoto = useRef<Blob | undefined>(undefined);
  /** Which conversation a photo in flight belongs to, so one that lands after the end is dropped. */
  const conversation = useRef(0);
  /**
   * The key as it is now, for a tool handed to the session before it may have changed — which it
   * does under a live conversation when a summoning finds this one still open and reads the key
   * again, perhaps changed in the app's other window. See the note above.
   */
  const latestPhotoUploadKey = useRef(photoUploadKey);
  useEffect(() => {
    latestPhotoUploadKey.current = photoUploadKey;
  }, [photoUploadKey]);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [wanted, setWanted] = useState(false);
  /** When the request next needs the clock looked at, if it does. See `nextLook`. */
  const [lookAt, setLookAt] = useState<number | undefined>(undefined);

  const answer = useCallback((told: string) => {
    const waiting = answerTheCall.current;
    answerTheCall.current = undefined;
    waiting?.(told);
  }, []);

  /** Sends a photo to the waiting call's URL, and answers the call with what became of it. */
  const send = useCallback(
    (uploadUrl: string) => {
      const photo = heldPhoto.current;
      heldPhoto.current = undefined;
      if (!photo) {
        answer(PHOTO_NOT_SENT);
        return;
      }
      const photoUploadKeyNow = latestPhotoUploadKey.current;
      if (!photoUploadKeyNow) {
        // Only if the key was taken away while a call waited on the camera — cleared in the other
        // window, and read again for a summoning — since a call without one is answered before it
        // can wait. The photo would only be refused, so it is not sent.
        answer(NO_PHOTO_UPLOAD_KEY);
        return;
      }

      const sentIn = conversation.current;
      setSending(true);
      void sendPhoto({ photo, uploadUrl, photoUploadKey: photoUploadKeyNow }).then((delivery) => {
        if (sentIn !== conversation.current) {
          return;
        }
        setSending(false);
        if ('photoId' in delivery) {
          answer(photoShown(delivery.photoId));
          return;
        }
        // The problem is words chosen in `photo-upload.ts`, never the response or the key.
        console.warn(`The photo for Jarvis was not sent: ${delivery.problem}`);
        answer(delivery.keyRefused ? PHOTO_KEY_REFUSED : PHOTO_NOT_SENT);
      });
    },
    [answer],
  );

  // `follow` and `openTheCamera` need each other — the agent asking opens the camera, and the
  // camera closing may answer the agent — so one reaches the other through a ref.
  const openTheCameraRef = useRef<() => void>(() => undefined);

  /** Does what the request said to, after an event. */
  const follow = useCallback(
    (step: PhotoStep) => {
      switch (step.type) {
        case 'wait':
          return;
        case 'openCamera':
          openTheCameraRef.current();
          return;
        case 'askForATap':
          setWanted(true);
          return;
        case 'send':
          setWanted(false);
          send(step.uploadUrl);
          return;
        case 'answer':
          setWanted(false);
          answer(step.answer);
          return;
        case 'forget':
          // The call cannot be answered any more — its conversation has gone — so it is let go of
          // rather than answered into a closed connection.
          answerTheCall.current = undefined;
          heldPhoto.current = undefined;
          setWanted(false);
          setCameraOpen(false);
          setSending(false);
          return;
      }
    },
    [answer, send],
  );

  const happen = useCallback(
    (event: PhotoEvent) => {
      const { request: next, step } = afterPhotoEvent(request.current, event, {
        opensWithoutATap: CAMERA_OPENS_WITHOUT_A_TAP,
      });
      request.current = next;
      setLookAt(nextLook(next));
      follow(step);
    },
    [follow],
  );

  /**
   * Opens the camera, whoever asked. `takePhoto` is called before anything else, and before any
   * `await`, because in a browser a picker opened a moment too late is not opened at all.
   */
  const openTheCamera = useCallback(() => {
    if (request.current.cameraOpen) {
      return;
    }
    const takenIn = conversation.current;
    const photo = takePhoto({ inAssistantWindow, stillTalking: () => takenIn === conversation.current });
    setWanted(false);
    setCameraOpen(true);
    happen({ type: 'cameraOpened' });

    void photo.then((taken) => {
      if (takenIn !== conversation.current) {
        return;
      }
      setCameraOpen(false);
      if (taken) {
        heldPhoto.current = taken;
        happen({ type: 'photoTaken', at: Date.now() });
      } else {
        happen({ type: 'noPhotoTaken', at: Date.now() });
      }
    });
  }, [inAssistantWindow, happen]);
  useEffect(() => {
    openTheCameraRef.current = openTheCamera;
  }, [openTheCamera]);

  /**
   * The camera button: opens the camera, and — unless Jarvis is already waiting for this photo —
   * tells him sir is showing him something, which is what gets him the URL to send it to.
   */
  const showJarvisSomething = useCallback(() => {
    const nobodyAsked = request.current.askedAt === undefined;
    openTheCamera();
    if (!nobodyAsked) {
      return;
    }
    try {
      sendUserMessage(SHOWING_YOU_SOMETHING);
    } catch {
      // The conversation went between the tap and this; the session ending lets go of the photo.
    }
  }, [openTheCamera, sendUserMessage]);

  const connected = status === 'connected';
  /** Whether there is a photo this phone could send that Mastra would take. */
  const canSendPhotos = photoUploadKey !== undefined;

  // A device with a camera, and the key to send its photos with, says so once per conversation, so
  // the agent knows it may ask. One without the key says nothing, and is not asked.
  useEffect(() => {
    if (!connected || !canSendPhotos) {
      return;
    }
    try {
      sendContextualUpdate(CAMERA_ON_THIS_DEVICE);
    } catch {
      // Gone between the status and this; the next conversation says it again.
    }
  }, [connected, canSendPhotos, sendContextualUpdate]);

  // Anything but `connected` ends whatever was under way — a photo is only ever for the
  // conversation that asked for it.
  useEffect(() => {
    if (connected) {
      return;
    }
    conversation.current += 1;
    happen({ type: 'sessionOver' });
  }, [connected, happen]);

  // A URL or a tap that has not come in time is given up on, and the agent told, before it stops waiting.
  useEffect(() => {
    if (lookAt === undefined) {
      return;
    }
    const looking = setTimeout(() => happen({ type: 'tick', at: Date.now() }), Math.max(0, lookAt - Date.now()));
    return () => clearTimeout(looking);
  }, [lookAt, happen]);

  /**
   * Sir framing a shot, or about to tap for one, is sir still there.
   *
   * ElevenLabs ends a call a while after the user last spoke, whatever its agent is waiting on, and
   * someone pointing a camera says nothing. `user_activity` is what its client events offer for
   * exactly this — activity that is not speech. Sent while the camera is open or wanted; JavaScript's
   * timers stop while the app is behind the camera, so this covers the browser and the moments either
   * side of the camera app rather than the whole of it.
   */
  const busy = cameraOpen || sending;
  useEffect(() => {
    if (!busy && !wanted) {
      return;
    }
    const stillHere = setInterval(() => {
      try {
        sendUserActivity();
      } catch {
        // The conversation went; the session ending lets go of the rest.
      }
    }, STILL_HERE_EVERY_MS);
    return () => clearInterval(stillHere);
  }, [busy, wanted, sendUserActivity]);

  const cameraSessionOptions = useMemo(
    () => ({
      clientTools: {
        // Whatever the model put in the parameters is ignored: where the photo goes is Mastra's to say.
        [OPEN_CAMERA_TOOL]: () => {
          // Without the key there is no photo Mastra would take, so the camera is not opened for one.
          if (!latestPhotoUploadKey.current) {
            return Promise.resolve(NO_PHOTO_UPLOAD_KEY);
          }
          return new Promise<string>((resolve) => {
            answer(REPLACED_BY_A_LATER_CALL);
            answerTheCall.current = resolve;
            happen({ type: 'asked', at: Date.now() });
          });
        },
      },
      // Every MCP call the agent makes is relayed here; the one that mints an upload URL is kept.
      onMCPToolCall: (mcpToolCall: unknown) => {
        const uploadUrl = readOfferedUploadUrl(mcpToolCall);
        if (uploadUrl) {
          happen({ type: 'offered', uploadUrl, at: Date.now() });
        }
      },
    }),
    [answer, happen],
  );

  return {
    cameraSessionOptions,
    cameraBusy: busy,
    cameraWanted: wanted,
    canSendPhotos,
    showJarvisSomething,
  };
}
