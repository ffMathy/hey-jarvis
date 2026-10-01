import { describe, expect, it } from 'bun:test';
import {
  CHUNK_SAMPLES,
  createWakePipeline,
  EMBEDDING_SIZE,
  EMBEDDING_WINDOW_FRAMES,
  FEATURE_EMBEDDINGS,
  MEL_BINS,
  melFrameCount,
  WARM_UP_SAMPLES,
  type WakeModels,
  warmUpNoise,
  warmUpWindowStarts,
} from './wake-pipeline';

/**
 * The pipeline's bookkeeping, against fake graphs that say what they were given.
 *
 * The fake melspectrogram returns frames whose transformed value names the call and the row
 * (call × 100 + row), the fake embedding returns 96 copies of its call number, and the fake
 * classifier returns a fixed score — so each test can read exactly which frames reached which
 * embedding and which embeddings reached the classifier. `real-models.spec.ts` checks the same
 * pipeline against the real graphs.
 */

const SCORE = 0.75;

interface Calls {
  mel: Float32Array[];
  embed: Float32Array[];
  classify: Float32Array[];
}

function fakeModels(): { models: WakeModels; calls: Calls } {
  const calls: Calls = { mel: [], embed: [], classify: [] };
  // Counted apart from the recorded calls, so a test can clear those without renumbering.
  let melCalls = 0;
  let embedCalls = 0;
  const models: WakeModels = {
    async melspectrogram(samples) {
      calls.mel.push(samples);
      melCalls++;
      const frames = melFrameCount(samples.length);
      const output = new Float32Array(frames * MEL_BINS);
      for (let row = 0; row < frames; row++) {
        // The inverse of openWakeWord's x / 10 + 2, so the pipeline's transform yields the tag.
        const tag = melCalls * 100 + row;
        output.fill((tag - 2) * 10, row * MEL_BINS, (row + 1) * MEL_BINS);
      }
      return output;
    },
    async embed(window) {
      calls.embed.push(window);
      embedCalls++;
      return new Float32Array(EMBEDDING_SIZE).fill(embedCalls);
    },
    async classify(features) {
      calls.classify.push(features);
      return SCORE;
    },
  };
  return { models, calls };
}

/** The first value of each of a window's rows. */
function rowTags(window: Float32Array) {
  return Array.from({ length: window.length / MEL_BINS }, (_, row) => window[row * MEL_BINS]);
}

/** The first value of each embedding in the classifier's input. */
function embeddingTags(features: Float32Array) {
  return Array.from({ length: features.length / EMBEDDING_SIZE }, (_, index) => features[index * EMBEDDING_SIZE]);
}

function chunkOf(value: number) {
  return new Int16Array(CHUNK_SAMPLES).fill(value);
}

function rampChunk(offset: number) {
  return Int16Array.from({ length: CHUNK_SAMPLES }, (_, index) => offset + index);
}

async function warmedPipeline() {
  const fake = fakeModels();
  const pipeline = createWakePipeline(fake.models, () => 0.5);
  await pipeline.warmUp();
  fake.calls.mel.length = 0;
  fake.calls.embed.length = 0;
  return { pipeline, ...fake };
}

describe('the melspectrogram frame count', () => {
  it('is one 512-sample window every 160 samples', () => {
    expect(melFrameCount(1280)).toBe(5);
    expect(melFrameCount(1760)).toBe(8);
    expect(melFrameCount(WARM_UP_SAMPLES)).toBe(397);
    expect(melFrameCount(511)).toBe(0);
  });
});

describe('the warm-up', () => {
  it('is 4 s of integer noise in [-1000, 1000)', () => {
    const lowest = warmUpNoise(() => 0);
    const highest = warmUpNoise(() => 0.999999);
    expect(lowest).toHaveLength(64000);
    expect(lowest.every((sample) => sample === -1000)).toBe(true);
    expect(highest.every((sample) => sample === 999)).toBe(true);
  });

  it('embeds only the last 16 of the windows the Python package would', () => {
    const starts = warmUpWindowStarts(397);
    expect(starts).toHaveLength(FEATURE_EMBEDDINGS);
    expect(starts[0]).toBe(200);
    expect(starts.at(-1)).toBe(320);
    expect(starts.every((start, index) => index === 0 || start - starts[index - 1] === 8)).toBe(true);
  });

  it('runs the melspectrogram once over the whole noise, then embeds its windows', async () => {
    const { models, calls } = fakeModels();
    await createWakePipeline(models, () => 0.25).warmUp();
    expect(calls.mel).toHaveLength(1);
    expect(calls.mel[0]).toHaveLength(WARM_UP_SAMPLES);
    expect(calls.mel[0][0]).toBe(-500);
    expect(calls.embed).toHaveLength(FEATURE_EMBEDDINGS);
    // The first window starts at frame 200 of the noise's (call 1's) frames.
    expect(rowTags(calls.embed[0])[0]).toBe(100 + 200);
    expect(rowTags(calls.embed[15]).at(-1)).toBe(100 + 320 + EMBEDDING_WINDOW_FRAMES - 1);
  });

  it('refuses audio before it has run', async () => {
    const pipeline = createWakePipeline(fakeModels().models);
    await expect(pipeline.push(chunkOf(0))).rejects.toThrow('has not warmed up');
    expect(() => pipeline.reset()).toThrow('has not warmed up');
  });
});

