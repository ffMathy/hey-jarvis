/**
 * The observability domain split.
 *
 * `@mastra/libsql` implements every observability surface except feedback, where it
 * inherits the throwing stubs in `@mastra/core`. Studio polls `/observability/feedback`
 * unprompted, so once LibSQL backs Mastra's storage the server answers 500 and logs a
 * stack trace for a surface nothing here even writes to. These tests pin the seam that
 * keeps traces on LibSQL while feedback is answered by a store that implements it.
 */

import { beforeAll, describe, expect, it } from 'bun:test';
import { InMemoryStore } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';
import { type ObservabilityStore, withFeedbackFrom } from './observability.js';

let libsqlObservability: ObservabilityStore;
let inMemoryObservability: ObservabilityStore;
let composed: ObservabilityStore;

beforeAll(async () => {
  const libsqlStore = new LibSQLStore({ id: 'observability-spec', url: ':memory:' });
  // Reads hit real tables, so the schema has to exist before the first query.
  await libsqlStore.init();

  const libsql = await libsqlStore.getStore('observability');
  const inMemory = await new InMemoryStore({ id: 'observability-spec-feedback' }).getStore('observability');

  if (!libsql || !inMemory) {
    throw new Error('Both stores must expose an observability domain for this spec to mean anything');
  }

  libsqlObservability = libsql;
  inMemoryObservability = inMemory;
  composed = withFeedbackFrom(libsql, inMemory);
});

describe('the premise', () => {
  it('libsql really does reject feedback reads', async () => {
    // If this ever starts passing, @mastra/libsql grew a feedback implementation and
    // the composition can be deleted outright.
    await expect(libsqlObservability.listFeedback({})).rejects.toThrow('does not support listing feedback');
  });

  it('the in-memory store answers them', async () => {
    await expect(inMemoryObservability.listFeedback({})).resolves.toBeDefined();
  });
});

describe('the composed store', () => {
  it('answers a feedback read instead of throwing', async () => {
    const result = await composed.listFeedback({});

    expect(result.feedback).toEqual([]);
  });

  it('answers the aggregate reads Studio makes alongside the list', async () => {
    // One 500 from Studio's observability page is as bad as another, so the whole
    // feedback surface has to be covered or the error just moves to the next call.
    await expect(composed.getFeedbackAggregate({ feedbackType: 'rating', aggregation: 'avg' })).resolves.toBeDefined();
  });

  it('round-trips a feedback write through the fallback', async () => {
    await composed.createFeedback({
      feedback: {
        feedbackId: 'feedback-1',
        feedbackType: 'rating',
        value: 1,
        timestamp: new Date(),
      },
    });

    const result = await composed.listFeedback({});

    expect(result.feedback.map((entry) => entry.feedbackId)).toContain('feedback-1');
  });

  it('leaves feedback out of the durable store, which cannot hold it', async () => {
    await expect(libsqlObservability.listFeedback({})).rejects.toThrow('does not support listing feedback');
  });

  it('serves everything else from the durable store', async () => {
    // The point of splitting at the method rather than the domain: traces must keep
    // landing in LibSQL. A domain-level swap would have moved these too.
    expect(composed.getFeatures?.()).toEqual(libsqlObservability.getFeatures?.());
    await expect(composed.listTraces({})).resolves.toBeDefined();
  });

  it('reports itself as the durable store, so error identifiers stay readable', () => {
    // Binding every function would rename the class to `bound ObservabilityLibSQL`,
    // and Mastra builds storage error identifiers out of store names.
    expect(composed.constructor.name).toBe(libsqlObservability.constructor.name);
    expect(composed).toBeInstanceOf(libsqlObservability.constructor);
  });
});
