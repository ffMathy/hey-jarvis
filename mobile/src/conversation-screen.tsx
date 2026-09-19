import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import * as Linking from 'expo-linking';
import {
  type ElevenLabsSettings,
  PARTICLE_COUNT,
  PHONE_PARTICIPANT_NAME,
  requestConversationToken,
  requestSignedConversationUrl,
} from 'hologram';
import { useToolActivity } from 'hologram/conversation';
import { LEAVING_SECONDS } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { dismissAssistantWindow } from '../modules/jarvis-assistant';
import { createAssistLaunchClaim } from './assist-link';
import { afterStatus, isLive, NOT_YET_OPEN } from './conversation-life';
import { FrameRate } from './frame-rate';
import { useWholeScreenHologramSize } from './hologram-size';
import { JarvisHologram } from './jarvis-hologram';
import { useJarvisVoice } from './jarvis-voice';
import { requestMicrophoneAccess } from './microphone-permission';
import { usePreferredHeadset } from './preferred-microphone';
import { useQueuedAudio } from './queued-audio';
import { useSparkDensity } from './spark-density';
import { QUIETEST_SPEECH_HERE } from './speech-floor';
import { theme } from './theme';
import { TypedMessageField } from './typed-message-field';

interface ConversationScreenProps {
  settings: ElevenLabsSettings;
  onEditSettings: () => void;
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
 * fewer than it could manage and on a slow one more.
 */
export function ConversationScreen({ settings, onEditSettings }: ConversationScreenProps) {
  const { startSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const voice = useJarvisVoice();
  const hologramSize = useWholeScreenHologramSize();
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
   * When to stop waiting for the conversation to open, or `undefined` once nothing is waited for.
   *
   * A moment rather than a countdown, so that anything which re-arms the wait — the status moving
   * from `disconnected` to `connecting`, say — re-arms it with the time that is actually left
   * rather than starting the twenty seconds again.
   */
  const [connectingUntil, setConnectingUntil] = useState<number | undefined>(undefined);

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

  const start = useCallback(async () => {
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
          ...toolHandlers,
        });
      }
      setCanType(true);
    } catch (error: unknown) {
      reportProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      setIsStarting(false);
    }
  }, [settings, startSession, toolHandlers, playbackHandlers, reportProblem, reportEnding]);

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
   * a browser there is none, `dismissAssistantWindow` says so, and the screen simply stays, dark
   * and still reachable by a long press. The same two ways out sample mode has; see its `finish`.
   */
  useEffect(() => {
    if (gone) {
      dismissAssistantWindow();
    }
  }, [gone]);

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

  return (
    // The whole screen is the way into settings, not just the sphere. A long press has to land
    // somewhere, and on a screen with one round thing on it and nothing else, "somewhere" should
    // not mean "on the round thing" — most of what you would press is the dark around him. It is
    // also the only part a test can press: the drawing puts a `<canvas>` over the middle, and that
    // takes the pointer events for itself.
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel="Jarvis. Press and hold for ElevenLabs settings."
      style={styles.screen}
      onLongPress={ON_A_PHONE ? onEditSettings : undefined}
      testID="conversation"
    >
      {gone ? null : (
        <View style={{ width: hologramSize, height: hologramSize }} testID="hologram">
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
          />
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
      {canType && !gone ? (
        <TypedMessageField
          onSend={sendUserMessage}
          enabled={status === 'connected'}
          opening={connectingUntil !== undefined}
        />
      ) : null}

      {/*
        The instrument, left running in a browser and nowhere else.

        On a phone this screen is the assistant and has nothing on it at all; in a browser it is
        where the drawing is developed, and knowing what it is managing is worth a line of text so
        dark you have to look for it. `faint` is what makes it that.

        It goes with him. An instrument reporting on a drawing that is no longer being drawn
        reports the last numbers it ever wrote, for ever, which is worse than reporting nothing.
      */}
      {ON_A_PHONE || gone ? null : (
        <FrameRate
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          particles={PARTICLE_COUNT}
          faint
        />
      )}

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