describe('a chunk through the pipeline', () => {
  it('reaches the melspectrogram at int16 scale, alone the first time', async () => {
    const { pipeline, calls } = await warmedPipeline();
    await pipeline.push(chunkOf(1234));
    expect(calls.mel[0]).toHaveLength(CHUNK_SAMPLES);
    expect(calls.mel[0][0]).toBe(1234);
  });

  it('carries the previous chunk’s last 480 samples into the next melspectrogram', async () => {
    const { pipeline, calls } = await warmedPipeline();
    await pipeline.push(rampChunk(0));
    await pipeline.push(rampChunk(5000));
    const second = calls.mel[1];
    expect(second).toHaveLength(480 + CHUNK_SAMPLES);
    expect(second[0]).toBe(CHUNK_SAMPLES - 480);
    expect(second[479]).toBe(CHUNK_SAMPLES - 1);
    expect(second[480]).toBe(5000);
  });

  it('embeds the last 76 transformed frames, starting from a buffer of ones', async () => {
    const { pipeline, calls } = await warmedPipeline();
    await pipeline.push(chunkOf(1));
    // The warm-up was mel call 1, so this chunk is call 2: five new frames after 71 ones.
    const first = rowTags(calls.embed[0]);
    expect(first).toHaveLength(EMBEDDING_WINDOW_FRAMES);
    expect(first.slice(0, 71).every((value) => value === 1)).toBe(true);
    expect(first.slice(71)).toEqual([200, 201, 202, 203, 204]);

    await pipeline.push(chunkOf(1));
    const second = rowTags(calls.embed[1]);
    expect(second.slice(0, 63).every((value) => value === 1)).toBe(true);
    expect(second.slice(63)).toEqual([200, 201, 202, 203, 204, 300, 301, 302, 303, 304, 305, 306, 307]);
  });

  it('hands the classifier the last 16 embeddings, oldest first', async () => {
    const fake = fakeModels();
    const pipeline = createWakePipeline(fake.models, () => 0.5);
    await pipeline.warmUp();
    await pipeline.push(chunkOf(1));
    // Warm-up embeddings 2 to 16, then the chunk's, which is the 17th embedding made.
    expect(embeddingTags(fake.calls.classify[0])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    for (let chunk = 0; chunk < 20; chunk++) await pipeline.push(chunkOf(1));
    expect(embeddingTags(fake.calls.classify[20])).toEqual([
      22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
    ]);
  });

  it('silences the first five scores, then passes the classifier’s on', async () => {
    const { pipeline } = await warmedPipeline();
    const scores: number[] = [];
    for (let chunk = 0; chunk < 7; chunk++) scores.push(await pipeline.push(chunkOf(1)));
    expect(scores).toEqual([0, 0, 0, 0, 0, SCORE, SCORE]);
  });

  it('refuses a chunk of the wrong length', async () => {
    const { pipeline } = await warmedPipeline();
    await expect(pipeline.push(new Int16Array(128))).rejects.toThrow('1280 samples');
  });
});

describe('a reset', () => {
  it('starts again from the warm-up: no context, ones, the warm-up embeddings, five silenced scores', async () => {
    const fake = fakeModels();
    const pipeline = createWakePipeline(fake.models, () => 0.5);
    await pipeline.warmUp();
    for (let chunk = 0; chunk < 8; chunk++) await pipeline.push(chunkOf(1));
    pipeline.reset();
    fake.calls.mel.length = 0;
    fake.calls.embed.length = 0;
    fake.calls.classify.length = 0;

    const score = await pipeline.push(chunkOf(1));
    expect(score).toBe(0);
    expect(fake.calls.mel[0]).toHaveLength(CHUNK_SAMPLES);
    expect(
      rowTags(fake.calls.embed[0])
        .slice(0, 71)
        .every((value) => value === 1),
    ).toBe(true);
    expect(embeddingTags(fake.calls.classify[0]).slice(0, 15)).toEqual([
      2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });
});
