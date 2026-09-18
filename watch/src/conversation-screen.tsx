import { useConversationControls, useConversationStatus } from '@elevenlabs/react-native';
import { type ElevenLabsSettings, requestConversationToken, WATCH_PARTICIPANT_NAME } from 'hologram';
import { useAgentVoice, useToolActivity } from 'hologram/conversation';
import { JarvisHologram } from 'hologram/react';
import { useIsForeground } from 'hologram/react/lifecycle';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { requestMicrophoneAccess } from './microphone-permission';
import { useWatchDensity, WATCH_PARTICLE_COUNT } from './watch-density';
import { useWatchHologramSize } from './watch-screen';

interface ConversationScreenProps {
  /** The credentials the phone handed over. There is no conversation without them. */
  settings: ElevenLabsSettings;
}

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
  const voice = useAgentVoice();
  const size = useWatchHologramSize();
  // Handing these over is what turns the density loop on at all — the drawing skips it
  // entirely when there is nowhere to write the frame rate. See `watch-density.ts`.
  const { frameRate, buildMilliseconds, particleShare, provenShare } = useWatchDensity();
  // What he is doing between hearing you and answering; the drawing has a whole state for it.
  const { thinking, toolHandlers, forgetToolCalls } = useToolActivity();
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isStarting, setIsStarting] = useState(false);

  const start = useCallback(async () => {
    setProblem(undefined);
    setIsStarting(true);

    try {
      // On a watch a refusal is the end of it. The phone falls back to a text field in a browser,
      // where there is a keyboard in front of you; here the assistant gesture *is* the request to
      // be talked to, and there is nowhere to type.
      if (!(await requestMicrophoneAccess())) {
        setProblem('Jarvis needs the microphone.');
        return;
      }

      // Minted here rather than kept: a conversation token is short-lived, and one fetched when
      // the app opened may be dead by the time a wrist is raised.
      const { token } = await requestConversationToken({ settings, participantName: WATCH_PARTICIPANT_NAME });

      startSession({
        conversationToken: token,
        connectionType: 'webrtc',
        onError: (message) => setProblem(message),
        ...toolHandlers,
      });
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Jarvis could not be reached.');
    } finally {
      setIsStarting(false);
    }
  }, [settings, startSession, toolHandlers]);

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
      endSession();
      return;
    }
    if (tried.current || isLive(status) || isStarting) {
      return;
    }
    tried.current = true;
    void start();
  }, [isForeground, endSession, start, status, isStarting]);

  return (
    <View style={styles.screen}>
      <View accessible accessibilityLabel="Jarvis" style={{ width: size, height: size }} testID="hologram">
        <JarvisHologram
          size={size}
          voice={voice}
          thinking={thinking}
          particleCount={WATCH_PARTICLE_COUNT}
          frameRate={frameRate}
          buildMilliseconds={buildMilliseconds}
          particleShare={particleShare}
          provenShare={provenShare}
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
  },
  /**
   * Over him rather than under him, because the sphere fills the screen.
   *
   * There is no room on a watch for a line below a square the width of the display, so the only
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
