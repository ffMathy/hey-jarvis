import { createFramePacker, WAKE_FRAMES_PROCESSOR } from './pcm-frames';
import { createResampler, type Resampler } from './resampler';
import { CHUNK_SAMPLES, SAMPLE_RATE } from './wake-pipeline';

/**
 * The AudioWorklet processor that packs the microphone into the wake pipeline's frames.
 *
 * It runs on the audio thread, so it does as little as it can: float samples to int16 (and to
 * 16 kHz, if the context ignored the rate it was created with), 1280 at a time, posted straight
 * to the wake worker over the port the page hands it — never through the page's main thread,
 * which is drawing the room. No inference here: a worklet that takes too long glitches every
 * sound the page makes.
 *
 * Loaded by URL (`?worker&url` in `audio-graph.ts`), so Vite bundles it with its imports into
 * one module of its own, as it would a worker.
 */

// The AudioWorkletGlobalScope's own names, which TypeScript's DOM library does not declare.
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  abstract process(inputs: Float32Array[][]): boolean;
}

function framesPortOf(data: unknown): MessagePort | null | undefined {
  if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'frames-port') return undefined;
  if (!('port' in data)) return undefined;
  return data.port instanceof MessagePort ? data.port : null;
}

class WakeFramesProcessor extends AudioWorkletProcessor {
  private output: MessagePort | undefined;
  private readonly resampler: Resampler | undefined =
    sampleRate === SAMPLE_RATE ? undefined : createResampler(sampleRate, SAMPLE_RATE);
  private readonly packer = createFramePacker(CHUNK_SAMPLES, (frame) => {
    // Transferred, not copied: the packer never touches a frame again once it is full.
    this.output?.postMessage(frame, [frame.buffer]);
  });

  constructor() {
    super();
    this.port.onmessage = (event) => {
      const port = framesPortOf(event.data);
      if (port === undefined) return;
      this.output?.close();
      this.output = port ?? undefined;
    };
  }

  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    // No source connected, or no worker to send to yet: nothing to pack.
    if (channel === undefined || this.output === undefined) return true;
    if (this.resampler === undefined) {
      this.packer.push(channel);
    } else {
      this.resampler.push(channel, this.packer.pushSample);
    }
    return true;
  }
}

registerProcessor(WAKE_FRAMES_PROCESSOR, WakeFramesProcessor);
