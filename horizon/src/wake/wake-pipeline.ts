/**
 * openWakeWord's streaming pipeline, ported from its Python package.
 *
 * Three graphs run one after another on every 80 ms of audio: a melspectrogram, an embedding
 * of the last 76 mel frames, and the "hey jarvis" classifier over the last 16 embeddings. The
 * graphs are the easy part; what makes a port hear anything is the bookkeeping between them, and
 * two of the four JavaScript ports the research read got it wrong — one scored 0.003 on a clip
 * the Python package scores 0.995. So everything here follows `openwakeword/utils.py` and
 * `model.py` at 368c037 exactly, and was checked frame by frame against them (the research's
 * `port.mjs`; `real-models.spec.ts` holds this module to the same clips):
 *
 * - Samples stay at int16 scale, cast to float but never divided down to ±1 (`utils.py:199`).
 * - Each chunk is sent to the melspectrogram with the 480 samples before it, which gives 8 mel
 *   frames per chunk; without that context it gives 5, and the embeddings run at the wrong
 *   speed (`utils.py:397`). That was the fatal mistake in the broken ports.
 * - Mel frames are transformed `x / 10 + 2` (`utils.py:180`), and the mel buffer starts as 76
 *   frames of ones (`utils.py:163`).
 * - One embedding per chunk, from the last 76 mel frames (`utils.py:437-443`).
 * - The classifier sees the last 16 embeddings. Before any audio those are embeddings of 4 s of
 *   uniform noise in [-1000, 1000) (`utils.py:169`), not zeros.
 * - The first 5 predictions after a reset are forced to 0 (`model.py:330-333`).
 *
 * The graphs themselves are behind `WakeModels`, so this runs the same against onnxruntime-web
 * in the worker and against a fake in the unit tests.
 */

/** The only rate openWakeWord's models were trained at. */
export const SAMPLE_RATE = 16000;

/** Samples in one chunk: 80 ms, the step openWakeWord's features are built on. */
export const CHUNK_SAMPLES = 1280;

/** How much of the previous chunk goes into each melspectrogram, so frames straddle the seam. */
export const MEL_CONTEXT_SAMPLES = 480;

/** Mel bins per frame. */
export const MEL_BINS = 32;

/** Mel frames one embedding looks at. */
export const EMBEDDING_WINDOW_FRAMES = 76;

/** Mel frames between embeddings: one chunk's worth, 8 frames of 10 ms. */
export const EMBEDDING_STEP_FRAMES = 8;

/** Values in one embedding. */
export const EMBEDDING_SIZE = 96;

/** Embeddings the classifier looks at: its input is 16 × 96. */
export const FEATURE_EMBEDDINGS = 16;

/** Predictions forced to 0 after a reset, as the Python package does. */
export const SILENCED_PREDICTIONS = 5;

/** The warm-up noise: 4 s of it. */
export const WARM_UP_SAMPLES = 4 * SAMPLE_RATE;

/** The warm-up noise is uniform in [-this, this). */
export const WARM_UP_NOISE_AMPLITUDE = 1000;

/** The three graphs, as the pipeline calls them. Every array returned must be the caller's to keep. */
export interface WakeModels {
  /**
   * Mel frames for int16-scale samples: frames × `MEL_BINS` values, row after row, exactly as the
   * graph returns them (before the `x / 10 + 2` transform, which is the pipeline's).
   */
  melspectrogram(samples: Float32Array): Promise<Float32Array>;
  /** One `EMBEDDING_SIZE` embedding of `EMBEDDING_WINDOW_FRAMES` × `MEL_BINS` transformed frames. */
  embed(window: Float32Array): Promise<Float32Array>;
  /** The wake score, 0–1, for `FEATURE_EMBEDDINGS` × `EMBEDDING_SIZE` values. */
  classify(features: Float32Array): Promise<number>;
}

export interface WakePipeline {
  /**
   * Computes the warm-up embeddings from fresh noise and resets onto them. Runs every graph, so
   * it is also what proves the models work before any microphone is involved.
   */
  warmUp(): Promise<void>;
  /** Back to the state right after warming up: buffers refilled, the first predictions silenced. */
  reset(): void;
  /** Feeds one chunk of exactly `CHUNK_SAMPLES` samples and resolves its wake score. */
  push(chunk: Int16Array): Promise<number>;
}

/** Frames the melspectrogram graph returns for `samples` samples: a 512-sample window every 160. */
export function melFrameCount(samples: number) {
  return samples < 512 ? 0 : Math.floor((samples - 512) / 160) + 1;
}

