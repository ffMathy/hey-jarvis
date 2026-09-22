import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import {
  type ElevenLabsSettings,
  PHONE_PARTICIPANT_NAME,
  requestConversationToken,
  requestSignedConversationUrl,
} from 'hologram';
import { useToolActivity } from 'hologram/conversation';
import { LEAVING_SECONDS } from 'hologram/react/lifecycle';
import { useSimulatedVoice } from 'hologram/react/sample';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createAssistLaunchClaim } from './assist-link';
import { afterStatus, isLive, NOT_YET_OPEN } from './conversation-life';
import { ConversationFrame, useConversationSheet } from './conversation-sheet';
import { JarvisHologram } from './jarvis-hologram';
import { useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import { usePreferredHeadset } from './preferred-microphone';
import { useQueuedAudio } from './queued-audio';
import { useSparkDensity } from './spark-density';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
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
}

/** Summonings already acted on in this process. */
const claimAssistLaunch = createAssistLaunchClaim();

/** Where the screen has to be bare, and where it does not. See the note on the component. */
const ON_A_PHONE = Platform.OS !== 'web';

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
 * The one thing that does put something on the screen is a field to type into, under him, wherever
 * there is a conversation to type into — see `typed-message-field.tsx`. It is the exception that
 * keeps the rule: there is still nothing to read, only somewhere to write.
 *
 * **It used to be a browser's consolation prize for a refused microphone, and Jarvis answered it in
 * writing.** That is because the only session it ever appeared in was the text-only one, which is
 * the one mode where ElevenLabs is asked not to speak. Typing into an ordinary voice session is
 * nothing of the sort: `sendUserMessage` is on the conversation rather than on the text half of it,
 * so a typed line takes the same turn a spoken one would and comes back *spoken*, with the sphere
 * following his voice exactly as it does when you talk to him. So the field is on both platforms
 * now, and the only conversation he still writes back in is the one with no microphone behind it.
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
 * press anywhere the field is not: a `TextInput` keeps its own long press for selecting text, which
 * is worth more there than a second way into settings, and everything around it is still most of
 * the screen. A long press rather than a link, because this screen is the assistant and an
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
export function ConversationScreen({ settings, onEditSettings, inSheet = false }: ConversationScreenProps) {
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

  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);
  // Set once a conversation has actually been opened, which is what puts the text field on this
  // screen — either kind of conversation, since both take a typed line. It is not the same question
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
   */
  const sendTypedMessage = useCallback(
    (message: string) => {
      setWrittenReply(SAYING_NOTHING);
      sendUserMessage(message);
    },
    [sendUserMessage],
  );
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
  const voice = readingAloud ? simulatedVoice : liveVoice;

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
        reportProblem(details.message || 'The conversation with Jarvis ended unexpectedly.');
      }
    },
    [reportProblem],
  );

  /**
   * Whether a `start` is already under way, as a ref so that two callers in the same commit see it.
   *
   * `isStarting` is state, and state is only seen on the next render — so two effects that both
   * decide to start in one commit would both see it false and open two WebRTC sessions, the second
   * tearing down the first. There are two such effects now: a summoning with a launch URL, and the
   * sheet coming back into view.
   */
  const startingNow = useRef(false);

  const start = useCallback(async () => {
    if (startingNow.current) {
      return;
    }
    startingNow.current = true;
    setProblem(undefined);
    setIsStarting(true);
    setConnectingUntil(Date.now() + GIVE_UP_CONNECTING_AFTER_MS);

    try {
      const canHear = await requestMicrophoneAccess();

      // On a phone a refusal is the end of it: the assistant gesture exists to be talked to, there
      // is no keyboard in front of you when you make it, and a text field would be answering a
      // question nobody asked. In a browser it is the opposite — this is where Jarvis is developed
      // and demonstrated, the keyboard is right there, and refusing the microphone is a thing you
      // do on purpose when you are in a call, in an open office, or want the same input twice.
      if (!canHear && ON_A_PHONE) {
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
      if (canHear) {
        const { token } = await requestConversationToken({ settings, participantName: PHONE_PARTICIPANT_NAME });
        startSession({
          conversationToken: token,
          connectionType: 'webrtc',
          onError: reportProblem,
          onDisconnect: reportEnding,
          ...toolHandlers,
          ...playbackHandlers,
        });
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
        const signedUrl = await requestSignedConversationUrl(settings);
        startSession({
          signedUrl,
          connectionType: 'websocket',
          textOnly: true,
          onError: reportProblem,
          onDisconnect: reportEnding,
          // The only place this is asked for, because it is the only place there is anything to
          // read: his reply arrives written here and as audio everywhere else.
          onMessage: rememberWhatHeSaid,
          ...toolHandlers,
        });
      }
      setCanType(true);
    } catch (error: unknown) {
      reportProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      startingNow.current = false;
      setIsStarting(false);
    }
  }, [settings, startSession, toolHandlers, playbackHandlers, reportProblem, reportEnding, rememberWhatHeSaid]);

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

  /**
   * Summoned, there is a window to retract as well, and nothing behind it but what the user was
   * doing before — so the end of the conversation is the end of the window. Opened as an app or in
   * a browser there is none, and the screen simply stays, dark and still reachable by a long press.
   * The same two ways out sample mode has; see its `finish`. Both live in `conversation-sheet.tsx`,
   * with everything else that differs when he is summoned into the sheet.
   */
  const hangUpSession = useCallback(() => {
    setConnectingUntil(undefined);
    endSession();
  }, [endSession]);
  const goNow = useCallback(() => setGone(true), []);
  const summonAgain = useCallback(() => {
    setLife(NOT_YET_OPEN);
    setGone(false);
    void start();
  }, [start]);
  const sheet = useConversationSheet({
    inSheet,
    gone,
    opened: life.open,
    endConversation: hangUpSession,
    goNow,
    summonAgain,
  });
  const { hologramSize, canvas, settled } = sheet;

  // A summoning that arrives while this screen is already open: claimed so it is acted on once,
  // and then left alone if a conversation is already under way, since starting again would tear
  // down the one that is.
  useEffect(() => {
    if (!claimAssistLaunch(launchUrl)) {
      return;
    }
    if (!isLive(status) && !isStarting) {
      void start();
    }
  }, [launchUrl, start, status, isStarting]);

  const screen = (
    // The whole screen is the way into settings, not just the sphere. A long press has to land
    // somewhere, and on a screen with one round thing on it and nothing else, "somewhere" should
    // not mean "on the round thing" — most of what you would press is the dark around him. It is
    // also the only part a test can press: the drawing puts a `<canvas>` over the middle, and that
    // takes the pointer events for itself. In the sheet, the whole sheet is.
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel="Jarvis. Press and hold for ElevenLabs settings."
      style={inSheet ? styles.sheetContent : styles.screen}
      onLongPress={ON_A_PHONE ? onEditSettings : undefined}
      testID="conversation"
    >
      {gone ? null : (
        <View style={{ width: hologramSize, height: hologramSize }} testID="hologram">
          {settled ? (
            <JarvisHologram
              size={hologramSize}
              voice={voice}
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
        The other way in, wherever there is a conversation to type into — which is both platforms,
        and a live microphone as readily as a refused one. Only a `start` that never opened a
        session at all has none, and on a phone that is the refused microphone, which the line above
        has already explained.

        It leaves with him rather than before him, so the screen empties in one movement. A field
        left behind on a conversation that has ended is somewhere to type that nothing is listening
        to, which is worse than no field at all.
      */}
      {/*
        What he said, when saying it is not something he can do out loud. Never set outside the
        text-only session, so this is absent on every conversation that has a voice — which is the
        screen as designed, and why this is gated on the reply itself rather than on the platform.

        It goes when he goes, for the same reason the field does: an answer left on screen after
        the conversation carrying it has ended is the last thing he ever said, kept for ever.
      */}
      {writtenReply.shown && !gone ? <WrittenReplyLine reply={writtenReply.shown} /> : null}

      {canType && !gone ? (
        <TypedMessageField
          onSend={sendTypedMessage}
          enabled={status === 'connected'}
          opening={connectingUntil !== undefined}
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
