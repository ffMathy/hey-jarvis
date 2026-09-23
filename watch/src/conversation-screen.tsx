import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import {
  type ElevenLabsSettings,
  requestConversationToken,
  WATCH_PARTICIPANT_NAME,
  WATCH_PARTICLE_COUNT,
} from 'hologram';
import { useAgentVoice, useGreeting, useToolActivity, useUserVoice } from 'hologram/conversation';
import { JarvisHologram } from 'hologram/react';
import { useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type FastNetwork, holdFastNetwork, releaseFastNetwork } from '../modules/jarvis-network';
import { requestMicrophoneAccess } from './microphone-permission';
import { useWatchDensity } from './watch-density';
import { useWatchHologramSize } from './watch-screen';

interface ConversationScreenProps {
  /** The credentials the phone handed over. There is no conversation without them. */
  settings: ElevenLabsSettings;
}

/**
 * How long to wait for Wi-Fi or cellular to come up before trying the conversation anyway.
 *
 * Bringing Wi-Fi up from off takes a few seconds on a watch; already up, the answer is immediate.
 * Past this the conversation goes ahead on whatever there is, since a slow start is better than
 * none — and if that is the Bluetooth proxy, the line below says what to do about it.
 */
const WAIT_FOR_FAST_NETWORK_MS = 6000;

/**
 * How long a conversation may take to open before the screen says it has not.
 *
 * The phone's reason, from `GIVE_UP_CONNECTING_AFTER_MS` in `mobile/src/conversation-screen.tsx`:
 * a WebRTC session that cannot finish coming up waits on a room event with no deadline of its
 * own, and says nothing while it does. On a watch that is exactly what the Bluetooth proxy
 * produces, and a sphere turning in silence is indistinguishable from one listening.
 */
const GIVE_UP_CONNECTING_AFTER_MS = 20_000;

/** Whether a conversation is open, or on its way to being open. */
function isLive(status: string): boolean {
  return status === 'connected' || status === 'connecting';
}

/**
 * Jarvis answering on the wrist: the sphere, and nothing else on the screen.
 *
 * The same argument as the phone's conversation screen, only more so. There is no button, no
 * status line and no title, because you do not press a button to talk to someone who is already
 * listening — the conversation opens by itself the moment the screen does, and what tells you
 * which of you is talking is what the sphere is doing. On a round screen 45 mm across there is
 * also nowhere to put any of it.
 *
 * What is left when something goes wrong is one line over the top of him, because an assistant
 * that has silently failed to connect looks exactly like one that is listening.
 *
 * **His voice comes from the SDK's own analysers** rather than from a tap on the WebRTC track, and
 * that is a deliberate difference from the phone. See `useAgentVoice` in `hologram/conversation`:
 * tapping the track means a native module, a peer-connection id and a ring buffer, and on a watch
 * the readings the SDK gives are good enough for a sphere this size.
 *
 * **It ends when the wrist drops, and that is the difference that matters most from the phone.** A
 * phone conversation survives the app going to the background — the assistant's window is retracted
 * instead, and the user is still in it. A watch has no such thing: the screen goes off a few
 * seconds after you stop looking, and a session left open then is a microphone left open in
 * somebody's sleeve, on a battery measured in hours. So the conversation follows the foreground,
 * which also makes raising the wrist again the one retry this screen has — and the only one it
 * needs, since a conversation that failed to open failed for a reason, and hammering ElevenLabs
 * until one of those reasons changes would be rude to them and useless to whoever is looking.
 */
