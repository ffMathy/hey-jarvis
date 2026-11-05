/**
 * Subscription store
 *
 * Keeps the "points of interest" the household has asked Jarvis to watch for — things that
 * should happen when something else happens — in Jarvis's Knowledge, one page each under
 * `synapse:home#subscriptions`. Each subscription is a Given/When/Then rule:
 *
 * - `whenEvent`  (required) the event that should trigger evaluation
 * - `givenCondition` (optional) a precondition that must hold for the action to apply
 * - `thenAction`  (required) the action to take
 *
 * A page shows its rule in words, and ends on the stored record as a fenced JSON block, which is
 * what this store reads back: the record is a structured format, so nothing is read out of the
 * prose. Every firing is also a dated note on the page, so Studio's Knowledge page shows what
 * Jarvis watches for and when each rule last went off, and agents can find them with their
 * Knowledge tools. Only this store writes the pages: agents hold the synapse scope as viewers.
 *
 * Embeddings are not stored. They are derived from the text whenever matching needs them (see
 * `subscription-matcher.ts`), which is cheap with the static embedder and cannot drift from it.
 */

import type { Knowledge, KnowledgePage, KnowledgeUpsertPageResult } from '@mastra/core/knowledge';
import { MAX_KNOWLEDGE_PAGE_LIST_LIMIT } from '@mastra/core/knowledge';
import { z } from 'zod';
import { getJarvisKnowledge, SUBSCRIPTIONS_PAGE_KEY, SYNAPSE_SCOPE } from '../../knowledge/index.js';
import { getLegacySubscriptionTable, type LegacySubscriptionTable } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';

