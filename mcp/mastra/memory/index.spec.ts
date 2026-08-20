/**
 * Memory construction.
 *
 * The flag under test decides whether a write pays for a hosted embedding. Synapse is the
 * highest-frequency writer in the system — one message per device state change — and every
 * one of those was being embedded with `gemini-embedding-001` so that machine payloads
 * like `co2 ppm is 1400` could be searched by meaning, which nothing ever asks for.
 *
 * Asserted against the config Mastra actually receives rather than by observing a network
 * call, because the point of the change is that there is no network call to observe.
 */

import { describe, expect, it } from 'bun:test';
import { createMemory } from './index.js';

/** Mastra exposes the resolved per-thread options here. */
function semanticRecallOf(memory: Awaited<ReturnType<typeof createMemory>>): unknown {
  return (memory as unknown as { threadConfig?: { semanticRecall?: unknown } }).threadConfig?.semanticRecall;
}

describe('createMemory', () => {
  it('embeds for semantic recall by default', async () => {
    // Conversational agents keep the behaviour they had; only the callers that opt out
    // change, so this default is what stops the change leaking into them.
    expect(semanticRecallOf(await createMemory())).toMatchObject({ topK: 10, messageRange: 3 });
  });

  it('turns embedding off when semantic recall is not wanted', async () => {
    expect(semanticRecallOf(await createMemory({ enableSemanticRecall: false }))).toBe(false);
  });

  it('keeps the two switches independent', async () => {
    // Working memory and semantic recall are unrelated concerns, and a caller that
    // disables one must not silently lose the other.
    const memory = await createMemory({ enableSemanticRecall: false, enableWorkingMemory: true });

    expect(semanticRecallOf(memory)).toBe(false);
    const workingMemory = (memory as unknown as { threadConfig?: { workingMemory?: { enabled?: boolean } } })
      .threadConfig?.workingMemory;
    expect(workingMemory?.enabled).toBe(true);
  });
});
