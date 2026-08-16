import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { embedText } from '../utils/static-embedder.js';
import { type SubscriptionEmbeddings, SubscriptionStorage } from './subscriptions.js';

const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'synapse-subscriptions-'));
const databasePath = path.join(databaseDirectory, 'subscriptions.db');
const storage = new SubscriptionStorage(databasePath);

async function embeddingsFor(
  whenEvent: string,
  thenAction: string,
  givenCondition?: string,
): Promise<SubscriptionEmbeddings> {
  return {
    whenEvent: await embedText(whenEvent),
    thenAction: await embedText(thenAction),
    givenCondition: givenCondition ? await embedText(givenCondition) : null,
  };
}

beforeEach(async () => {
  await storage.clear();
});

afterAll(async () => {
  await rm(databaseDirectory, { force: true, recursive: true });
});

describe('SubscriptionStorage', () => {
  it('stores and lists a Given/When/Then subscription', async () => {
    const stored = await storage.add(
      {
        source: 'user',
        whenEvent: 'the sun goes down',
        givenCondition: 'the lights are on',
        thenAction: 'close the blinds',
      },
      await embeddingsFor('the sun goes down', 'close the blinds', 'the lights are on'),
    );

    expect(stored.id).toBeTruthy();
    expect(stored.enabled).toBe(true);
    expect(stored.triggerCount).toBe(0);
    expect(stored.lastTriggeredAt).toBeNull();

    const listed = await storage.list();
    expect(listed.length).toBe(1);
    expect(listed[0]).toEqual(stored);
  });

  it('keeps the GIVEN optional', async () => {
    await storage.add(
      { source: 'user', whenEvent: 'I get home from work', thenAction: 'turn on the lights', oneShot: true },
      await embeddingsFor('I get home from work', 'turn on the lights'),
    );

    const [subscription] = await storage.list();
    expect(subscription.givenCondition).toBeUndefined();
    expect(subscription.oneShot).toBe(true);

    const [embedded] = await storage.getAllEmbedded();
    expect(embedded.givenEmbedding).toBeNull();
  });

  it('round-trips embeddings through the database without loss', async () => {
    const embeddings = await embeddingsFor('the sun goes down', 'close the blinds', 'the lights are on');

    await storage.add(
      {
        source: 'user',
        whenEvent: 'the sun goes down',
        givenCondition: 'the lights are on',
        thenAction: 'close the blinds',
      },
      embeddings,
    );

    const [embedded] = await storage.getAllEmbedded();

    expect(Array.from(embedded.whenEmbedding)).toEqual(Array.from(embeddings.whenEvent));
    expect(embedded.givenEmbedding).not.toBeNull();
    expect(Array.from(embedded.givenEmbedding ?? new Float32Array())).toEqual(
      Array.from(embeddings.givenCondition ?? new Float32Array()),
    );
  });

  it('rejects embeddings of the wrong dimensionality', async () => {
    await expect(
      storage.add(
        { source: 'user', whenEvent: 'something happens', thenAction: 'do something' },
        { whenEvent: new Float32Array(8), givenCondition: null, thenAction: new Float32Array(8) },
      ),
    ).rejects.toThrow('256-dimensional embeddings');
  });

  it('records triggers and keeps recurring subscriptions armed', async () => {
    const stored = await storage.add(
      { source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' },
      await embeddingsFor('the sun goes down', 'close the blinds'),
    );

    const triggered = await storage.markTriggered(stored.id);

    expect(triggered?.triggerCount).toBe(1);
    expect(triggered?.enabled).toBe(true);
    expect(triggered?.lastTriggeredAt).not.toBeNull();

    const twice = await storage.markTriggered(stored.id);
    expect(twice?.triggerCount).toBe(2);
    expect((await storage.list()).length).toBe(1);
  });

  it('disables one-shot subscriptions once they fire', async () => {
    const stored = await storage.add(
      { source: 'user', whenEvent: 'I get home from work', thenAction: 'turn on the lights', oneShot: true },
      await embeddingsFor('I get home from work', 'turn on the lights'),
    );

    const triggered = await storage.markTriggered(stored.id);

    expect(triggered?.enabled).toBe(false);
    expect(await storage.list()).toEqual([]);
    expect((await storage.list({ includeDisabled: true })).length).toBe(1);
    expect(await storage.getAllEmbedded()).toEqual([]);
  });

  it('returns null when triggering an unknown subscription', async () => {
    expect(await storage.markTriggered('does-not-exist')).toBeNull();
  });

  it('enables and disables without deleting', async () => {
    const stored = await storage.add(
      { source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' },
      await embeddingsFor('the sun goes down', 'close the blinds'),
    );

    expect(await storage.setEnabled(stored.id, false)).toBe(true);
    expect(await storage.list()).toEqual([]);

    expect(await storage.setEnabled(stored.id, true)).toBe(true);
    expect((await storage.list()).length).toBe(1);

    expect(await storage.setEnabled('does-not-exist', true)).toBe(false);
  });

  it('removes subscriptions', async () => {
    const stored = await storage.add(
      { source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' },
      await embeddingsFor('the sun goes down', 'close the blinds'),
    );

    expect(await storage.remove(stored.id)).toBe(true);
    expect(await storage.get(stored.id)).toBeNull();
    expect(await storage.remove(stored.id)).toBe(false);
  });
});