export const subscriptionSchema = z.object({
  id: z.string(),
  /** Which agent/vertical registered this subscription. */
  source: z.string(),
  /** The triggering event, e.g. "the sun goes down". */
  whenEvent: z.string(),
  /** An optional precondition, e.g. "the lights are on". */
  givenCondition: z.string().optional(),
  /** The action to take, e.g. "close the blinds". */
  thenAction: z.string(),
  oneShot: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.string(),
  lastTriggeredAt: z.string().nullable(),
  triggerCount: z.number(),
  /** Firing budget, or null when the subscription may fire indefinitely. */
  maxTriggerCount: z.number().nullable(),
  /** Deadline as an ISO timestamp, or null when the subscription has none. */
  expiresAt: z.string().nullable(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;

export type SubscriptionComponents = Pick<Subscription, 'whenEvent' | 'givenCondition' | 'thenAction'>;

export interface NewSubscription extends SubscriptionComponents {
  /** Which agent/vertical registered this subscription. */
  source: string;
  /** When true, the subscription is disabled the first time it fires. */
  oneShot?: boolean;
  /**
   * How many times this may fire before it is spent. Null means no limit.
   *
   * A budget rather than a flag, so "remind me for the next three deliveries" is
   * expressible without registering three subscriptions.
   */
  maxTriggerCount?: number | null;
  /**
   * ISO timestamp after which this stops matching and becomes eligible for deletion.
   * Null means no deadline.
   */
  expiresAt?: string | null;
}

/** Who a page or note was written by, as Knowledge records it. */
const AUTHOR = 'synapse';

/** The fence the record is kept in at the end of a subscription's page. */
const RECORD_FENCE = '```json';

/** A subscription's page, in words for Studio and agents, ending on the record this store reads back. */
export function subscriptionPageBody(subscription: Subscription): string {
  const rule = [
    `**When** ${subscription.whenEvent}`,
    ...(subscription.givenCondition ? [`**Given** ${subscription.givenCondition}`] : []),
    `**Then** ${subscription.thenAction}`,
  ];

  return [rule.join('  \n'), `${RECORD_FENCE}\n${JSON.stringify(subscription, null, 2)}\n\`\`\``].join('\n\n');
}

/** The record a subscription's page ends on, or undefined when it holds none. */
export function subscriptionFromPageBody(body: string | undefined): Subscription | undefined {
  const fenceStart = body?.lastIndexOf(`${RECORD_FENCE}\n`) ?? -1;
  if (body === undefined || fenceStart === -1) {
    return undefined;
  }

  const recordStart = fenceStart + RECORD_FENCE.length + 1;
  const recordEnd = body.indexOf('\n```', recordStart);
  if (recordEnd === -1) {
    return undefined;
  }

  try {
    return subscriptionSchema.safeParse(JSON.parse(body.slice(recordStart, recordEnd))).data;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/** The page's name: its rule in one line, which is what search and Studio's tree show. */
function subscriptionPageName(subscription: SubscriptionComponents): string {
  return `When ${subscription.whenEvent}, ${subscription.thenAction}`;
}

/** Spent when the firing budget is used up. */
function isSpent(subscription: Subscription): boolean {
  return subscription.maxTriggerCount !== null && subscription.triggerCount >= subscription.maxTriggerCount;
}

/** Past its deadline at `timestamp`, an ISO string, which compares as text. */
function isExpired(subscription: Subscription, timestamp: string): boolean {
  return subscription.expiresAt !== null && subscription.expiresAt <= timestamp;
}

export class SubscriptionStore {
  constructor(private readonly knowledge: Knowledge) {}

  /**
   * Store a new subscription.
   *
   * @param subscription - The Given/When/Then components and their origin
   * @returns The stored subscription
   */
  async add(subscription: NewSubscription): Promise<Subscription> {
    const stored: Subscription = {
      id: crypto.randomUUID(),
      source: subscription.source,
      whenEvent: subscription.whenEvent,
      givenCondition: subscription.givenCondition,
      thenAction: subscription.thenAction,
      oneShot: subscription.oneShot ?? false,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
      triggerCount: 0,
      // oneShot is the older spelling of a one-firing budget. Folding it in here keeps
      // a single rule for when a subscription is spent, rather than two that can drift.
      maxTriggerCount: subscription.maxTriggerCount ?? (subscription.oneShot ? 1 : null),
      expiresAt: subscription.expiresAt ?? null,
    };

    await this.write(stored);
    return stored;
  }

  /**
   * Puts back a subscription exactly as it was, unless one with its id is already here. For moving
   * subscriptions over from where they were kept before; see {@link migrateLegacySubscriptions}.
   *
   * Two processes restoring the same subscription at once both find it missing, and both write the
   * same record to the same page, which only one of them creates.
   *
   * @returns True when it was put back
   */
  async restore(subscription: Subscription): Promise<boolean> {
    if (await this.get(subscription.id)) {
      return false;
    }

    return (await this.write(subscription)) === 'created';
  }

  /**
   * List subscriptions, oldest first.
   *
   * A subscription past its deadline is left out as well as being pruned, so it stops matching
   * the moment it expires rather than the next time something happens to run the prune.
   *
   * @param options.includeDisabled - Include subscriptions that have been disabled or have lapsed
   */
  async list(options: { includeDisabled?: boolean } = {}): Promise<Subscription[]> {
    const subscriptions = await this.readAll();
    if (options.includeDisabled) {
      return subscriptions;
    }

    const now = new Date().toISOString();
    return subscriptions.filter((subscription) => subscription.enabled && !isExpired(subscription, now));
  }

  /**
   * Get a single subscription by id, or null when it doesn't exist.
   */
  async get(id: string): Promise<Subscription | null> {
    const page = await this.pageAt([SUBSCRIPTIONS_PAGE_KEY, id]);
    return page ? (this.subscriptionOn(page) ?? null) : null;
  }

  /**
   * Record that a subscription fired, as a dated note on its page as well as in its record.
   *
   * One-shot subscriptions ("the next time I get home...") are disabled here so
   * they never fire twice.
   *
   * @returns The updated subscription, or null when the id is unknown
   */
  async markTriggered(id: string): Promise<Subscription | null> {
    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const triggeredAt = new Date();
    const triggered: Subscription = {
      ...existing,
      lastTriggeredAt: triggeredAt.toISOString(),
      triggerCount: existing.triggerCount + 1,
    };
    // oneShot is the older spelling of a budget of one and is still honoured for subscriptions
    // registered before the budget existed.
    const updated = { ...triggered, enabled: !(existing.oneShot || isSpent(triggered)) };

    await this.write(updated);
    await this.knowledge.addNote({
      scope: SYNAPSE_SCOPE,
      path: this.pathOf(id),
      text: `Fired, for the ${ordinal(updated.triggerCount)} time${updated.enabled ? '' : ', and is now spent'}.`,
      when: triggeredAt,
      author: AUTHOR,
    });

    return updated;
  }

  /**
   * Deletes subscriptions that can never fire again.
   *
   * That is either of two things: the deadline has passed, or the firing budget is
   * used up. Both are permanent, so the pages are removed rather than disabled —
   * a disabled subscription is one a user might re-arm, whereas these are finished.
   *
   * Disabling by hand is left alone: `setEnabled(id, false)` is a pause, and pausing
   * something should not eventually delete it.
   *
   * @param now - The moment to judge deadlines against, for testing. Defaults to now.
   * @returns The subscriptions that were deleted, so the caller can say what went
   */
  async pruneExpired(now: Date = new Date()): Promise<Subscription[]> {
    const timestamp = now.toISOString();
    const doomed = (await this.readAll()).filter(
      (subscription) => isExpired(subscription, timestamp) || isSpent(subscription),
    );

    for (const subscription of doomed) {
      await this.remove(subscription.id);
    }

    return doomed;
  }

  /**
   * Enable or disable a subscription without deleting it.
   *
   * @returns True when a subscription was updated
   */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const existing = await this.get(id);
    if (!existing) {
      return false;
    }

    await this.write({ ...existing, enabled });
    return true;
  }

  /**
   * Permanently delete a subscription.
   *
   * @returns True when a subscription was deleted
   */
  async remove(id: string): Promise<boolean> {
    return (await this.knowledge.removePage({ scope: SYNAPSE_SCOPE, path: this.pathOf(id), author: AUTHOR })) !== null;
  }

  /**
   * Delete every subscription. Primarily useful for tests.
   */
  async clear(): Promise<void> {
    for (const subscription of await this.readAll()) {
      await this.remove(subscription.id);
    }
  }

  private pathOf(id: string): string {
    return `${SUBSCRIPTIONS_PAGE_KEY}/${id}`;
  }

  /** Writes a subscription's page, and says whether that created, changed or left it. */
  private async write(subscription: Subscription): Promise<KnowledgeUpsertPageResult['status']> {
    const { status } = await this.knowledge.upsertPage({
      scope: SYNAPSE_SCOPE,
      path: this.pathOf(subscription.id),
      name: subscriptionPageName(subscription),
      body: subscriptionPageBody(subscription),
      author: AUTHOR,
    });
    return status;
  }

  /** The page at a key path under the synapse scope, or null when it or the scope is not there yet. */
  private async pageAt(path: string[]): Promise<KnowledgePage | null> {
    const storage = await this.knowledge.getStorage();
    const [scope] = await storage.getScopesByAddress([SYNAPSE_SCOPE]);
    return scope ? storage.getPageByPath({ scopeId: scope.id, path, read: 'all' }) : null;
  }

  /** Every subscription, oldest first. */
  private async readAll(): Promise<Subscription[]> {
    const parent = await this.pageAt([SUBSCRIPTIONS_PAGE_KEY]);
    if (!parent) {
      return [];
    }

    const storage = await this.knowledge.getStorage();
    const pages: KnowledgePage[] = [];
    let cursor: string | undefined;
    do {
      const listing = await storage.listChildPages({
        parentId: parent.id,
        read: 'all',
        cursor,
        limit: MAX_KNOWLEDGE_PAGE_LIST_LIMIT,
      });
      pages.push(...listing.pages);
      cursor = listing.nextCursor;
    } while (cursor);

    return pages
      .flatMap((page) => this.subscriptionOn(page) ?? [])
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }

  /**
   * The subscription a page holds.
   *
   * A page that holds none is logged and left out rather than failing every match: only this store
   * writes these pages, so one that does not parse is a bug to report, and the rest still have to
   * be watched for — the same trade the synapse rules make for a rule that does not parse.
   */
  private subscriptionOn(page: KnowledgePage): Subscription | undefined {
    const subscription = subscriptionFromPageBody(page.body);
    if (!subscription || subscription.id !== page.key) {
      logger.error('A page under the synapse subscriptions holds no subscription of its own; skipping it', {
        pageId: page.id,
        key: page.key,
      });
      return undefined;
    }
    return subscription;
  }
}

/** "first", "second", … for the counts a firing note gives. */
function ordinal(count: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  return words[count - 1] ?? `${count}th`;
}

/**
 * Moves the subscriptions kept in SQLite before they moved into Knowledge (`synapse_subscriptions`)
 * across, then drops that table.
 *
 * Each one keeps its id, history and settings, so the household loses nothing it asked to be
 * watched for. It runs in each process the first time the store is asked for, and both processes
 * may run it at once: the old table is read in one transaction, a subscription already moved is
 * left as it is, and the table is dropped only once every row is across. Remove it, with
 * `storage/legacy-subscriptions.ts`, once every deployment has started on a version with it.
 *
 * @returns How many subscriptions were moved
 */
export async function migrateLegacySubscriptions(
  store: SubscriptionStore,
  table: LegacySubscriptionTable,
): Promise<number> {
  const legacy = await table.readAll();
  if (legacy === null) {
    return 0;
  }

  let moved = 0;
  for (const subscription of legacy) {
    if (await store.restore(subscription)) {
      moved++;
    }
  }

  await table.drop();
  logger.info('Moved the subscriptions kept in SQLite into Knowledge', { found: legacy.length, moved });
  return moved;
}

let subscriptionStoreInstance: Promise<SubscriptionStore> | null = null;

/**
 * The subscription store, one per process, with any subscriptions still kept the old way moved in.
 *
 * A failed start is forgotten, so the next caller tries again instead of being handed the same
 * failure for the rest of the process's life.
 */
export function getSubscriptionStore(): Promise<SubscriptionStore> {
  subscriptionStoreInstance ??= (async () => {
    const store = new SubscriptionStore(await getJarvisKnowledge());
    await migrateLegacySubscriptions(store, await getLegacySubscriptionTable());
    return store;
  })().catch((error: unknown) => {
    subscriptionStoreInstance = null;
    throw error;
  });
  return subscriptionStoreInstance;
}