/** openWakeWord's transform of the graph's decibels into what the embedding model was trained on. */
function transformMel(raw: Float32Array) {
  const transformed = new Float32Array(raw.length);
  for (let index = 0; index < raw.length; index++) transformed[index] = raw[index] / 10 + 2;
  return transformed;
}

/** `WARM_UP_SAMPLES` of uniform integer noise in [-amplitude, amplitude), as `np.random.randint` draws it. */
export function warmUpNoise(random: () => number) {
  const noise = new Int16Array(WARM_UP_SAMPLES);
  for (let index = 0; index < noise.length; index++) {
    noise[index] = Math.floor(random() * 2 * WARM_UP_NOISE_AMPLITUDE) - WARM_UP_NOISE_AMPLITUDE;
  }
  return noise;
}

/**
 * Where each warm-up window starts in the noise's mel frames, keeping only the last
 * `FEATURE_EMBEDDINGS` of them.
 *
 * The Python package embeds every window (41 of them for 4 s) and keeps up to 120 embeddings,
 * but the classifier only ever reads the last 16, and after 16 chunks of real audio none of the
 * noise is among them. So embedding the last 16 windows gives the same scores, for 16 embedding
 * runs instead of 41 — the most expensive graph, on the 2D page's progress bar.
 */
export function warmUpWindowStarts(frames: number) {
  const starts: number[] = [];
  for (let start = 0; start + EMBEDDING_WINDOW_FRAMES <= frames; start += EMBEDDING_STEP_FRAMES) starts.push(start);
  return starts.slice(-FEATURE_EMBEDDINGS);
}

function checkWarmUp(embeddings: Float32Array[]) {
  if (embeddings.length < FEATURE_EMBEDDINGS) {
    throw new Error(`The warm-up made ${embeddings.length} embeddings; the classifier needs ${FEATURE_EMBEDDINGS}.`);
  }
}

export function createWakePipeline(models: WakeModels, random: () => number = Math.random): WakePipeline {
  let warmUpEmbeddings: Float32Array[] | undefined;
  // The last 76 transformed mel frames, oldest first, as one block the embedding reads directly.
  const melWindow = new Float32Array(EMBEDDING_WINDOW_FRAMES * MEL_BINS);
  // The end of the previous chunk: the melspectrogram's context for the next one.
  let context = new Int16Array(0);
  let features: Float32Array[] = [];
  let predictions = 0;

  function reset() {
    if (warmUpEmbeddings === undefined) throw new Error('The wake pipeline has not warmed up.');
    melWindow.fill(1);
    context = new Int16Array(0);
    // The embeddings are never written to, so the arrays can be shared with every reset.
    features = warmUpEmbeddings.slice(-FEATURE_EMBEDDINGS);
    predictions = 0;
  }

  function appendMelFrames(frames: Float32Array) {
    const keep = Math.max(0, melWindow.length - frames.length);
    melWindow.copyWithin(0, melWindow.length - keep);
    melWindow.set(frames.subarray(Math.max(0, frames.length - melWindow.length)), keep);
  }

  async function melFramesOf(samples: Int16Array) {
    return transformMel(await models.melspectrogram(Float32Array.from(samples)));
  }

  async function warmUp() {
    const frames = await melFramesOf(warmUpNoise(random));
    const embeddings: Float32Array[] = [];
    for (const start of warmUpWindowStarts(frames.length / MEL_BINS)) {
      const window = frames.slice(start * MEL_BINS, (start + EMBEDDING_WINDOW_FRAMES) * MEL_BINS);
      embeddings.push(await models.embed(window));
    }
    checkWarmUp(embeddings);
    warmUpEmbeddings = embeddings;
    reset();
  }

  async function push(chunk: Int16Array) {
    if (warmUpEmbeddings === undefined) throw new Error('The wake pipeline has not warmed up.');
    if (chunk.length !== CHUNK_SAMPLES) {
      throw new Error(`A wake chunk has ${CHUNK_SAMPLES} samples, not ${chunk.length}.`);
    }
    const joined = new Int16Array(context.length + chunk.length);
    joined.set(context);
    joined.set(chunk, context.length);
    context = chunk.slice(-MEL_CONTEXT_SAMPLES);

    appendMelFrames(await melFramesOf(joined));
    features = [...features.slice(1 - FEATURE_EMBEDDINGS), await models.embed(melWindow.slice())];

    const input = new Float32Array(FEATURE_EMBEDDINGS * EMBEDDING_SIZE);
    for (const [index, embedding] of features.entries()) input.set(embedding, index * EMBEDDING_SIZE);
    const score = await models.classify(input);
    predictions++;
    return predictions <= SILENCED_PREDICTIONS ? 0 : score;
  }

  return { warmUp, reset, push };
}
