import { beforeAll, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createDetectionGate } from './detection-gate';
import { readWavSamples } from './fixtures/wav';
import { configureOrtRuntime, createOrtWakeModels } from './ort-models';
import { CHUNK_SAMPLES, createWakePipeline, type WakeModels } from './wake-pipeline';

/**
 * The real models, through the real pipeline, on spoken clips.
 *
 * onnxruntime-web runs under Bun as it does in the browser's worker — the same wasm, the same
 * graphs — so this is the check that the port still hears "hey jarvis" the way openWakeWord's
 * Python package does. The expected scores are the Python package's own on these clips (see
 * fixtures/wav.ts). Offline: the models are the committed files.
 */

const MODELS_FOLDER = path.join(import.meta.dir, '../../public/models');

/** A seeded generator, so the warm-up noise — and so every score — is the same on every run. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

interface ClipResult {
  scores: number[];
  wakes: number[];
  highest: number;
  highestAt: number;
}

async function runClip(models: WakeModels, file: string): Promise<ClipResult> {
  const pipeline = createWakePipeline(models, seededRandom(7));
  await pipeline.warmUp();
  const gate = createDetectionGate();
  gate.arm();
  const samples = readWavSamples(file);
  const scores: number[] = [];
  const wakes: number[] = [];
  for (let start = 0; start + CHUNK_SAMPLES <= samples.length; start += CHUNK_SAMPLES) {
    const score = await pipeline.push(samples.subarray(start, start + CHUNK_SAMPLES));
    if (gate.observe(score)) wakes.push(scores.length);
    scores.push(score);
  }
  const highest = Math.max(...scores);
  return { scores, wakes, highest, highestAt: scores.indexOf(highest) };
}

describe('the wake word on the real models', () => {
  let models: WakeModels;

  beforeAll(async () => {
    configureOrtRuntime();
    models = await createOrtWakeModels({
      melspectrogram: readFileSync(path.join(MODELS_FOLDER, 'melspectrogram.onnx')),
      embedding: readFileSync(path.join(MODELS_FOLDER, 'embedding_model.onnx')),
      wakeWord: readFileSync(path.join(MODELS_FOLDER, 'hey_jarvis_v0.1.onnx')),
    });
  }, 60000);

  it('hears "hey jarvis" in an American voice once, where the Python package does', async () => {
    const result = await runClip(models, 'hey-jarvis-american.wav');
    expect(result.highest).toBeGreaterThan(0.9);
    expect(result.highestAt).toBe(41);
    expect(result.wakes).toHaveLength(1);
  }, 60000);

  it('hears "hey jarvis" in a British voice once, where the Python package does', async () => {
    const result = await runClip(models, 'hey-jarvis-british.wav');
    expect(result.highest).toBeGreaterThan(0.9);
    expect(result.highestAt).toBe(42);
    expect(result.wakes).toHaveLength(1);
  }, 60000);

  it('hears nothing in speech without the wake word', async () => {
    const result = await runClip(models, 'other-speech.wav');
    expect(result.highest).toBeLessThan(0.01);
    expect(result.wakes).toEqual([]);
  }, 60000);

  it('silences the first predictions after a reset, and hears the clip again after it', async () => {
    const pipeline = createWakePipeline(models, seededRandom(11));
    await pipeline.warmUp();
    const samples = readWavSamples('hey-jarvis-american.wav');
    const firstPass: number[] = [];
    for (let start = 0; start + CHUNK_SAMPLES <= samples.length; start += CHUNK_SAMPLES) {
      firstPass.push(await pipeline.push(samples.subarray(start, start + CHUNK_SAMPLES)));
    }
    pipeline.reset();
    const secondPass: number[] = [];
    for (let start = 0; start + CHUNK_SAMPLES <= samples.length; start += CHUNK_SAMPLES) {
      secondPass.push(await pipeline.push(samples.subarray(start, start + CHUNK_SAMPLES)));
    }
    expect(secondPass.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    // A reset is a clean start: the same audio scores the same as it did the first time.
    for (let index = 0; index < firstPass.length; index++) {
      expect(secondPass[index]).toBeCloseTo(firstPass[index], 5);
    }
  }, 60000);
});
