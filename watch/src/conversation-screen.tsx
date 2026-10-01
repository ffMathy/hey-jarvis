import { type ElevenLabsSettings, isLive, WATCH_PARTICIPANT_NAME, WATCH_PARTICLE_COUNT } from 'hologram';
import { useJarvisSession } from 'hologram/conversation';
import { JarvisHologram } from 'hologram/react';
import { useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { type FastNetwork, holdFastNetwork, releaseFastNetwork } from '../modules/jarvis-network';
import { askThePhoneToAnswer, readPhoneServerAddress } from '../modules/jarvis-phone';
import { capCallVolume } from '../modules/jarvis-volume';
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
 * How long to wait for the phone to say whether it will hold the conversation in its earbuds.
 *
 * Longer than the phone gives its own window to come up (`WAIT_FOR_THE_WINDOW_MS` in
 * `JarvisWatchSummonService.kt`, two seconds) plus the round trip over Bluetooth, so the watch never
 * gives up on a phone that is about to say yes — which would be two of him talking. A phone with no
 * headset, or none in range, answers at once, so this is only ever waited out by a phone gone quiet.
 */
const ASK_THE_PHONE_MS = 3000;

/**
 * How loud he is on the watch's own speaker, as a share of its call volume.
 *
 * Full call volume carried across a room from the wrist. Nine tenths of the scale, in the watch's
 * own volume steps, is still plainly heard at arm's length. See `modules/jarvis-volume`.
 */
const CALL_VOLUME_SHARE = 0.9;

/**
 * What the deadline says when the watch could not get onto Wi-Fi or cellular: the likeliest reason,
 * and the one thing the person looking can change.
 */
const OFF_THE_PROXY_PROBLEM = 'Jarvis could not be reached. Put the watch on Wi-Fi.';

/** What it says when the watch was on a network that carries audio, and nobody answered anyway. */
const NO_ANSWER_PROBLEM = 'Jarvis did not answer. ElevenLabs may be unreachable.';

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
 * **The conversation is the phone's, and the headset's.** It is `hologram`'s session (see
 * `useJarvisSession` in `hologram/conversation`), with its rules: the greeting from the recording,
 * played inside the call's audio, and the session dialled after him; twenty seconds for it to open,
 * and a late one ended; failures said in words. What is the watch's is handed to it here: its name
 * in the history, getting off the phone's Bluetooth before the token, and what the deadline says.
 *
 * **His voice comes from the SDK's own analysers** rather than from a tap on the WebRTC track, and
 * that is a deliberate difference from the phone: the session is given no room check and no way to
 * follow his track, so it reads the SDK's readings. Tapping the track means a native module, a
 * peer-connection id and a ring buffer, and on a watch the readings the SDK gives are good enough
 * for a sphere this size.
 *
 * **He answers in the phone's earbuds when there are some.** Summoned on the wrist, he asks the
 * phone first, and a phone with AirPods connected holds the conversation itself, where only the
 * wearer hears it — the watch cannot play into a headset connected to its phone. The watch then says
 * so, and stays out of it. See `JarvisWatchSummonService.kt` in `mobile/modules/jarvis-assistant`.
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
  const isForeground = useIsForeground();
  // Read once: the phone hands it over with the credentials, which are read once too.
  const [serverAddress] = useState(readPhoneServerAddress);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  /** Whether the phone took this summoning, in its earbuds, so the watch holds no conversation. */
  const [onThePhone, setOnThePhone] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  /** What the conversation is being held over, so a failure can say whether that was the trouble. */
  const network = useRef<FastNetwork>('none');

  const conversation = useJarvisSession({
    settings,
    participantName: WATCH_PARTICIPANT_NAME,
    server: { address: serverAddress, device: 'watch' },
    // Every problem is the line over him: there is no toast on a watch, and no window to outlive.
    onProblem: (message: string) => setProblem(message),
    // Off the phone's Bluetooth proxy before anything goes out, token request included: WebRTC's
    // audio does not get through it, which is why the watch used to connect and then say nothing.
    // Asked once he has started greeting, so the network comes up while he speaks. See
    // `modules/jarvis-network`.
    untilOnline: async () => {
      network.current = await holdFastNetwork(WAIT_FOR_FAST_NETWORK_MS);
    },
    // The radio goes when the conversation does: a network held up for nobody is a battery spent
    // on nothing. The session says when, including for a conversation that ended while the
    // network was still coming up.
    leaveNetwork: releaseFastNetwork,
    // Naming Wi-Fi when the watch could not get onto it, since that is then the likeliest reason
    // and the one thing the person looking can change.
    deadlineProblem: () => (network.current === 'none' ? OFF_THE_PROXY_PROBLEM : NO_ANSWER_PROBLEM),
  });
  const { status, summon, endQuietly } = conversation;
  const size = useWatchHologramSize();
  // Handing these over is what turns the density loop on at all — the drawing skips it
  // entirely when there is nowhere to write the frame rate. See `watch-density.ts`.
  const { frameRate, buildMilliseconds, particleShare, provenShare, pace } = useWatchDensity();

  const start = useCallback(async () => {
    setProblem(undefined);
    setOnThePhone(false);
    setIsStarting(true);

    try {
      // Before anything is played or recorded here: a phone with AirPods in keeps the conversation
      // off the watch's speaker altogether.
      if (await askThePhoneToAnswer(ASK_THE_PHONE_MS)) {
        setOnThePhone(true);
        return;
      }

      // On a watch a refusal is the end of it. The phone falls back to a text field in a browser,
      // where there is a keyboard in front of you; here the assistant gesture *is* the request to
      // be talked to, and there is nowhere to type.
      if (!(await requestMicrophoneAccess())) {
        setProblem('Jarvis needs the microphone.');
        return;
      }

      // Down from full call volume before he says a word, greeting included. He then answers at
      // once, from a recording, and the network and the token are got while he says it; the
      // session waits for him to finish before it dials, since starting it switches the watch into
      // call audio, which clipped the recording and turned it into a voice that was not his.
      capCallVolume(CALL_VOLUME_SHARE);
      summon();
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      setIsStarting(false);
    }
  }, [summon]);

  // And on the way out of the app altogether, whatever state it was in.
  useEffect(() => () => releaseFastNetwork(), []);

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
      // The wrist dropped: he stops, rather than finishing the greeting into a sleeve, and the
      // conversation and the network go with him.
      endQuietly();
      releaseFastNetwork();
      return;
    }
    if (tried.current || isLive(status) || isStarting) {
      return;
    }
    tried.current = true;
    void start();
  }, [isForeground, endQuietly, start, status, isStarting]);

  return (
    <View style={styles.screen}>
      <View accessible accessibilityLabel="Jarvis" style={{ width: size, height: size }} testID="hologram">
        <JarvisHologram
          size={size}
          voice={conversation.voice}
          user={conversation.user}
          thinking={conversation.thinking}
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

      {onThePhone ? (
        <Text style={styles.onThePhone} testID="conversation-on-the-phone">
          Jarvis is answering on your phone.
        </Text>
      ) : null}

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
  /** Where the problem line would be, in the colour of him rather than of something wrong. */
  onThePhone: {
    position: 'absolute',
    left: 24,
    right: 24,
    color: '#38bdf8',
    textAlign: 'center',
    fontSize: 13,
  },
});
