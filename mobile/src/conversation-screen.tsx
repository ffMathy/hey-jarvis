import * as Linking from 'expo-linking';
import {
  afterStatus,
  type ElevenLabsSettings,
  isLive,
  MICROPHONE_PROBLEM,
  NOT_YET_OPEN,
  PHONE_PARTICIPANT_NAME,
  type ProblemSource,
  type SessionPhase,
} from 'hologram';
import { useJarvisSession } from 'hologram/conversation';
import { LEAVING_SECONDS } from 'hologram/react/lifecycle';
import { useSimulatedVoice } from 'hologram/react/sample';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { whenTheAssistantWindowIsPutAway } from '../modules/jarvis-assistant';
import { roomOfConversation } from './agent-audio-track';
import { createAssistLaunchClaim } from './assist-link';
import { CameraButton } from './camera-button';
import { ConversationFrame, useConversationSheet } from './conversation-sheet';
import { JarvisHologram } from './jarvis-hologram';
import { followJarvisVoice, useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import { usePreferredHeadset } from './preferred-microphone';
import { useSparkDensity } from './spark-density';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
import { theme } from './theme';
import { TypedMessageField } from './typed-message-field';
import { usePhotoSending } from './use-photo-sending';
import { WrittenReplyLine } from './written-reply-line';

interface ConversationScreenProps {
  settings: ElevenLabsSettings;
  /**
   * Sir's Jarvis server, where a photo is sent, or `undefined` when he has not given this phone one —
   * in which case there is no camera here at all. See `jarvis-server.ts`.
   */
  serverAddress: string | undefined;
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
 * What tapping the screen does: on a phone, once there is a conversation that has not ended, it
 * switches between talking and writing (see `createTextModeCaption` in `hologram`). Anywhere else,
 * nothing.
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
 * Whether the camera is beside him: while there is a conversation to send a photo into, and somewhere
 * this phone could send it — which takes the Jarvis server's address. Not during the greeting, whose
 * microphone is still muted, and not while a phone is held in writing, where the keyboard has pushed
 * the field up to where the button would be.
 *
 * **And not while he is busy with something else.** The photo arrives as a turn of sir's, and a turn
 * in the middle of one replaces it: a request still being worked on is cancelled, and an answer still
 * being spoken is cut off. Nor while the camera is open or a photo is on its way — one at a time.
 */
function showsCameraButton({
  canSendPhotos,
  connected,
  gone,
  settled,
  greeting,
  textMode,
  thinking,
  speaking,
  busy,
}: {
  canSendPhotos: boolean;
  connected: boolean;
  gone: boolean;
  settled: boolean;
  greeting: boolean;
  textMode: boolean;
  thinking: boolean;
  speaking: boolean;
  busy: boolean;
}) {
  const inFront = canSendPhotos && connected && !gone && settled && !greeting && !(ON_A_PHONE && textMode);
  return inFront && !(thinking || speaking || busy);
}

/**
 * Whether a summoning is under way — greeting, connecting or talking — and so is shown again rather
 * than replaced when he is summoned once more.
 */
function isUnderWay(phase: SessionPhase): boolean {
  return phase === 'greeting' || phase === 'connecting' || phase === 'live';
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
 * **The other is a camera, beside him, and it is faint.** Showing Jarvis a receipt or a label is
 * something you decide to do rather than something he can guess, so it needs a door — but only one
 * you can find, never one you have to read: a small outline at the sphere's lower right, at half
 * strength, there only while he is connected and listening. It is the only way to show him anything:
 * he cannot open the camera himself, only suggest the button (`use-photo-sending.ts`). A phone that
 * has not been told where sir's Jarvis server is has no door at all, since there is nowhere to send
 * what it would take.
 *
 * **On a phone it is there only when asked for.** It used to sit under him as an empty bar on
 * every summoning — something on the assistant's screen that was not him, for a keyboard nobody
 * summoning an assistant is holding — and the user asked for it gone. Tapping him now switches the
 * conversation into writing and back (see `toggleTextMode`), and the field comes with it. A browser
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
 * nothing at all — a conversation you could talk into and never hear back from.
 * `hologram/src/written-reply.ts` keeps the last thing he said and `WrittenReplyLine` puts it above
 * the field. It is the one screen where there is something to read, because it is the one where
 * there is nothing to listen to.
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
  serverAddress,
  onEditSettings,
  inSheet = false,
  inAssistantWindow = false,
  showing,
}: ConversationScreenProps) {
  const [problem, setProblem] = useState<string | undefined>(undefined);

  /**
   * Says what went wrong. A problem and the wait for a conversation are the same fact seen twice,
   * and the session stops waiting — and ends whatever it was waiting for — before it says so.
   */
  const reportProblem = useCallback((message: string) => {
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
   *
   * Only the session's own failures are toasted — a start that failed, an error before it opened,
   * and one that ended with an error, which the SDK reports through `onDisconnect` with `reason:
   * "error"` rather than through `onError`. Problems before there is a session, and the deadline,
   * stay on the line alone, under a sphere that is still there.
   */
  const reportSessionFailure = useCallback((message: string) => {
    setProblem(message);
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.LONG);
    }
  }, []);

  /**
   * The conversation itself: hologram's session, which the headset and the watch hold too (see
   * `useJarvisSession` in `hologram/conversation`).
   *
   * The rules are all there — one start at a time, the greeting from the recording while the token
   * is fetched beside it and the session dialled behind it, the twenty seconds a conversation gets
   * to open (and the ending of one that opens after them), failures said in words, tool calls,
   * interruptions, the listening lattice's score. What this screen hands it is only what is this
   * app's: its name in the history, its own check that a room is a `Room` of the `livekit-client`
   * it bundles (`agent-audio-track.ts`), how it listens to his track (`jarvis-voice.ts`, natively on
   * Android and through Web Audio in a browser), and its text mode's rule for his written lines. The
   * camera is not among them: it only speaks into the conversation, below.
   */
  const conversation = useJarvisSession({
    settings,
    participantName: PHONE_PARTICIPANT_NAME,
    findRoom: roomOfConversation,
    followAgentVoice: followJarvisVoice,
    captions: 'while-typing',
    onProblem: (message: string, source: ProblemSource) =>
      source === 'session' ? reportSessionFailure(message) : reportProblem(message),
  });
  const { phase, status, writtenReply, setTyping, summon, sendText, hangUp } = conversation;

  /** The faint camera beside him, and the photo it sends into this conversation. See `use-photo-sending.ts`. */
  const { canSendPhotos, cameraBusy, sendJarvisAPhoto } = usePhotoSending({
    inAssistantWindow,
    serverAddress,
    conversation,
  });
  const textMode = conversation.typing;
  const liveVoice = useJarvisVoice(conversation.voice);
  const { frameRate, buildMilliseconds, particleShare, provenShare, startingShare } = useSparkDensity();
  // Onto the AirPods, if there are any. Only once the call is up, because the list of routes is
  // empty until LiveKit has started the audio session. See `preferred-microphone.ts`.
  usePreferredHeadset(status === 'connected');

  const [isStarting, setIsStarting] = useState(false);
  // Set once a conversation has actually been dialled, which is what puts the text field on this
  // screen in a browser — either kind of conversation, since both take a typed line. It is not the
  // same question as whether one is *connected*: a session that was dialled and then dropped still
  // has a field, saying so, which is how a browser reports an ElevenLabs it could not finish
  // reaching. What has no field is a `start` that never got as far as a session at all — a phone
  // with the microphone refused, or a key ElevenLabs rejected, which says that in one line and is
  // done. See `start` below.
  const [canType, setCanType] = useState(false);
  useEffect(() => {
    if (conversation.dialled) {
      setCanType(true);
    }
  }, [conversation.dialled]);

  /**
   * Whether Jarvis is still delivering his written answer.
   *
   * A boolean derived from the moment rather than the moment itself, because what reads it is a
   * hook and not the drawing: the sphere is handed one voice or the other, and swapping them is a
   * render. See `hologram/src/written-reply.ts` for where the moment comes from, and the voice below
   * for what is done with it.
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
   * **A text-only conversation carries no audio at all**, so his voice reads silence throughout
   * and the sphere idled through the entire exchange — Jarvis answering you while looking exactly
   * like an assistant who had not heard you. For as long as he is delivering a written answer the
   * drawing is pointed at the same simulated voice sample mode uses, which is a spectrum built
   * from the clock and goes through every step a real one does: the fold into bands, the easing,
   * the agitation envelope, the chip bursts. Nothing downstream knows the difference, which is the
   * whole reason that voice is written as a spectrum rather than as a flag on the drawing.
   *
   * **It is a fiction, and only ever where there is nothing to be honest about.** The words are
   * really his; only the delivery is invented, and it is invented only in the session ElevenLabs
   * was asked not to speak in. A conversation with a voice never reaches this: only the text-only
   * session's lines come with a `readingUntil`, and a phone held in writing — which still speaks —
   * shows his line without one (`afterSpokenMessage`). So the sphere goes on following his real
   * voice everywhere else, where it would be wrong to overrule it with a clock.
   */
  const simulatedVoice = useSimulatedVoice(readingAloud ? 'speaking' : undefined);
  /**
   * And while he greets you, the recording he greets you with — read at the player's own position,
   * so the sphere says the words as they are heard. The agent's voice has nothing to say yet: its
   * first message is switched off for exactly as long as this plays.
   */
  const voice = readingAloud ? simulatedVoice : conversation.greeting ? conversation.voice : liveVoice;

  /**
   * Tapping him switches a phone's conversation between talking and writing: the microphone muted,
   * the field under him, his answers written above it as well as spoken. See
   * `createTextModeCaption` in `hologram/src/written-caption.ts`.
   */
  const toggleTextMode = useCallback(() => setTyping(!textMode), [setTyping, textMode]);

  const launchUrl = Linking.useURL();

  /**
   * Whether a `start` is already under way, as a ref so that two callers in the same commit see it.
   *
   * `isStarting` is state, and state is only seen on the next render — so two effects that both
   * decide to start in one commit would both see it false and ask for the microphone twice. There
   * are three such effects: opening the screen, a summoning with a launch URL, and the assistant's
   * window being shown again. The session itself holds one summoning at a time; this covers the
   * asking before it.
   */
  const startingNow = useRef(false);

  const start = useCallback(async () => {
    if (startingNow.current) {
      return;
    }
    startingNow.current = true;
    setProblem(undefined);
    // Every summoning starts in voice, and with nothing written; see `createTextModeCaption`.
    setTyping(false);
    setIsStarting(true);

    try {
      const microphone = await requestMicrophoneAccess();

      // On a phone a refusal is the end of it: the assistant gesture exists to be talked to, there
      // is no keyboard in front of you when you make it, and a text field would be answering a
      // question nobody asked. In a browser it is the opposite — this is where Jarvis is developed
      // and demonstrated, the keyboard is right there, and refusing the microphone is a thing you
      // do on purpose when you are in a call, in an open office, or want the same input twice.
      if (!microphone && ON_A_PHONE) {
        reportProblem(MICROPHONE_PROBLEM);
        return;
      }

      // The session mints what it dials with rather than this screen at launch, and keeps neither:
      // a conversation token and a signed URL are short-lived, and one fetched when the app opened
      // may already be dead by the time it is used.
      //
      // **A typed line into this session is answered out loud.** `sendUserMessage` belongs to the
      // conversation rather than to the text-only flavour of it, so what the keyboard sends takes
      // exactly the turn the microphone would have: he speaks the reply, and the sphere follows it,
      // because nothing downstream of here knows how the turn was started.
      //
      // **And he answers before it is even dialled.** The greeting is a recording, so it starts the
      // moment the microphone is granted, and the token request goes out beside it: by the time he
      // has said "how can I help?" the session is usually up and listening. The session is told
      // not to greet a second time, and its microphone is kept muted until he has finished, so the
      // agent does not hear him through the speaker and take it for you. If the session is slower
      // than the greeting, the screen simply goes on connecting as it always did.
      //
      // **On a phone he greets inside the call's audio and the session waits for him to finish**,
      // because starting the session switches Android into call audio and that turned the rest of
      // the recording into a clipped, thin voice that did not sound like him. See
      // `hologram/src/conversation/call-audio.ts`.
      //
      // **In a browser the microphone is still held open while he starts**, which is what lets a tab
      // nobody has clicked play him at all; it is let go as soon as the greeting has started, or been
      // refused. See `microphone-permission.web.ts`.
      if (microphone) {
        summon({ onGreetingAnswered: microphone.release });
      } else {
        // **This is what makes a conversation possible with no microphone at all**, and the one
        // place Jarvis still answers in writing. ElevenLabs runs the session as text on both sides:
        // nothing is captured, and the reply comes back written rather than spoken — so his lines
        // are shown, and mimed on the sphere. It is only ever asked for when there is no
        // alternative, which since the field appears beside a live microphone too means exactly one
        // case: a browser that refused one. He still visibly thinks, because a tool call is
        // reported over the same channel.
        //
        // And it is held over a socket rather than over WebRTC: a room nobody publishes audio into
        // never finishes coming up, so a typed conversation dialled over WebRTC sat on
        // "Connecting…" for ever. See `requestSignedConversationUrl`.
        //
        // **No recorded greeting here, and so no override either.** Whoever refused the microphone
        // did it to keep this conversation silent — in a call, in an open office — and it is the one
        // session where he answers in writing. So he greets in writing too: the agent's own first
        // message arrives as his first written reply, exactly as it did before there was a greeting.
        summon({ textOnly: true });
      }
    } catch (error: unknown) {
      reportProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      startingNow.current = false;
      setIsStarting(false);
    }
  }, [setTyping, summon, reportProblem]);

  /**
   * Opens the conversation as soon as there is a screen to open it on.
   *
   * Once, and only once, however this screen was reached — from the launcher, from the assistant
   * gesture, or by coming back from settings. `tried` is a ref rather than state because it must
   * not cause a render and must not reset when one happens.
   *
   * Nothing retries. A conversation that failed to open failed for a reason — no microphone, no
   * network, a rejected key — and hammering ElevenLabs until one of those changes would be rude to
   * them and useless to the user, who can press and hold to fix the only one of those that is
   * fixable here.
   */
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
   * of them read `disconnected`. See `hologram/src/conversation-life.ts`. The statuses are the
   * session's, which only ever come from the SDK's status callbacks: an error while he is talking is
   * not him leaving.
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
    // Hangs up when the user asks: tapping beside the sheet or pressing back. Dismissed
    // mid-greeting, he stops talking rather than finishing the sentence to nobody. The quiet after
    // a finished request is not the screen's to judge — the agent ends that call itself, with its
    // `turnTimeout` and `end_call`. Summoned, the end of the conversation is the end of the window
    // as well; opened as an app or in a browser, the screen simply stays, dark and still reachable
    // by a long press. See `conversation-sheet.tsx`.
    endConversation: hangUp,
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
    if (isUnderWay(phase) || isLive(status) || startingNow.current) {
      return;
    }
    setLife(NOT_YET_OPEN);
    setGone(false);
    void start();
  }, [start, phase, status]);

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

  // Put away while he is still talking — the screen timing out over the lock screen does it, after
  // a summoning from a pocket — he hangs up, because nothing is left on screen to hang up with.
  // Only from the window's own tree: the activity's would hear the event as well. See
  // `whenTheAssistantWindowIsPutAway`.
  useEffect(() => {
    if (!inAssistantWindow) {
      return;
    }
    return whenTheAssistantWindowIsPutAway(hangUp);
  }, [inAssistantWindow, hangUp]);

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
              user={conversation.user}
              quietestSpeech={QUIETEST_SPEECH_HERE}
              thinking={conversation.thinking}
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
        has none. On a phone only while the conversation is held in writing: see `toggleTextMode`.

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
          // Sent into the session, which clears the answer to the last line as it goes: a text-only
          // session runs no speech recognition, so a typed line may never come back to clear it,
          // and a stale answer would sit under the new question reading as a reply to it.
          onSend={sendText}
          enabled={status === 'connected'}
          opening={isStarting || phase === 'greeting' || phase === 'connecting'}
          // Switched into writing with a tap, the keyboard is what was asked for.
          autoFocus={ON_A_PHONE}
        />
      ) : null}

      {/* The camera, beside him. See `showsCameraButton`. */}
      <CameraButton
        visible={showsCameraButton({
          canSendPhotos,
          connected: status === 'connected',
          gone,
          settled,
          greeting: conversation.greeting,
          textMode,
          thinking: conversation.thinking,
          speaking: conversation.mode === 'speaking',
          busy: cameraBusy,
        })}
        hologramSize={hologramSize}
        onPress={sendJarvisAPhoto}
      />

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
