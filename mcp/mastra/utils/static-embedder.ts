import { cosineSimilarity as potionCosineSimilarity, embed as potionEmbed } from '@yarflam/potion-base-8m';

/**
 * Static text embeddings backed by the Model2Vec `potion` family
 * (`minishlab/potion-base-8M`).
 *
 * Model2Vec distils a sentence transformer down to a static token->vector table,
 * so embedding a sentence is a vocabulary lookup plus a mean-pool instead of a
 * forward pass. That makes it fast enough and cheap enough to embed on every
 * state change, and it runs entirely in-process: no API key, no network call,
 * and no GPU. The trade-off is a modest accuracy drop versus a full transformer,
 * which is acceptable because embeddings here are used for *candidate retrieval*
 * — an LLM still makes the final decision.
 *
 * Use this for high-frequency, low-stakes similarity work (subscription
 * matching). Semantic memory recall keeps using the hosted Gemini embedder,
 * which is more accurate and only runs on writes.
 */

/** Dimensionality of the vectors produced by `potion-base-8M`. */
export const STATIC_EMBEDDING_DIMENSIONS = 256;

/**
 * Embeds a batch of texts into L2-normalised vectors.
 *
 * The embedding table is loaded lazily on first use and cached by the underlying
 * package for the lifetime of the process.
 *
 * @param texts - Texts to embed
 * @returns One vector per input text, in the same order
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) {
    return [];
  }

  return await potionEmbed(texts);
}

/**
 * Embeds a single text into an L2-normalised vector.
 *
 * @param text - Text to embed
 */
export async function embedText(text: string): Promise<Float32Array> {
  const [embedding] = await embedTexts([text]);

  if (!embedding) {
    throw new Error('Static embedder returned no embedding for the provided text');
  }

  return embedding;
}

/**
 * Cosine similarity between two embeddings, in the range -1 to 1.
 *
 * Vectors from {@link embedText} are L2-normalised, so semantically unrelated
 * sentences land near 0 and paraphrases typically score above 0.35.
 *
 * @param a - First embedding
 * @param b - Second embedding
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Cannot compare embeddings of different lengths (${a.length} vs ${b.length})`);
  }

  return potionCosineSimilarity(a, b);
}
