import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { EMBEDDING_SIZE, MEL_BINS, type WakeModels } from './wake-pipeline';

/**
 * openWakeWord's three graphs on onnxruntime-web's WebAssembly backend.
 *
 * The wasm-only entry, never the package's main one: that one brings the WebGPU/WebNN build,
 * whose wasm is twice the size, for nothing these small graphs could use (and WebGL cannot run
 * the melspectrogram graph at all). Single-threaded, because threads need a cross-origin-isolated
 * page, which GitHub Pages cannot serve, and the three graphs take about 8 ms per 80 ms chunk on
 * one core of a 2017 laptop anyway.
 */

/** The committed model files' bytes, as the worker downloaded them (or a test read them). */
export interface WakeModelBytes {
  melspectrogram: Uint8Array;
  embedding: Uint8Array;
  wakeWord: Uint8Array;
}

/** Where onnxruntime-web finds its runtime, when it is not left to find it itself. */
export interface OrtRuntimeLocation {
  /** Absolute URL of the folder holding `ort-wasm-simd-threaded.mjs`, its Emscripten glue. */
  wasmPaths: string;
  /** The runtime's wasm, already downloaded, so onnxruntime-web does not fetch it a second time. */
  wasmBinary: Uint8Array;
}

// The graphs' input and output names, read from the models themselves (the research's
// `inspect.mjs`); they are part of the files the model spec pins by hash.
const MEL_INPUT = 'input';
const MEL_OUTPUT = 'output';
const EMBEDDING_INPUT = 'input_1';
const EMBEDDING_OUTPUT = 'conv2d_19';
const WAKE_WORD_INPUT = 'x.1';
const WAKE_WORD_OUTPUT = '53';

const SESSION_OPTIONS: InferenceSession.SessionOptions = {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
};

/**
 * Sets onnxruntime-web up before its first session.
 *
 * In the browser the app builds onnxruntime-web with the `onnxruntime-web-use-extern-wasm`
 * condition (see `vite.config.ts`), which leaves the runtime's glue out of the bundle, so it has
 * to be told where the glue is — the site's own `vendor/`, where `turbo initialize` copies it —
 * and is handed the wasm the worker already downloaded for its progress bar. Under `bun test` the
 * default entry carries its glue inline and finds its wasm beside itself in `node_modules`, and
 * giving it a location there would send it looking in the wrong place; so a location is optional.
 */
export function configureOrtRuntime(location?: OrtRuntimeLocation) {
  env.wasm.numThreads = 1;
  if (location !== undefined) {
    env.wasm.wasmPaths = location.wasmPaths;
    env.wasm.wasmBinary = location.wasmBinary;
  }
}

function tensorOutput(outputs: InferenceSession.OnnxValueMapType, name: string) {
  const output = outputs[name];
  if (output === undefined) throw new Error(`The wake-word graph returned no "${name}".`);
  // A copy, and the tensor released: onnxruntime-web may hand back views it reuses, and the
  // pipeline keeps embeddings for 16 chunks (the research's pitfall 7).
  const data = output.data;
  if (!(data instanceof Float32Array)) throw new Error(`The wake-word graph's "${name}" is not float32.`);
  const copy = data.slice();
  output.dispose();
  return copy;
}

/**
 * Loads the three graphs and wraps them in the pipeline's interface.
 *
 * One after another rather than together: the first session initialises the WebAssembly
 * runtime, and onnxruntime-web throws if that is asked for twice at once.
 */
export async function createOrtWakeModels(bytes: WakeModelBytes): Promise<WakeModels> {
  const melspectrogram = await InferenceSession.create(bytes.melspectrogram, SESSION_OPTIONS);
  const embedding = await InferenceSession.create(bytes.embedding, SESSION_OPTIONS);
  const wakeWord = await InferenceSession.create(bytes.wakeWord, SESSION_OPTIONS);

  return {
    async melspectrogram(samples) {
      const input = new Tensor('float32', samples, [1, samples.length]);
      return tensorOutput(await melspectrogram.run({ [MEL_INPUT]: input }), MEL_OUTPUT);
    },
    async embed(window) {
      const input = new Tensor('float32', window, [1, window.length / MEL_BINS, MEL_BINS, 1]);
      return tensorOutput(await embedding.run({ [EMBEDDING_INPUT]: input }), EMBEDDING_OUTPUT);
    },
    async classify(features) {
      const input = new Tensor('float32', features, [1, features.length / EMBEDDING_SIZE, EMBEDDING_SIZE]);
      const [score] = tensorOutput(await wakeWord.run({ [WAKE_WORD_INPUT]: input }), WAKE_WORD_OUTPUT);
      if (score === undefined) throw new Error('The wake-word graph returned no score.');
      return score;
    },
  };
}