export function ConversationScreen({ settings }: ConversationScreenProps) {
  const { startSession, endSession } = useConversationControls();
  const { status } = useConversationStatus();
  const isForeground = useIsForeground();
  const agentVoice = useAgentVoice();
  // "Hello sir, how can I help?", from a recording, while the session is dialled behind it — and
  // the sphere saying it with him. See `greeting.ts` in `hologram/conversation`.
  const { greeting, greetingVoice, beginGreeting, stopGreeting, greetingSessionOptions } = useGreeting();
  const voice = greeting ? greetingVoice : agentVoice;
  // Whoever is talking to him, for the sphere's listening animation. See `user-voice.ts`.
  const { user, userVoiceHandlers } = useUserVoice({ greeting });
  const size = useWatchHologramSize();
  // Handing these over is what turns the density loop on at all — the drawing skips it
  // entirely when there is nowhere to write the frame rate. See `watch-density.ts`.
  const { frameRate, buildMilliseconds, particleShare, provenShare, pace } = useWatchDensity();
  // What he is doing between hearing you and answering; the drawing has a whole state for it.
  const { thinking, toolHandlers, forgetToolCalls } = useToolActivity();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);
  /** What the conversation is being held over, so a failure can say whether that was the trouble. */
  const network = useRef<FastNetwork>('none');
  /** When to stop waiting for the conversation to open, or `undefined` once nothing is waited for. */
  const [connectingUntil, setConnectingUntil] = useState<number | undefined>(undefined);

  const reportProblem = useCallback((message: string) => {
    setConnectingUntil(undefined);
    setProblem(message);
  }, []);

  /**
   * A conversation the server closed, which the SDK reports here and not through `onError`. The
   * same gap the phone's `reportEnding` closes: without it the sphere simply stopped answering. An
   * agent that hung up after saying goodbye is `agent`, not `error`, and gets no line.
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

    try {
      // On a watch a refusal is the end of it. The phone falls back to a text field in a browser,
      // where there is a keyboard in front of you; here the assistant gesture *is* the request to
      // be talked to, and there is nowhere to type.
      if (!(await requestMicrophoneAccess())) {
        reportProblem('Jarvis needs the microphone.');
        return;
      }

      // He answers at once, from a recording, and everything below — the network, the token, the
      // session — happens while he says it. The session is told not to greet a second time and
      // keeps its microphone muted until he has finished, so it does not hear him through the
      // speaker a few centimetres away and take it for the wearer. A session slower than the
      // greeting goes on connecting exactly as it did before there was one.
      const greeted = await beginGreeting();

      // Off the phone's Bluetooth proxy before anything goes out, token request included: WebRTC's
      // audio does not get through it, which is why the watch used to connect and then say nothing.
      // See `modules/jarvis-network`.
      network.current = await holdFastNetwork(WAIT_FOR_FAST_NETWORK_MS);
      setConnectingUntil(Date.now() + GIVE_UP_CONNECTING_AFTER_MS);

      // Minted here rather than kept: a conversation token is short-lived, and one fetched when
      // the app opened may be dead by the time a wrist is raised.
      const { token } = await requestConversationToken({ settings, participantName: WATCH_PARTICIPANT_NAME });

      startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        onError: reportProblem,
        onDisconnect: reportEnding,
        ...toolHandlers,
        ...userVoiceHandlers,
        ...(greeted ? greetingSessionOptions : {}),
      });
    } catch (error: unknown) {
      // No session to hold the network for, so it goes now rather than when one ends.
      releaseFastNetwork();
      reportProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      setIsStarting(false);
    }
  }, [
    settings,
    startSession,
    beginGreeting,
    greetingSessionOptions,
    toolHandlers,
    userVoiceHandlers,
    reportProblem,
    reportEnding,
  ]);

  // Gives up on a conversation that is taking too long to open, and says so — naming Wi-Fi when the
  // watch could not get onto it, since that is then the likeliest reason and the one thing the
  // person looking can change.
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
        setProblem(
          network.current === 'none'
            ? 'Jarvis could not be reached. Put the watch on Wi-Fi.'
            : 'Jarvis did not answer. ElevenLabs may be unreachable.',
        );
      },
      Math.max(0, connectingUntil - Date.now()),
    );
    return () => clearTimeout(givingUp);
  }, [connectingUntil, status]);

  // The radio goes when the conversation does: a network held up for nobody is a battery spent on
  // nothing. On the way *down* from live rather than whenever it is not live, because between
  // `startSession` and the status reading `connecting` there is a render where it is neither — and
  // letting go then would pull the network out from under the call as it dialled.
  const wasLive = useRef(false);
  useEffect(() => {
    if (isLive(status)) {
      wasLive.current = true;
      return;
    }
    if (wasLive.current) {
      wasLive.current = false;
      releaseFastNetwork();
    }
  }, [status]);
  // And on the way out of the app altogether, whatever state it was in.
  useEffect(() => () => releaseFastNetwork(), []);

  // A call still running when the conversation drops never gets its answer, so the sphere would be
  // left mid-thought — and the next conversation would open with him already thinking about
  // something that stopped happening.
  useEffect(() => {
    if (!isLive(status)) {
      forgetToolCalls();
    }
  }, [status, forgetToolCalls]);

  /**
   * Opens the conversation while anyone is looking, and closes it when nobody is.
   *
   * Once per spell in the foreground. `tried` is a ref rather than state because it must not cause
   * a render and must not reset when one happens — two starts in flight at the same time is two
   * WebRTC sessions, and the second tears down the first — and it is cleared when the app goes
   * away, which is what makes raising the wrist again a genuine retry rather than a no-op.
   */
  const tried = useRef(false);
  useEffect(() => {
    if (!isForeground) {
      tried.current = false;
      setConnectingUntil(undefined);
      // The wrist dropped mid-greeting: he stops, rather than finishing it into a sleeve.
      stopGreeting();
      endSession();
      releaseFastNetwork();
      return;
    }
    if (tried.current || isLive(status) || isStarting) {
      return;
    }
    tried.current = true;
    void start();
  }, [isForeground, endSession, stopGreeting, start, status, isStarting]);

  return (
    <View style={styles.screen}>
      <View accessible accessibilityLabel="Jarvis" style={{ width: size, height: size }} testID="hologram">
        <JarvisHologram
          size={size}
          voice={voice}
          user={user}
          thinking={thinking}
          particleCount={WATCH_PARTICLE_COUNT}
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          provenShare={provenShare}
          pace={pace}
          opaque
          background="#000000"
        />
      </View>

      {problem ? (
        <Text style={styles.problem} testID="conversation-problem">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Black to the edges: on a round OLED screen the corners are neither lit nor shown. */
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    // The square is wider than the screen — see `watch-screen.ts` — and what hangs off it is not
    // something to scroll to.
    overflow: 'hidden',
  },
  /**
   * Over him rather than under him, because the sphere fills the screen.
   *
   * There is no room on a watch for a line below a square wider than the display, so the only
   * place a message can go is on top — and the only time there is one, he is not worth looking at
   * anyway.
   */
  problem: {
    position: 'absolute',
    left: 24,
    right: 24,
    color: '#f87171',
    textAlign: 'center',
    fontSize: 13,
  },
});
