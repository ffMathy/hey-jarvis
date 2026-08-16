import { describe, expect, it } from 'bun:test';
import { cosineSimilarity, embedText, embedTexts, STATIC_EMBEDDING_DIMENSIONS } from './static-embedder.js';

describe('static embedder (Model2Vec potion)', () => {
  it('produces 256-dimensional embeddings', async () => {
    const embedding = await embedText('the sun goes down');

    expect(embedding).toBeInstanceOf(Float32Array);
    expect(embedding.length).toBe(STATIC_EMBEDDING_DIMENSIONS);
  });

  it('returns one embedding per input text, in order', async () => {
    const embeddings = await embedTexts(['the sun goes down', 'I get home from work']);

    expect(embeddings.length).toBe(2);

    const [first] = await embedTexts(['the sun goes down']);
    expect(cosineSimilarity(embeddings[0], first)).toBeCloseTo(1, 5);
  });

  it('returns an empty array for no input', async () => {
    expect(await embedTexts([])).toEqual([]);
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([embedText('the lights are on'), embedText('the lights are on')]);

    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('scores paraphrases higher than unrelated sentences', async () => {
    const [event, paraphrase, unrelated] = await embedTexts([
      'the sun goes down',
      'sunset has happened and it is getting dark',
      'the milk in the fridge expired',
    ]);

    const paraphraseScore = cosineSimilarity(event, paraphrase);
    const unrelatedScore = cosineSimilarity(event, unrelated);

    expect(paraphraseScore).toBeGreaterThan(unrelatedScore);
    expect(unrelatedScore).toBeLessThan(0.3);
  });

  it('rejects embeddings of mismatched lengths', () => {
    expect(() => cosineSimilarity(new Float32Array(4), new Float32Array(8))).toThrow(
      'Cannot compare embeddings of different lengths',
    );
  });
});
