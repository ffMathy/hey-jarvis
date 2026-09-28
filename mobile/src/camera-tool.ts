import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import {
  CAMERA_ON_THIS_DEVICE,
  OPEN_CAMERA_TOOL,
  PHOTO_NOT_SENT,
  photoShown,
  REPLACED_BY_A_LATER_CALL,
  readOfferedUploadUrl,
  SHOWING_YOU_SOMETHING,
} from 'hologram';
import type { ClientTools } from 'hologram/conversation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  afterPhotoEvent,
  NOTHING_REQUESTED,
  type PhotoEvent,
  type PhotoStep,
  WAIT_FOR_A_TAP_MS,
} from './photo-request';
import { sendPhoto } from './photo-upload';
import { CAMERA_OPENS_WITHOUT_A_TAP, takePhoto } from './take-photo';

/**
 * Showing Jarvis something: the agent's `openCamera` client tool, answered here, and the camera
 * button beside him that does the same from sir's side.
 *
 * **Jarvis asks, or sir offers, and either way it is one photo to one call.** Before the agent calls,
 * it has Mastra mint an upload URL, and the answer reaches this device as an MCP tool event — which
 * is the only place the URL is taken from, never from the model (see `camera-request.ts` in
 * `hologram` for why). Sir's tap opens the camera at once and asks Jarvis to do all that in the same
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
 * `cameraBusy` and `sirAnswered` are for the quiet hang-up. The camera open, or its photo still on
 * the way, is not the room going quiet, so it holds the clock. And sir opening the camera, and his
 * photo arriving, both answer whatever finished request was waiting on quiet: the photo hands Jarvis
 * a new question to ask of it, and an old request still armed would hang up while he asks it.
 * `cameraWanted` is a browser's: the agent has asked, the camera cannot open without a tap there,
 * and the button says so.
 *
 * The session options go to `startSession` beside the other hooks' — their `clientTools` merged with
 * `mergeClientTools` and `onMCPToolCall` with `inTurn`, never spread, or one hook's replaces the
 * other's. Both are built once per session and read everything live through refs.
 */
export function useCameraTool({ inAssistantWindow }: { inAssistantWindow: boolean }) {
  const { status } = useConversationStatus();
  const { sendUserMessage, sendContextualUpdate } = useConversationControls();

  // Refs rather than state: the tool is handed to the session once, and has to find these without
  // a render. What the screen draws from is mirrored into state below.
  const request = useRef(NOTHING_REQUESTED);
  /** Answers the agent's waiting call. Only ever one: a later call answers the earlier first. */
  const answerTheCall = useRef<((answer: string) => void) | undefined>(undefined);
  /** A photo sir took before the call asking for it had arrived. */
  const heldPhoto = useRef<Blob | undefined>(undefined);
  /** Which conversation a photo in flight belongs to, so one that lands after the end is dropped. */
  const conversation = useRef(0);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [wanted, setWanted] = useState(false);
  /** Counts sir opening the camera and his photo arriving: each is him answering. See the return. */
  const [sirAnswered, setSirAnswered] = useState(0);

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

      const sentIn = conversation.current;
      setSending(true);
      void sendPhoto({ photo, uploadUrl }).then((delivery) => {
        if (sentIn !== conversation.current) {
          return;
        }
        setSending(false);
        setSirAnswered((times) => times + 1);
        if ('photoId' in delivery) {
          answer(photoShown(delivery.photoId));
          return;
        }
        console.warn(`The photo for Jarvis was not sent: ${delivery.problem}`);
        answer(PHOTO_NOT_SENT);
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
    setSirAnswered((times) => times + 1);
    happen({ type: 'cameraOpened' });

    void photo.then((taken) => {
      if (takenIn !== conversation.current) {
        return;
      }
      setCameraOpen(false);
      if (taken) {
        heldPhoto.current = taken;
        happen({ type: 'photoTaken' });
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
    const nobodyAsked = request.current.uploadUrl === undefined;
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

  // A device with a camera says so, once per conversation, so the agent knows it may ask.
  useEffect(() => {
    if (!connected) {
      return;
    }
    try {
      sendContextualUpdate(CAMERA_ON_THIS_DEVICE);
    } catch {
      // Gone between the status and this; the next conversation says it again.
    }
  }, [connected, sendContextualUpdate]);

  // Anything but `connected` ends whatever was under way — a photo is only ever for the
  // conversation that asked for it.
  useEffect(() => {
    if (connected) {
      return;
    }
    conversation.current += 1;
    happen({ type: 'sessionOver' });
  }, [connected, happen]);

  // Where the camera waits on a tap, the agent is told no photo is coming before it stops waiting.
  useEffect(() => {
    if (!wanted) {
      return;
    }
    const givingUp = setTimeout(() => happen({ type: 'tick', at: Date.now() }), WAIT_FOR_A_TAP_MS);
    return () => clearTimeout(givingUp);
  }, [wanted, happen]);

  const cameraSessionOptions = useMemo(
    () => ({
      clientTools: {
        // Whatever the model put in the parameters is ignored: where the photo goes is Mastra's to say.
        [OPEN_CAMERA_TOOL]: () =>
          new Promise<string>((resolve) => {
            answer(REPLACED_BY_A_LATER_CALL);
            answerTheCall.current = resolve;
            happen({ type: 'asked', at: Date.now() });
          }),
      } satisfies ClientTools,
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
    cameraBusy: cameraOpen || sending,
    cameraWanted: wanted,
    sirAnswered,
    showJarvisSomething,
  };
}
