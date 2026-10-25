/**
 * The observability domain split.
 *
 * `@mastra/libsql` implements the spans of the observability domain but not feedback or
 * logs, where it inherits the throwing stubs in `@mastra/core`. Studio polls
 * `/observability/feedback` unprompted, so once LibSQL backs Mastra's storage the server
 * answers 500 for a surface nothing here even writes to, and its Logs page reports logs
 * as unavailable. These tests pin the seam that keeps traces on LibSQL while feedback and
 * logs are answered by stores that implement them.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { InMemoryStore } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { type ObservabilityStore, withFallbacks } from './observability.js';
import { ObservabilityLogStorage } from './observability-logs.js';

let libsqlObservability: ObservabilityStore;
let inMemoryObservability: ObservabilityStore;
let composed: ObservabilityStore;
let databaseDirectory: string;
let logs: ObservabilityLogStorage;

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
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'observability-spec-'));
  logs = new ObservabilityLogStorage(path.join(databaseDirectory, 'logs.db'));
  composed = withFallbacks(libsql, { feedback: inMemory, logs });
});

afterAll(async () => {
  await logs.close();
  await rm(databaseDirectory, { force: true, recursive: true });
});

describe('the premise', () => {
  it('libsql really does reject feedback reads', async () => {
    // If this ever starts passing, @mastra/libsql grew a feedback implementation and
    // the composition can be deleted outright.
    await expect(libsqlObservability.listFeedback({})).rejects.toThrow('does not support listing feedback');
  });

  it('libsql really does reject log reads', async () => {
    // If this ever starts passing, @mastra/libsql grew a log implementation and
    // observability-logs.ts can be deleted outright.
    await expect(libsqlObservability.listLogs({})).rejects.toThrow('does not support listing logs');
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

  it('answers a log read instead of throwing', async () => {
    // The throw is what Studio's Logs page turns into "Logs are not available with your
    // current storage".
    await expect(composed.listLogs({})).resolves.toMatchObject({ logs: [] });
  });

  it('round-trips a log write through the log store', async () => {
    await composed.batchCreateLogs({
      logs: [{ logId: 'log-1', timestamp: new Date(), level: 'warn', message: 'the boiler is offline' }],
    });

    expect((await composed.listLogs({})).logs.map((log) => log.message)).toEqual(['the boiler is offline']);
    await expect(libsqlObservability.listLogs({})).rejects.toThrow('does not support listing logs');
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
