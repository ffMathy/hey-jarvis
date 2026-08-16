/**
 * Type declarations for `@yarflam/potion-base-8m`.
 *
 * The package ships plain JavaScript with JSDoc but no `.d.ts`, so we declare the
 * subset of its API that Hey Jarvis uses. It is a zero-dependency, pure-JS
 * implementation of Model2Vec inference over the `minishlab/potion-base-8M`
 * static embedding table (256 dimensions, L2-normalised output).
 */
declare module '@yarflam/potion-base-8m' {
  /**
   * Embeds one or more texts into 256-dimensional, L2-normalised vectors.
   * Returns one vector per input text, in input order.
   */
  export function embed(texts: string | string[]): Promise<Float32Array[]>;

  /**
   * Cosine similarity between two embeddings. Because potion embeddings are
   * L2-normalised this is a plain dot product, and ranges from -1 to 1.
   */
  export function cosineSimilarity(a: Float32Array, b: Float32Array): number;
}
