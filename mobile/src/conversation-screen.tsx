import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import {
  type ElevenLabsSettings,
  PHONE_PARTICIPANT_NAME,
  requestConversationToken,
  requestSignedConversationUrl,
} from 'hologram';
import { inTurn, useGreeting, useHangUpWhenQuiet, useToolActivity, useUserVoice } from 'hologram/conversation';
import { LEAVING_SECONDS } from 'hologram/react/lifecycle';
import { useSimulatedVoice } from 'hologram/react/sample';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { createAssistLaunchClaim } from './assist-link';
import { afterStatus, isLive, NOT_YET_OPEN } from './conversation-life';
import { ConversationFrame, useConversationSheet } from './conversation-sheet';
import { JarvisHologram } from './jarvis-hologram';
import { useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import type { MicrophoneAccess } from './platform-contracts';
import { usePreferredHeadset } from './preferred-microphone';
import { useQueuedAudio } from './queued-audio';
import { useSparkDensity } from './spark-density';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
import { useTextMode } from './text-mode';
import { theme } from './theme';
import { TypedMessageField } from './typed-message-field';
import { afterMessage, SAYING_NOTHING } from './written-reply';
import { WrittenReplyLine } from './written-reply-line';

interface ConversationScreenProps {
  settings: ElevenLabsSettings;
  onEditSettings: () => void;
  /**
   * Summoned by the assistant gesture on a phone: drawn in the bottom sheet sample mode uses, over
   * whatever the user was doing, rather than across the whole screen. Opened from the launcher
   * there is nothing underneath to keep, and he still fills it. See `conversation-sheet.tsx`.
   */
  inSheet?: boolean;
  /** Drawn in the assistant's own window rather than the app's activity. See `App`. */
  inAssistantWindow?: boolean;
  /** Which showing of the assistant's window this is; changes on every summoning. See `App`. */
  showing?: number;
}

/** Summonings already acted on in this process. */
const claimAssistLaunch = createAssistLaunchClaim();

/** Where the screen has to be bare, and where it does not. See the note on the component. */
const ON_A_PHONE = Platform.OS !== 'web';

/** What the screen is to a screen reader: on a phone a tap switches modes, and a hold opens settings. */
const SCREEN_LABEL = ON_A_PHONE
  ? 'Jarvis. Tap to switch between talking and writing. Press and hold for ElevenLabs settings.'
  : 'Jarvis. Press and hold for ElevenLabs settings.';

/**
 * How long the screen waits for a conversation to open before saying it has not.
 *
 * **Nothing below this screen has a deadline.** The ElevenLabs SDK reports `connecting`, then
 * either `connected` or an error — except when it reports neither, which is what a session that
 * cannot finish coming up does: it waits on a room event that never arrives, with no timeout of
 * its own, for ever. A screen whose only signal is the SDK eventually saying something therefore
 * has a state in which it says nothing at all, which is precisely how this looked with the
 * microphone switched off: "Connecting…" and no more, indefinitely.
 *
 * So the wait is bounded here. Twenty seconds is far longer than a session takes — a token, a
 * socket and a handshake are a second or two on a bad connection — and long enough that a slow
 * network is never mistaken for a failure.
 */
const GIVE_UP_CONNECTING_AFTER_MS = 20_000;

/**
 * What tapping the screen does: on a phone, once there is a conversation that has not ended, it
 * switches between talking and writing (see `text-mode.ts`). Anywhere else, nothing.
 */
function tapToSwitchModes({
  canType,
  ended,
  toggleTextMode,
}: {
  canType: boolean;
  ended: boolean;
  toggleTextMode: () => void;
}): (() => void) | undefined {
  return ON_A_PHONE && canType && !ended ? toggleTextMode : undefined;
}

/**
 * Whether the field to type into is on screen: wherever a conversation was opened and he has not
 * gone — always in a browser, and on a phone only while it is held in writing.
 */
function showsTypedField({ canType, gone, textMode }: { canType: boolean; gone: boolean; textMode: boolean }) {
  return canType && !gone && (!ON_A_PHONE || textMode);
}

/**
 * Starts the greeting while the microphone is still held, and lets go of it once the greeting has
 * started or been refused. Holding it is what lets a browser tab nobody has clicked play a sound at
 * all; see `microphone-permission.web.ts`.
 */
async function greetHolding(microphone: MicrophoneAccess, beginGreeting: () => Promise<boolean>): Promise<boolean> {
  try {
    return await beginGreeting();
  } finally {
    microphone.release();
  }
}

/**
 * The screen Jarvis answers from: him, and nothing else.
 *
 * **There is no button and no text on it.** There used to be a title, a status line, a Talk button
 * and three cards, and every one of them was there to explain something — which is the wrong shape
 * for an assistant. You do not press a button to talk to someone who is already listening, and you
 * do not read a paragraph about the microphone while they wait. So the conversation opens by
 * itself the moment the screen does, and what tells you which of the two of you is talking is what
 * the sphere is doing, which is the whole reason it was drawn.
 *
 * What is left when everything goes right is nothing to read. What is left when it does not is one
 * line saying so, because an assistant that has silently failed to connect looks exactly like one
 * that is listening, and there would otherwise be no way to tell.
 *
 * **And when the conversation ends, so does he.** The same argument once more: a sphere that goes
 * on turning after the agent has hung up is an assistant who has finished looking exactly like one
 * who is waiting for you. He fades, the drawing stops, and on a phone the assistant's window goes
 * with him — see the effects below `start`.
 *
 * The one thing that does put something on the screen is a field to type into, under him, in a
 * browser — see `typed-message-field.tsx`. It is the exception that keeps the rule: there is still
 * nothing to read, only somewhere to write.
 *
 * **On a phone it is there only when asked for.** It used to sit under him as an empty bar on
 * every summoning — something on the assistant's screen that was not him, for a keyboard nobody
 * summoning an assistant is holding — and the user asked for it gone. Tapping him now switches the
 * conversation into writing and back (see `text-mode.ts`), and the field comes with it. A browser
 * keeps it always: that is where Jarvis is developed and demonstrated, the keyboard is right there,
 * and it is the only way into the text-only conversation a refused microphone falls back to.
 *
 * **Typed, he still answers out loud.** `sendUserMessage` is on the conversation rather than on the
 * text half of it, so a typed line takes the same turn a spoken one would and comes back *spoken*,
 * with the sphere following his voice exactly as it does when you talk to him. The only
 * conversation he writes back in is the one with no microphone behind it.
 *
 * **That one now shows what he wrote**, which it never did. His reply arrived over the socket and
 * nothing rendered it, so typing into the fallback sent the line, got an answer and displayed
 * nothing at all — a conversation you could talk into and never hear back from. `written-reply.ts`
 * keeps the last thing he said and `WrittenReplyLine` puts it above the field. It is the one screen
 * where there is something to read, because it is the one where there is nothing to listen to.
 *
 * **And he delivers it.** With no audio the sphere had nothing to follow and idled through the
 * whole exchange, which is an assistant answering you while looking exactly like one who has not
 * heard you. For as long as an answer is being delivered the drawing is pointed at the simulated
 * voice sample mode uses — see the voice below. Only ever in this session: where there is a real
 * voice, overruling it with a clock would be a lie about something the screen can actually see.
 *
 * Settings are still reachable, and how depends on where this is running. On a phone it is a long
 * press anywhere on the screen. A long press rather than a link, because this screen is the assistant and an
 * assistant with a link on it is not one. In a browser it is a plain link, because a browser is not
 * an assistant — it is where this is developed and demonstrated, it already differs in bigger ways
 * (sample mode has no sheet there), and react-native-web does not raise `onLongPress` for a held
 * mouse at all, so the gesture would be a door that only looks like one.
 *
 * The particle count is the phone's own, as sample mode's has been for a while and this screen's
 * never was: see `spark-density.ts`. It drew a fixed number on every phone, which on a fast one was
 * fewer than it could manage and on a slow one more. Nothing on this screen reports it, though, in
 * a browser or on a phone: the frame-rate and particle readout belongs to sample mode, and this
 * screen is the assistant, with nothing on it but him.
 */
export function ConversationScreen({
  settings,
  onEditSettings,
  inSheet = false,
  inAssistantWindow = false,
  showing,
}: ConversationScreenProps) {
  const { startSession, sendUserMessage, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const liveVoice = useJarvisVoice();
  const { frameRate, buildMilliseconds, particleShare, provenShare, startingShare } = useSparkDensity();
  // Onto the AirPods, if there are any. Only once the call is up, because the list of routes is
  // empty until LiveKit has started the audio session. See `preferred-microphone.ts`.
  usePreferredHeadset(status === 'connected');
  // What he is doing between hearing you and answering. See `tool-activity.ts`.
  const { thinking, toolHandlers, forgetToolCalls } = useToolActivity();
  // And what happens to the sentence he was cut off in. See `queued-audio.ts`.
  const { playbackHandlers } = useQueuedAudio();
  // "Hello sir, how can I help?", from a recording, while the session is dialled behind it. See
  // `greeting.ts` in `hologram/conversation`, and `start` below.
  const {
    greeting,
    greetingVoice,
    beginGreeting,
    stopGreeting,
    untilCallMayTakeTheAudio,
    releaseCallAudio,
    greetingSessionOptions,
  } = useGreeting();
  // You, as the conversation hears you, for the sphere's listening animation. See `user-voice.ts`.
  const { user, userVoiceHandlers } = useUserVoice({ greeting });

  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);
  // Set once a conversation has actually been opened, which is what puts the text field on this
  // screen in a browser — either kind of conversation, since both take a typed line. It is not the same question
  // as whether one is *connected*: a session that opened and then dropped still has a field, saying
  // so, which is how a browser reports an ElevenLabs it could not finish reaching. What has no
  // field is a `start` that never got as far as a session at all — a phone with the microphone
  // refused, which says that in one line and is done. See `start` below.
  const [canType, setCanType] = useState(false);
  /**
   * The last thing Jarvis said, on the one conversation where he says it in writing.
   *
   * Only ever set from the text-only session — see `written-reply.ts`. In a voice conversation his
   * answer is his voice, and putting it on screen as well would be a transcript under a sphere
   * drawn precisely so there would not have to be one.
   */
  const [writtenReply, setWrittenReply] = useState(SAYING_NOTHING);
  const rememberWhatHeSaid = useCallback((incoming: { message: string; role: string }) => {
    setWrittenReply((reply) => afterMessage(reply, incoming, Date.now()));
  }, []);
  // Tapping him switches a phone's conversation between talking and writing. See `text-mode.ts`.
  const clearWrittenReply = useCallback(() => setWrittenReply(SAYING_NOTHING), []);
  const { textMode, toggleTextMode, resetTextMode, rememberInTextMode } = useTextMode({
    connected: status === 'connected',
    onSwitch: clearWrittenReply,
    remember: rememberWhatHeSaid,
  });
  /**
   * When to stop waiting for the conversation to open, or `undefined` once nothing is waited for.
   *
   * A moment rather than a countdown, so that anything which re-arms the wait — the status moving
   * from `disconnected` to `connecting`, say — re-arms it with the time that is actually left
   * rather than starting the twenty seconds again.
   */
  const [connectingUntil, setConnectingUntil] = useState<number | undefined>(undefined);

  /**
   * Whether Jarvis is still delivering his written answer.
   *
   * A boolean derived from the moment rather than the moment itself, because what reads it is a
   * hook and not the drawing: the sphere is handed one voice or the other, and swapping them is a
   * render. See `written-reply.ts` for where the moment comes from, and the voice below for what
   * is done with it.
   */
  const [readingAloud, setReadingAloud] = useState(false);
  useEffect(() => {
    const leftToSay = writtenReply.readingUntil - Date.now();
    if (leftToSay <= 0) {
      setReadingAloud(false);
      return;
    }
    setReadingAloud(true);
    const finished = setTimeout(() => setReadingAloud(false), leftToSay);
    return () => clearTimeout(finished);
  }, [writtenReply]);

  /**
   * The voice the sphere follows: his own, or one made up when there is none to follow.
   *
   * **A text-only conversation carries no audio at all**, so `liveVoice` reads silence throughout
   * and the sphere idled through the entire exchange — Jarvis answering you while looking exactly
   * like an assistant who had not heard you. For as long as he is delivering a written answer the
   * drawing is pointed at the same simulated voice sample mode uses, which is a spectrum built
   * from the clock and goes through every step a real one does: the fold into bands, the easing,
   * the agitation envelope, the chip bursts. Nothing downstream knows the difference, which is the
   * whole reason that voice is written as a spectrum rather than as a flag on the drawing.
   *
   * **It is a fiction, and only ever where there is nothing to be honest about.** The words are
   * really his; only the delivery is invented, and it is invented only in the session ElevenLabs
   * was asked not to speak in. A conversation with a voice never reaches this: `readingAloud` is
   * set from `onMessage`, which is wired on the text-only session alone, so the sphere goes on
   * following his real voice everywhere else — where it would be wrong to overrule it with a
   * clock.
   */
  const simulatedVoice = useSimulatedVoice(readingAloud ? 'speaking' : undefined);
  /**
   * And while he greets you, the recording he greets you with — read at the player's own position,
   * so the sphere says the words as they are heard. The agent's voice has nothing to say yet: its
   * first message is switched off for exactly as long as this plays.
   */
  const voice = readingAloud ? simulatedVoice : greeting ? greetingVoice : liveVoice;

  /**
   * Hangs up, whoever asks: the user tapping beside the sheet or pressing back, or the quiet after a
   * finished request (below).
   *
   * Summoned, there is a window to retract as well, and nothing behind it but what the user was
   * doing before — so the end of the conversation is the end of the window. Opened as an app or in
   * a browser there is none, and the screen simply stays, dark and still reachable by a long press.
   * The same two ways out sample mode has; see its `finish`. Both live in `conversation-sheet.tsx`,
   * with everything else that differs when he is summoned into the sheet.
   */
  const hangUpSession = useCallback(() => {
    setConnectingUntil(undefined);
    // Dismissed mid-greeting, he stops talking rather than finishing the sentence to nobody.
    stopGreeting();
    endSession();
  }, [endSession, stopGreeting]);

  /**
   * Hanging up once a finished request is followed by quiet. At the end of every request the agent
   * calls its `hangUpWhenQuiet` client tool, and three seconds of nobody saying anything after he
   * has finished ends the call exactly as tapping beside the sheet would. See `useHangUpWhenQuiet`.
   *
   * An answer he is still miming in writing counts as him speaking, since it is still on screen
   * being read and would leave with him.
   */
  const { quietSessionOptions, heardTheUser } = useHangUpWhenQuiet({ hangUp: hangUpSession, speaking: readingAloud });

  /**
   * Sends what was typed, and forgets the answer to the last thing.
   *
   * **The clearing is done here rather than left to the message coming back**, because in a
   * text-only session it does not come back. `onMessage` reports a user line from a
   * `user_transcript`, which is what ASR produces — and a conversation held as text runs no ASR,
   * so a line you typed may never be echoed at all. Left to that, a stale answer would sit under
   * the question you just asked for as long as Jarvis took to answer it, reading as his reply to
   * it. `afterMessage` still handles a user line for the session that does echo one; this is what
   * makes the screen right in the session that does not.
   *
   * For the same reason it is the screen that tells the quiet hang-up the user has answered: a line
   * that is never echoed back is never heard by it either.
   */
  const sendTypedMessage = useCallback(
    (message: string) => {
      heardTheUser();
      setWrittenReply(SAYING_NOTHING);
      sendUserMessage(message);
    },
    [sendUserMessage, heardTheUser],
  );

  const launchUrl = Linking.useURL();

  /**
   * Says what went wrong, and stops waiting for the conversation that is not coming.
   *
   * Every failure goes through here rather than setting the message directly, because a problem
   * and a wait are the same fact seen twice: leaving the deadline armed would let the generic
   * "took too long" replace a message that said exactly which key was rejected.
   */
  const reportProblem = useCallback((message: string) => {
    setConnectingUntil(undefined);
    setProblem(message);
  }, []);

  /**
   * Says what went wrong with the session itself, and on a phone says it in a toast as well.
   *
   * **The line alone was not enough there.** A session that fails once it is open — an account out
   * of credits is the one that was hit: ElevenLabs accepts the token, opens the room, then closes it
   * with `quota_exceeded` — is also a conversation that has ended, so Jarvis fades and, summoned,
   * the sheet and the assistant's window go with him, taking the line along before it can be read.
   * All anyone saw was him vanishing a second after greeting. A toast belongs to the system rather
   * than to this window, so it outlives him. A browser keeps its screen, and the line on it.
   */
  const reportSessionFailure = useCallback(
    (message: string) => {
      reportProblem(message);
      if (Platform.OS === 'android') {
        ToastAndroid.show(message, ToastAndroid.LONG);
      }
    },
    [reportProblem],
  );

  /**
   * Says why a conversation ended, when it ended for a reason worth saying.
   *
   * **The SDK does not route this through `onError`**, and that is the whole reason this exists.
   * A server that closes the socket — a rejected override, an agent that is not reachable, a
   * connection dropped mid-sentence — reaches `onDisconnect` carrying `reason: "error"` and a
   * message, and reaches `onError` not at all. So the screen went dark and said nothing: Jarvis
   * faded out, because a conversation really had ended, and there was no line to explain it.
   *
   * A conversation that simply finished is not a failure and gets no line. The agent hanging up
   * after saying goodbye is `reason: "agent"`, and being told so in red would be the screen
   * arguing with him.
   */
  const reportEnding = useCallback(
    (details: { reason: string; message?: string }) => {
      if (details.reason === 'error') {
        reportSessionFailure(details.message || 'The conversation with Jarvis ended unexpectedly.');
      }
    },
    [reportSessionFailure],
  );

  /**
   * Whether a `start` is already under way, as a ref so that two callers in the same commit see it.
   *
   * `isStarting` is state, and state is only seen on the next render — so two effects that both
   * decide to start in one commit would both see it false and open two WebRTC sessions, the second
   * tearing down the first. There are three such effects now: opening the screen, a summoning with
   * a launch URL, and the assistant's window being shown again.
   */
  const startingNow = useRef(false);

  /**
   * Greets you, and dials the voice session behind him — though on a phone it is only started once
   * he has finished; see the note in `start`. Nothing is started if he was hung up on mid-greeting.
   */
  const openVoiceSession = useCallback(
    async (microphone: MicrophoneAccess) => {
      const greeted = await greetHolding(microphone, beginGreeting);
      const { token } = await requestConversationToken({ settings, participantName: PHONE_PARTICIPANT_NAME });
      if (!(await untilCallMayTakeTheAudio())) {
        return;
      }
      startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        onError: reportSessionFailure,
        onDisconnect: reportEnding,
        ...toolHandlers,
        ...playbackHandlers,
        ...userVoiceHandlers,
        // The client tool, and the two handlers below that both it and something else want.
        ...quietSessionOptions,
        // The listening lattice and the quiet hang-up hear the user through the same score.
        onVadScore: inTurn(userVoiceHandlers.onVadScore, quietSessionOptions.onVadScore),
        // Only kept while the conversation is held in writing; see `text-mode.ts`.
        onMessage: inTurn(rememberInTextMode, quietSessionOptions.onMessage),
        ...(greeted ? greetingSessionOptions : {}),
      });
    },
    [
      settings,
      startSession,
      beginGreeting,
      untilCallMayTakeTheAudio,
      greetingSessionOptions,
      toolHandlers,
      playbackHandlers,
      userVoiceHandlers,
      quietSessionOptions,
      rememberInTextMode,
      reportSessionFailure,
      reportEnding,
    ],
  );

  const start = useCallback(async () => {
    if (startingNow.current) {
      return;
    }
    startingNow.current = true;
    setProblem(undefined);
    // Every summoning starts in voice, and with nothing written; see `text-mode.ts`.
    resetTextMode();
    setIsStarting(true);
    setConnectingUntil(Date.now() + GIVE_UP_CONNECTING_AFTER_MS);

    try {
      const microphone = await requestMicrophoneAccess();

      // On a phone a refusal is the end of it: the assistant gesture exists to be talked to, there
      // is no keyboard in front of you when you make it, and a text field would be answering a
      // question nobody asked. In a browser it is the opposite — this is where Jarvis is developed
      // and demonstrated, the keyboard is right there, and refusing the microphone is a thing you
      // do on purpose when you are in a call, in an open office, or want the same input twice.
      if (!microphone && ON_A_PHONE) {
        reportProblem('Jarvis needs the microphone in order to listen.');
        return;
      }

      // Both halves are minted here rather than at launch, and neither is kept: a conversation
      // token and a signed URL are short-lived, and one fetched when the app opened may already be
      // dead by the time it is used.
      // **A typed line into this session is answered out loud.** `sendUserMessage` belongs to the
      // conversation rather than to the text-only flavour of it, so what the keyboard sends takes
      // exactly the turn the microphone would have: he speaks the reply, and the sphere follows it,
      // because nothing downstream of here knows how the turn was started.
      //
      // **And he answers before it is even dialled.** The greeting is a recording, so it starts the
      // moment the microphone is granted, and the token request goes out beside it rather than after
      // it: by the time he has said "how can I help?" the session is usually up and listening. The
      // session is told not to greet a second time, and its microphone is kept muted until he has
      // finished, so the agent does not hear him through the speaker and take it for you. If the
      // session is slower than the greeting, the screen simply goes on connecting as it always did.
      //
      // **On a phone the session itself waits for him to finish**, because starting it switches
      // Android into call audio and that turned the rest of the recording into a clipped, thin voice
      // that did not sound like him. See `untilCallMayTakeTheAudio`.
      //
      // **In a browser the microphone is still held open while he starts**, which is what lets a tab
      // nobody has clicked play him at all; it is let go as soon as the greeting has started, or been
      // refused. See `microphone-permission.web.ts`.
      if (microphone) {
        await openVoiceSession(microphone);
      } else {
        // **This is what makes a conversation possible with no microphone at all**, and the one
        // place Jarvis still answers in writing. ElevenLabs runs the session as text on both sides:
        // nothing is captured, and the reply comes back written rather than spoken. That second
        // half is the cost — with no speech to track, the sphere idles rather than answering — so
        // it is only ever asked for when there is no alternative, which since the field appears
        // beside a live microphone too means exactly one case: a browser that refused one.
        // He still visibly thinks, because a tool call is reported over the same channel and
        // `useToolActivity` does not care how the conversation is being held.
        //
        // And it is held over a socket rather than over WebRTC, which is the whole reason this is
        // a branch rather than one flag on the call above: a room nobody publishes audio into
        // never finishes coming up, so a typed conversation dialled over WebRTC sat on
        // "Connecting…" for ever. See `requestSignedConversationUrl`.
        //
        // **No recorded greeting here, and so no override either.** Whoever refused the microphone
        // did it to keep this conversation silent — in a call, in an open office — and it is the one
        // session where he answers in writing. So he greets in writing too: the agent's own first
        // message arrives as his first written reply, exactly as it did before there was a greeting.
        const signedUrl = await requestSignedConversationUrl(settings);
        startSession({
          signedUrl,
          connectionType: 'websocket',
          textOnly: true,
          onError: reportSessionFailure,
          onDisconnect: reportEnding,
          ...toolHandlers,
          // Hung up on quiet here too. Nothing is spoken or scored in this session, so it is three
          // seconds after the call — counted once he has finished miming his written answer —
          // unless a line is typed.
          ...quietSessionOptions,
          // The only place this is asked for, because it is the only place there is anything to
          // read: his reply arrives written here and as audio everywhere else.
          onMessage: inTurn(rememberWhatHeSaid, quietSessionOptions.onMessage),
        });
      }
      setCanType(true);
    } catch (error: unknown) {
      // Nothing is coming to take the call's audio the greeting started, so it is let go here.
      stopGreeting();
      releaseCallAudio();
      reportProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      startingNow.current = false;
      setIsStarting(false);
    }
  }, [
    settings,
    startSession,
    openVoiceSession,
    stopGreeting,
    releaseCallAudio,
    resetTextMode,
    toolHandlers,
    quietSessionOptions,
    reportProblem,
    reportSessionFailure,
    reportEnding,
    rememberWhatHeSaid,
  ]);

  /**
   * Gives up on a conversation that is taking too long to open, and says so.
   *
   * The one thing on this screen that does not wait to be told. See
   * {@link GIVE_UP_CONNECTING_AFTER_MS} for why a screen that only ever reacts to the SDK has a
   * state it can never leave.
   */
  useEffect(() => {
    if (connectingUntil === undefined) {
      return;
    }
    if (status === 'connected') {
      setConnectingUntil(undefined);
      return;
    }

    const givingUp = setTimeout(
      () => {
        setConnectingUntil(undefined);
        setProblem('Jarvis did not answer. ElevenLabs may be unreachable, or the settings may be wrong.');
      },
      Math.max(0, connectingUntil - Date.now()),
    );
    return () => clearTimeout(givingUp);
  }, [connectingUntil, status]);

  /**
   * Opens the conversation as soon as there is a screen to open it on.
   *
   * Once, and only once, however this screen was reached — from the launcher, from the assistant
   * gesture, or by coming back from settings. `tried` is a ref rather than state because it must
   * not cause a render and must not reset when one happens: two starts in flight at the same time
   * is two WebRTC sessions, and the second tears down the first.
   *
   * Nothing retries. A conversation that failed to open failed for a reason — no microphone, no
   * network, a rejected key — and hammering ElevenLabs until one of those changes would be rude to
   * them and useless to the user, who can press and hold to fix the only one of those that is
   * fixable here.
   */
  // A call still running when the conversation drops never gets its answer, so the sphere would be
  // left mid-thought — and the next conversation would open with him already thinking about
  // something that stopped happening.
  useEffect(() => {
    if (!isLive(status)) {
      forgetToolCalls();
    }
  }, [status, forgetToolCalls]);

  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || isLive(status) || isStarting) {
      return;
    }
    tried.current = true;
    void start();
  }, [start, status, isStarting]);

  /**
   * A conversation that was open and is not any more: Jarvis goes.
   *
   * **He used to stay.** The agent would say goodbye and hang up, the session would drop, and the
   * sphere went on turning exactly as it does while he listens — which is the same complaint the
   * problem line answers, in the other direction: an assistant who has finished looks identical to
   * one who is waiting for you. So the end of a conversation is the end of him being on screen.
   *
   * *Was* open is the whole of the condition, and it is why this is a fold over the statuses
   * rather than a look at the current one: a conversation that never opened is a different state
   * with a different answer — the line saying why, under a sphere that is still there — and both
   * of them read `disconnected`. See `conversation-life.ts`.
   */
  const [life, setLife] = useState(NOT_YET_OPEN);
  useEffect(() => {
    setLife((seen) => afterStatus(seen, status));
  }, [status]);
  const ended = life.ended;

  /**
   * And once he has gone, the drawing stops.
   *
   * `leaving` is a fade, not an unmount — see the prop — so the screen has to keep him for exactly
   * {@link LEAVING_SECONDS} and then let go. Letting go is the point: a frame loop drawing a sphere
   * that has faded to nothing is a phone kept awake for no one.
   */
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ended) {
      // Which today only ever means "not yet", since nothing retries — but a conversation that
      // became open again would have to bring him back with it rather than leave the screen dark.
      setGone(false);
      return;
    }
    const fading = setTimeout(() => setGone(true), LEAVING_SECONDS * 1000);
    return () => clearTimeout(fading);
  }, [ended]);

  const goNow = useCallback(() => setGone(true), []);
  const sheet = useConversationSheet({
    inSheet,
    inAssistantWindow,
    gone,
    opened: life.open,
    endConversation: hangUpSession,
    goNow,
  });
  const { hologramSize, canvas, settled } = sheet;

  /**
   * A summoning that arrives while this screen is already open.
   *
   * A conversation still under way is simply shown again, since starting another would tear it
   * down. Anything else — one that has ended, or never opened — is replaced by a fresh one, and he
   * comes back with it: `gone` going false is what brings the sheet back up.
   *
   * **Bringing him back is not optional.** Starting alone, as a launch URL once did, greets you from
   * a screen whose sphere has already gone and whose sheet is off the bottom of it — the greeting
   * and nothing to look at.
   */
  const summonAgain = useCallback(() => {
    if (isLive(status) || startingNow.current) {
      return;
    }
    setLife(NOT_YET_OPEN);
    setGone(false);
    void start();
  }, [start, status]);

  // Summoned by the plain assist intent, into the app's own activity: each summoning is a new URL,
  // claimed so it is acted on once. Never in the assistant's window, whose tree hears the activity's
  // URLs as well — they are the process's, not the window's — and claiming one there would answer a
  // summoning from the one window that is not on screen.
  useEffect(() => {
    if (inAssistantWindow || !claimAssistLaunch(launchUrl)) {
      return;
    }
    summonAgain();
  }, [inAssistantWindow, launchUrl, summonAgain]);

  // Summoned into the assistant's own window, which is kept between summonings: every showing after
  // the one this screen opened on is a summoning of its own. See `SHOWING_PROP`.
  const seenShowing = useRef(showing);
  useEffect(() => {
    if (showing === seenShowing.current) {
      return;
    }
    seenShowing.current = showing;
    summonAgain();
  }, [showing, summonAgain]);

  const screen = (
    // The whole screen is the way into settings, not just the sphere. A long press has to land
    // somewhere, and on a screen with one round thing on it and nothing else, "somewhere" should
    // not mean "on the round thing" — most of what you would press is the dark around him. It is
    // also the only part a test can press: the drawing puts a `<canvas>` over the middle, and that
    // takes the pointer events for itself. In the sheet, the whole sheet is.
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={SCREEN_LABEL}
      style={inSheet ? styles.sheetContent : styles.screen}
      onLongPress={ON_A_PHONE ? onEditSettings : undefined}
      // Tapping him switches between talking and writing, once there is a conversation to switch.
      onPress={tapToSwitchModes({ canType, ended, toggleTextMode })}
      testID="conversation"
    >
      {gone ? null : (
        <View style={{ width: hologramSize, height: hologramSize }} testID="hologram">
          {settled ? (
            <JarvisHologram
              size={hologramSize}
              voice={voice}
              user={user}
              quietestSpeech={QUIETEST_SPEECH_HERE}
              thinking={thinking}
              leaving={ended}
              frameRate={frameRate}
              buildMilliseconds={buildMilliseconds}
              particleShare={particleShare}
              provenShare={provenShare}
              startingShare={startingShare}
              // Solid in the sheet, as sample mode's is: an opaque canvas is Skia's fast path, and
              // it has to paint the sheet's own colour or it is a black square on the sheet.
              opaque={canvas.opaque}
              background={canvas.background}
            />
          ) : null}
        </View>
      )}

      {problem ? (
        <Text style={styles.problem} testID="conversation-problem">
          {problem}
        </Text>
      ) : null}

      {/*
        The other way in, in a browser, wherever there is a conversation to type into — a live
        microphone as readily as a refused one. Only a `start` that never opened a session at all
        has none. On a phone only while the conversation is held in writing: see `text-mode.ts`.

        It leaves with him rather than before him, so the screen empties in one movement. A field
        left behind on a conversation that has ended is somewhere to type that nothing is listening
        to, which is worse than no field at all.
      */}
      {/*
        What he said, when saying it is not something he can do out loud. Set only in the text-only
        session and, on a phone, while a voice conversation is held in writing, so it is absent
        whenever he is being heard — which is the screen as designed, and why this is gated on the
        reply itself rather than on the platform.

        It goes when he goes, for the same reason the field does: an answer left on screen after
        the conversation carrying it has ended is the last thing he ever said, kept for ever.
      */}
      {writtenReply.shown && !gone ? <WrittenReplyLine reply={writtenReply.shown} /> : null}

      {showsTypedField({ canType, gone, textMode }) ? (
        <TypedMessageField
          onSend={sendTypedMessage}
          // Someone writing an answer has answered, as far as the quiet hang-up is concerned.
          onTyping={heardTheUser}
          enabled={status === 'connected'}
          opening={connectingUntil !== undefined}
          // Switched into writing with a tap, the keyboard is what was asked for.
          autoFocus={ON_A_PHONE}
        />
      ) : null}

      {ON_A_PHONE ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={onEditSettings}
          style={styles.settingsLink}
          testID="open-settings"
        >
          <Text style={styles.settingsLinkLabel}>ElevenLabs settings</Text>
        </Pressable>
      )}
    </Pressable>
  );

  return (
    <ConversationFrame inSheet={inSheet} gone={gone} sheet={sheet}>
      {screen}
    </ConversationFrame>
  );
}

const styles = StyleSheet.create({
  /**
   * Him in the middle, and nothing else in the layout to push him off it.
   *
   * The square is wider than the screen — see `useWholeScreenHologramSize` — so `overflow: hidden`
   * is what keeps what hangs off the sides from being something the screen can scroll to.
   */
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /** The same, filling the sheet rather than the screen. The sheet does its own clipping. */
  sheetContent: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The browser's way back to setup, which a phone does with a long press instead. */
  settingsLink: {
    position: 'absolute',
    bottom: theme.spacing.large,
    padding: theme.spacing.small,
  },
  settingsLinkLabel: {
    color: theme.colors.mutedText,
    textDecorationLine: 'underline',
  },
  /** Only ever on screen when something is wrong, and then it is the only thing on screen. */
  problem: {
    position: 'absolute',
    left: theme.spacing.large,
    right: theme.spacing.large,
    bottom: theme.spacing.large * 2,
    color: theme.colors.danger,
    textAlign: 'center',
  },
});
