import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { createClient } from '@libsql/client';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { createJarvisKnowledge, householdKnowledgeOptions, SYNAPSE_SCOPE } from '../../knowledge/index.js';
import { LegacySubscriptionTable } from '../../storage/legacy-subscriptions.js';
import { createAgent } from '../../utils/agent-factory.js';
import {
  migrateLegacySubscriptions,
  type Subscription,
  SubscriptionStore,
  subscriptionFromPageBody,
  subscriptionPageBody,
} from './subscription-store.js';

const knowledge = createJarvisKnowledge(new InMemoryStore());
const store = new SubscriptionStore(knowledge);

beforeEach(async () => {
  await store.clear();
});

/** The page a subscription is kept on, as Knowledge holds it. */
async function pageOf(id: string) {
  const storage = await knowledge.getStorage();
  const [scope] = await storage.getScopesByAddress([SYNAPSE_SCOPE]);
  const page = scope && (await storage.getPageByPath({ scopeId: scope.id, path: ['subscriptions', id], read: 'all' }));
  if (!page) {
    throw new Error(`no page for subscription ${id}`);
  }
  const { notes } = await storage.listNotes({ pageId: page.id, read: 'all' });
  return { page, notes };
}

describe('SubscriptionStore', () => {
  it('stores and lists a Given/When/Then subscription', async () => {
    const stored = await store.add({
      source: 'user',
      whenEvent: 'the sun goes down',
      givenCondition: 'the lights are on',
      thenAction: 'close the blinds',
    });

    expect(stored.id).toBeTruthy();
    expect(stored.enabled).toBe(true);
    expect(stored.triggerCount).toBe(0);
    expect(stored.lastTriggeredAt).toBeNull();

    const listed = await store.list();
    expect(listed.length).toBe(1);
    expect(listed[0]).toEqual(stored);
  });

  it('keeps the GIVEN optional', async () => {
    await store.add({
      source: 'user',
      whenEvent: 'I get home from work',
      thenAction: 'turn on the lights',
      oneShot: true,
    });

    const [subscription] = await store.list();
    expect(subscription?.givenCondition).toBeUndefined();
    expect(subscription?.oneShot).toBe(true);
  });

  it('lists the oldest first', async () => {
    const first = await store.add({ source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' });
    const second = await store.add({ source: 'user', whenEvent: 'the sun comes up', thenAction: 'open the blinds' });

    expect((await store.list()).map((subscription) => subscription.id)).toEqual([first.id, second.id]);
  });

  it('records triggers and keeps recurring subscriptions armed', async () => {
    const stored = await store.add({ source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' });

    const triggered = await store.markTriggered(stored.id);

    expect(triggered?.triggerCount).toBe(1);
    expect(triggered?.enabled).toBe(true);
    expect(triggered?.lastTriggeredAt).not.toBeNull();

    const twice = await store.markTriggered(stored.id);
    expect(twice?.triggerCount).toBe(2);
    expect(await store.get(stored.id)).toEqual(twice);
    expect((await store.list()).length).toBe(1);
  });

  it('disables one-shot subscriptions once they fire', async () => {
    const stored = await store.add({
      source: 'user',
      whenEvent: 'I get home from work',
      thenAction: 'turn on the lights',
      oneShot: true,
    });

    const triggered = await store.markTriggered(stored.id);

    expect(triggered?.enabled).toBe(false);
    expect(await store.list()).toEqual([]);
    expect((await store.list({ includeDisabled: true })).length).toBe(1);
  });

  it('returns null when triggering an unknown subscription', async () => {
    expect(await store.markTriggered('does-not-exist')).toBeNull();
  });

  it('enables and disables without deleting', async () => {
    const stored = await store.add({ source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' });

    expect(await store.setEnabled(stored.id, false)).toBe(true);
    expect(await store.list()).toEqual([]);

    expect(await store.setEnabled(stored.id, true)).toBe(true);
    expect((await store.list()).length).toBe(1);

    expect(await store.setEnabled('does-not-exist', true)).toBe(false);
  });

  it('removes subscriptions', async () => {
    const stored = await store.add({ source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' });

    expect(await store.remove(stored.id)).toBe(true);
    expect(await store.get(stored.id)).toBeNull();
    expect(await store.remove(stored.id)).toBe(false);
  });
});

describe('SubscriptionStore expiry', () => {
  /** A moment far enough back or forward that clock skew cannot reach it. */
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  async function add(overrides: Partial<Parameters<typeof store.add>[0]> = {}) {
    return await store.add({
      source: 'user',
      whenEvent: 'the sun goes down',
      thenAction: 'close the blinds',
      ...overrides,
    });
  }

  describe('a firing budget', () => {
    it('stays armed until the budget is used up', async () => {
      const stored = await add({ maxTriggerCount: 3 });
      expect(stored.maxTriggerCount).toBe(3);

      expect((await store.markTriggered(stored.id))?.enabled).toBe(true);
      expect((await store.markTriggered(stored.id))?.enabled).toBe(true);

      const spent = await store.markTriggered(stored.id);
      expect(spent?.triggerCount).toBe(3);
      expect(spent?.enabled).toBe(false);
    });

    it('is what oneShot means, so the two cannot disagree', async () => {
      const stored = await add({ oneShot: true });

      // oneShot is the older spelling of a budget of one. Recording it as such keeps a
      // single rule for "spent" rather than two that can drift apart.
      expect(stored.maxTriggerCount).toBe(1);
      expect((await store.markTriggered(stored.id))?.enabled).toBe(false);
    });

    it('never runs out when no budget was set', async () => {
      const stored = await add({ expiresAt: future });
      expect(stored.maxTriggerCount).toBeNull();

      for (let firing = 0; firing < 5; firing++) {
        expect((await store.markTriggered(stored.id))?.enabled).toBe(true);
      }
    });
  });

  describe('a deadline', () => {
    it('hides an expired subscription from listing', async () => {
      await add({ expiresAt: past });

      expect(await store.list()).toEqual([]);
    });

    it('leaves a subscription alone until its deadline passes', async () => {
      const stored = await add({ expiresAt: future });

      expect((await store.list()).map((subscription) => subscription.id)).toEqual([stored.id]);
      expect(stored.expiresAt).toBe(future);
    });

    it('still shows expired subscriptions when explicitly asked for everything', async () => {
      const stored = await add({ expiresAt: past });

      // includeDisabled is "show me the lot", which is what a user asking why something
      // stopped happening needs to see.
      const all = await store.list({ includeDisabled: true });
      expect(all.map((subscription) => subscription.id)).toEqual([stored.id]);
    });
  });

  describe('pruneExpired', () => {
    it('deletes subscriptions whose deadline has passed', async () => {
      const doomed = await add({ expiresAt: past });
      const kept = await add({ expiresAt: future });

      const removed = await store.pruneExpired();

      expect(removed.map((subscription) => subscription.id)).toEqual([doomed.id]);
      expect(await store.get(doomed.id)).toBeNull();
      expect(await store.get(kept.id)).not.toBeNull();
    });

    it('deletes subscriptions that have used up their firings', async () => {
      const stored = await add({ maxTriggerCount: 1 });
      await store.markTriggered(stored.id);

      expect((await store.pruneExpired()).map((subscription) => subscription.id)).toEqual([stored.id]);
      expect(await store.get(stored.id)).toBeNull();
    });

    it('leaves a subscription that was merely paused', async () => {
      const stored = await add({ expiresAt: future });
      await store.setEnabled(stored.id, false);

      // Disabling by hand is a pause, and a pause should not quietly become a deletion.
      expect(await store.pruneExpired()).toEqual([]);
      expect(await store.get(stored.id)).not.toBeNull();
    });

    it('leaves subscriptions with no end at all, which predate budgets and deadlines', async () => {
      const stored = await add();

      expect(stored.maxTriggerCount).toBeNull();
      expect(stored.expiresAt).toBeNull();
      expect(await store.pruneExpired()).toEqual([]);
      expect(await store.get(stored.id)).not.toBeNull();
    });

    it('reports nothing when there is nothing to do', async () => {
      await add({ expiresAt: future });

      expect(await store.pruneExpired()).toEqual([]);
    });

    it('judges deadlines against a supplied moment', async () => {
      const stored = await add({ expiresAt: future });

      // Nothing to prune now, but everything to prune tomorrow.
      expect(await store.pruneExpired()).toEqual([]);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect((await store.pruneExpired(tomorrow)).map((subscription) => subscription.id)).toEqual([stored.id]);
    });
  });
});

describe('SubscriptionStore when two callers meet', () => {
  it('removes a lapsed subscription once when two prunes run at the same time, and fails neither', async () => {
    const stored = await store.add({
      source: 'user',
      whenEvent: 'the doorbell rings',
      thenAction: 'tell me',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    // Every state change prunes on its way past, and two can arrive together.
    const [first, second] = await Promise.all([store.pruneExpired(), store.pruneExpired()]);

    expect([...first, ...second].map((subscription) => subscription.id)).toEqual([stored.id]);
    expect(await store.get(stored.id)).toBeNull();
  });

  it('records a firing that spends a subscription even when a prune removes it meanwhile', async () => {
    const stored = await store.add({
      source: 'user',
      whenEvent: 'I get home',
      thenAction: 'turn on the lights',
      oneShot: true,
    });

    const [fired] = await Promise.all([store.markTriggered(stored.id), store.pruneExpired()]);

    expect(fired?.triggerCount).toBe(1);
    expect(fired?.enabled).toBe(false);
  });

  it('counts two firings recorded at the same time as two', async () => {
    // Two matching changes in one rollup can have the reactor mark the same subscription twice.
    const stored = await store.add({
      source: 'user',
      whenEvent: 'the doorbell rings',
      thenAction: 'tell me',
      maxTriggerCount: 3,
    });

    await Promise.all([store.markTriggered(stored.id), store.markTriggered(stored.id)]);
    expect((await store.get(stored.id))?.triggerCount).toBe(2);

    const [, spent] = await Promise.all([store.markTriggered(stored.id), store.markTriggered(stored.id)]);
    expect(spent?.triggerCount).toBe(4);
    expect((await store.get(stored.id))?.enabled).toBe(false);
  });

  it('reports a subscription another caller already removed as not removed', async () => {
    const stored = await store.add({ source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' });

    const removals = await Promise.all([store.remove(stored.id), store.remove(stored.id)]);

    expect(removals.filter((removed) => removed)).toEqual([true]);
  });
});

describe("a subscription's page in Knowledge", () => {
  it('shows the rule in words, under the synapse scope', async () => {
    const stored = await store.add({
      source: 'user',
      whenEvent: 'the sun goes down',
      givenCondition: 'the lights are on',
      thenAction: 'close the blinds',
    });

    const { page } = await pageOf(stored.id);

    expect(page.name).toBe('When the sun goes down, close the blinds');
    expect(page.body).toContain('**When** the sun goes down');
    expect(page.body).toContain('**Given** the lights are on');
    expect(page.body).toContain('**Then** close the blinds');
  });

  it('notes every firing, dated', async () => {
    const stored = await store.add({
      source: 'user',
      whenEvent: 'the doorbell rings',
      thenAction: 'tell me',
      maxTriggerCount: 2,
    });

    await store.markTriggered(stored.id);
    const spent = await store.markTriggered(stored.id);

    const { notes } = await pageOf(stored.id);
    expect(notes.map((note) => note.text)).toEqual([
      'Fired, for the first time.',
      'Fired, for the second time, and is now spent.',
    ]);
    expect(notes[notes.length - 1]?.when?.toISOString()).toBe(spent?.lastTriggeredAt ?? undefined);
  });

  it('reads back exactly the record it wrote', () => {
    const subscription: Subscription = {
      id: 'a-subscription',
      source: 'user',
      whenEvent: 'a `quoted` event with ```fences``` in it',
      thenAction: 'something',
      oneShot: false,
      enabled: true,
      createdAt: '2026-11-05T08:00:00.000Z',
      lastTriggeredAt: null,
      triggerCount: 0,
      maxTriggerCount: null,
      expiresAt: '2027-05-05T08:00:00.000Z',
    };

    expect(subscriptionFromPageBody(subscriptionPageBody(subscription))).toEqual(subscription);
  });

  it('skips a page that holds no subscription, and still lists the rest', async () => {
    const stored = await store.add({ source: 'user', whenEvent: 'the sun goes down', thenAction: 'close the blinds' });
    await knowledge.upsertPage({
      scope: SYNAPSE_SCOPE,
      path: 'subscriptions/not-a-subscription',
      name: 'Something else',
      body: 'Just prose.',
    });

    expect((await store.list()).map((subscription) => subscription.id)).toEqual([stored.id]);
  });

  it('lets an agent holding the household read a subscription, and not change it', async () => {
    const stored = await store.add({ source: 'user', whenEvent: 'I get home', thenAction: 'turn on the lights' });
    const reference = `${SYNAPSE_SCOPE}#subscriptions/${stored.id}`;
    const { model, calls } = createScriptedModel(({ index }) => {
      if (index === 1) {
        return { toolCalls: [{ toolName: 'knowledge_read', input: { page: reference } }] };
      }
      if (index === 2) {
        return {
          toolCalls: [{ toolName: 'knowledge_page', input: { op: 'write', page: reference, body: 'Never mind.' } }],
        };
      }
      return { text: 'Done.' };
    });
    const agent = await createAgent({
      id: 'householdReader',
      name: 'householdReader',
      instructions: 'You look after the household.',
      model,
      memory: undefined,
      ...householdKnowledgeOptions(knowledge),
    });
    new Mastra({ agents: { householdReader: agent } });

    await agent.generate('What happens when I get home?');

    const [read, write] = calls[calls.length - 1]?.toolResults ?? [];
    expect(JSON.stringify(read?.output)).toContain('turn on the lights');
    expect(write?.output).toEqual({
      type: 'error-text',
      value: `Editing a page needs editor on "${SYNAPSE_SCOPE}"; this run has viewer there.`,
    });
    expect(await store.get(stored.id)).toEqual(stored);
  });
});

/** Where the old databases the migration specs read are written. */
const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'synapse-legacy-subscriptions-'));

describe('migrateLegacySubscriptions', () => {
  let databaseNumber = 0;

  afterAll(async () => {
    await rm(databaseDirectory, { force: true, recursive: true });
  });

  /**
   * A database holding the table subscriptions were kept in before Knowledge, as its oldest
   * version created it: before budgets, deadlines and the third-person phrasings had columns.
   */
  async function legacyDatabase(rows: Array<Record<string, string | number | null>>) {
    databaseNumber++;
    const databasePath = path.join(databaseDirectory, `legacy-${databaseNumber}.db`);
    const client = createClient({ url: `file:${databasePath}` });
    await client.execute(`
      CREATE TABLE synapse_subscriptions (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        when_text TEXT NOT NULL,
        given_text TEXT,
        then_text TEXT NOT NULL,
        when_embedding BLOB NOT NULL,
        given_embedding BLOB,
        then_embedding BLOB NOT NULL,
        one_shot INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_triggered_at TEXT,
        trigger_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    for (const row of rows) {
      await client.execute({
        sql: `INSERT INTO synapse_subscriptions
          (id, source, when_text, given_text, then_text, when_embedding, then_embedding, one_shot, enabled,
           created_at, last_triggered_at, trigger_count)
          VALUES (?, ?, ?, ?, ?, x'00', x'00', ?, ?, ?, ?, ?)`,
        args: [
          row.id ?? null,
          row.source ?? 'user',
          row.when_text ?? null,
          row.given_text ?? null,
          row.then_text ?? null,
          row.one_shot ?? 0,
          row.enabled ?? 1,
          row.created_at ?? null,
          row.last_triggered_at ?? null,
          row.trigger_count ?? 0,
        ],
      });
    }
    client.close();
    return { databasePath, table: new LegacySubscriptionTable(databasePath) };
  }

  async function legacyTableExists(databasePath: string): Promise<boolean> {
    const client = createClient({ url: `file:${databasePath}` });
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'synapse_subscriptions'",
    );
    client.close();
    return result.rows.length > 0;
  }

  const sunset = {
    id: 'sunset',
    when_text: 'the sun goes down',
    given_text: 'the lights are on',
    then_text: 'close the blinds',
    created_at: '2026-10-01T18:00:00.000Z',
    last_triggered_at: '2026-11-04T16:21:00.000Z',
    trigger_count: 12,
  };
  const homecoming = {
    id: 'homecoming',
    when_text: 'I get home from work',
    then_text: 'turn on the lights',
    one_shot: 1,
    enabled: 0,
    created_at: '2026-10-02T07:30:00.000Z',
    trigger_count: 1,
  };

  it('moves every subscription across as it was, and drops the old table', async () => {
    const { databasePath, table } = await legacyDatabase([sunset, homecoming]);

    expect(await migrateLegacySubscriptions(store, table)).toBe(2);

    expect(await store.list({ includeDisabled: true })).toEqual([
      {
        id: 'sunset',
        source: 'user',
        whenEvent: 'the sun goes down',
        givenCondition: 'the lights are on',
        thenAction: 'close the blinds',
        oneShot: false,
        enabled: true,
        createdAt: '2026-10-01T18:00:00.000Z',
        lastTriggeredAt: '2026-11-04T16:21:00.000Z',
        triggerCount: 12,
        maxTriggerCount: null,
        expiresAt: null,
      },
      {
        id: 'homecoming',
        source: 'user',
        whenEvent: 'I get home from work',
        givenCondition: undefined,
        thenAction: 'turn on the lights',
        oneShot: true,
        enabled: false,
        createdAt: '2026-10-02T07:30:00.000Z',
        lastTriggeredAt: null,
        triggerCount: 1,
        maxTriggerCount: null,
        expiresAt: null,
      },
    ]);
    expect(await legacyTableExists(databasePath)).toBe(false);
  });

  it('has nothing to do once the old table is gone', async () => {
    const { table } = await legacyDatabase([sunset]);
    await migrateLegacySubscriptions(store, table);

    expect(await migrateLegacySubscriptions(store, table)).toBe(0);
    expect((await store.list()).map((subscription) => subscription.id)).toEqual(['sunset']);
  });

  it('moves each subscription once when both processes start at the same time', async () => {
    const { databasePath, table } = await legacyDatabase([sunset, homecoming]);
    const otherProcessTable = new LegacySubscriptionTable(databasePath);

    const moved = await Promise.all([
      migrateLegacySubscriptions(store, table),
      migrateLegacySubscriptions(store, otherProcessTable),
    ]);

    expect(moved.reduce((total, count) => total + count, 0)).toBe(2);
    expect((await store.list({ includeDisabled: true })).map((subscription) => subscription.id)).toEqual([
      'sunset',
      'homecoming',
    ]);
    expect(await legacyTableExists(databasePath)).toBe(false);
  });

  it('leaves a subscription that is already across as it is now', async () => {
    const { table } = await legacyDatabase([sunset]);
    await migrateLegacySubscriptions(store, table);
    const fired = await store.markTriggered('sunset');
    const { table: staleTable } = await legacyDatabase([sunset]);

    expect(await migrateLegacySubscriptions(store, staleTable)).toBe(0);
    expect(await store.get('sunset')).toEqual(fired);
  });
});
