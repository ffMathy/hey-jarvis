import { WAKE_FRAMES_PROCESSOR } from './pcm-frames';
import workletUrl from './pcm-frames.worklet.ts?worker&url';
import type { WakeAudioGraph } from './wake-engine';
import { SAMPLE_RATE } from './wake-pipeline';

/**
 * The wake word's audio graph: microphone → frame-packing worklet → silence → speakers.
 *
 * Its own AudioContext at 16 kHz, the only rate openWakeWord knows. Chromium — Quest Browser —
 * resamples the microphone into a context of any rate, properly filtered; a browser that ignores
 * the rate gets the worklet's own resampler instead. At 16 kHz one render quantum is 128 samples,
 * so ten of them are exactly one 80 ms chunk.
 *
 * The worklet feeds a gain of zero into the destination because Chromium only runs the nodes
 * the destination pulls on; nothing is ever heard. And the context is never suspended — resuming
 * one needs a gesture that the room may not have to give — so leaving the microphone is done by
 * disconnecting the source instead.
 */

export function createWakeAudioGraph(): WakeAudioGraph<MediaStream> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  // Asked for here, synchronously: this runs inside the gesture that starts listening, and
  // only while that gesture is running may the context start making sound.
  context.resume().catch(() => undefined);
  let node: AudioWorkletNode | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let failed = false;
  let pendingPort: MessagePort | undefined;
  const stateListeners: Array<() => void> = [];

  function handOver(worklet: AudioWorkletNode, port: MessagePort) {
    worklet.port.postMessage({ type: 'frames-port', port }, [port]);
  }

  const ready = context.audioWorklet.addModule(workletUrl).then(() => {
    const worklet = new AudioWorkletNode(context, WAKE_FRAMES_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // Mono in: a stereo capture is mixed down before the worklet ever sees it.
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
    });
    // A processor that throws is stopped for good; the watchdog sees the chunks stop and the
    // recovery builds a new graph.
    worklet.onprocessorerror = () => {
      failed = true;
    };
    const silence = context.createGain();
    silence.gain.value = 0;
    worklet.connect(silence).connect(context.destination);
    node = worklet;
    if (pendingPort !== undefined) handOver(worklet, pendingPort);
    pendingPort = undefined;
  });

  context.onstatechange = () => {
    for (const listener of stateListeners) listener();
  };

  return {
    get state() {
      return context.state;
    },
    get failed() {
      return failed;
    },
    ready,
    sendFramesTo(port) {
      if (node === undefined) {
        pendingPort = port;
      } else {
        handOver(node, port);
      }
    },
    listen(stream) {
      source?.disconnect();
      source = undefined;
      if (stream === undefined || node === undefined) return;
      source = context.createMediaStreamSource(stream);
      source.connect(node);
    },
    resume: () => context.resume(),
    onStateChange(listener) {
      stateListeners.push(listener);
    },
    close() {
      source?.disconnect();
      node?.port.postMessage({ type: 'frames-port', port: null });
      context.close().catch(() => undefined);
    },
  };
}
