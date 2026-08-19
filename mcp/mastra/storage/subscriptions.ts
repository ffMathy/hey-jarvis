/**
 * Subscription Storage
 *
 * Stores "points of interest" the user has expressed — things they want to happen
 * when something else happens. Each subscription is a Given/When/Then rule:
 *
 * - `whenEvent`  (required) the event that should trigger evaluation
 * - `givenCondition` (optional) a precondition that must hold for the action to apply
 * - `thenAction`  (required) the action to take
 *
 * Every component is stored alongside a Model2Vec (potion) embedding so that an
 * incoming state change can be matched against the `whenEvent` and `givenCondition` parts
 * without an LLM call.
 */

import { type Client, createClient } from '@libsql/client';
import { STATIC_EMBEDDING_DIMENSIONS } from '../utils/static-embedder.js';

export interface SubscriptionComponents {
  /** The triggering event, e.g. "the sun goes down". Required. */
  whenEvent: string;
  /** An optional precondition, e.g. "the lights are on". */
  givenCondition?: string;
  /** The action to take, e.g. "close the blinds". Required. */
  thenAction: string;
}

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

export interface Subscription extends SubscriptionComponents {
  id: string;
  source: string;
  oneShot: boolean;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  triggerCount: number;
  /** Firing budget, or null when the subscription may fire indefinitely. */
  maxTriggerCount: number | null;
  /** Deadline as an ISO timestamp, or null when the subscription has none. */
  expiresAt: string | null;
}

/** Why a subscription is finished, for logging and for telling the user. */
export type SubscriptionExpiryReason = 'spent' | 'expired';

/**
 * A subscription plus the embeddings of its components, as used by the matcher.
 */
export interface EmbeddedSubscription extends Subscription {
  whenEmbedding: Float32Array;
  givenEmbedding: Float32Array | null;
}

/** The embeddings supplied when creating a subscription. */
export interface SubscriptionEmbeddings {
  whenEvent: Float32Array;
  givenCondition: Float32Array | null;
  thenAction: Float32Array;
}

/**
 * Serialises an embedding for storage as a SQLite BLOB.
 *
 * The Float32Array may be a view into a larger buffer (potion slices rows out of
 * the embedding matrix), so copy just this vector's bytes.
 */
function toBlob(embedding: Float32Array): Uint8Array {
  return new Uint8Array(embedding.buffer.slice(embedding.byteOffset, embedding.byteOffset + embedding.byteLength));
}

/**
 * Deserialises an embedding stored as a SQLite BLOB.
 *
 * `@libsql/client` hands blobs back as `ArrayBuffer`, but accepts `Uint8Array` on
 * the way in, so both are handled rather than assuming one shape.
 */
function fromBlob(value: unknown): Float32Array {
  if (value instanceof ArrayBuffer) {
    return new Float32Array(value);
  }

  if (value instanceof Uint8Array) {
    return new Float32Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }

  throw new Error(`Expected a stored embedding blob, received ${typeof value}`);
}

export class SubscriptionStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = createClient({
      url: `file:${databasePath}`,
    });
  }

  /**
   * Create the subscriptions table if it doesn't exist yet.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS synapse_subscriptions (
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
        trigger_count INTEGER NOT NULL DEFAULT 0,
        max_trigger_count INTEGER,
        expires_at TEXT
      )
    `);

    // Databases created before subscriptions could expire are missing those columns.
    // Adding them leaves existing rows NULL, which every check below reads as "no
    // limit" -- so an old subscription behaves exactly as it did.
    await this.addMissingColumns();

    this.initialized = true;
  }

  /**
   * Adds any columns a database predating them is missing.
   *
   * SQLite has no `ADD COLUMN IF NOT EXISTS`, so the current columns are read back
   * from `PRAGMA table_info` and only the absent ones are added.
   */
  private async addMissingColumns(): Promise<void> {
    const existing = await this.client.execute('PRAGMA table_info(synapse_subscriptions)');
    const columnNames = new Set(existing.rows.map((row) => String(row.name)));

    const additions: Array<[string, string]> = [
      ['max_trigger_count', 'INTEGER'],
      ['expires_at', 'TEXT'],
    ];

    for (const [column, type] of additions) {
      if (!columnNames.has(column)) {
        await this.client.execute(`ALTER TABLE synapse_subscriptions ADD COLUMN ${column} ${type}`);
      }
    }
  }

  /**
   * Store a new subscription along with the embeddings of its components.
   *
   * @param subscription - The Given/When/Then components and their origin
   * @param embeddings - Embeddings matching the subscription's components
   * @returns The stored subscription
   */
  async add(subscription: NewSubscription, embeddings: SubscriptionEmbeddings): Promise<Subscription> {
    await this.initialize();

    if (embeddings.whenEvent.length !== STATIC_EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Expected ${STATIC_EMBEDDING_DIMENSIONS}-dimensional embeddings, received ${embeddings.whenEvent.length}`,
      );
    }

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

    await this.client.execute({
      sql: `
        INSERT INTO synapse_subscriptions (
          id, source, when_text, given_text, then_text,
          when_embedding, given_embedding, then_embedding,
          one_shot, enabled, created_at, last_triggered_at, trigger_count,
          max_trigger_count, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        stored.id,
        stored.source,
        stored.whenEvent,
        stored.givenCondition ?? null,
        stored.thenAction,
        toBlob(embeddings.whenEvent),
        embeddings.givenCondition ? toBlob(embeddings.givenCondition) : null,
        toBlob(embeddings.thenAction),
        stored.oneShot ? 1 : 0,
        1,
        stored.createdAt,
        null,
        0,
        stored.maxTriggerCount,
        stored.expiresAt,
      ],
    });

    return stored;
  }

  /**
   * Get all subscriptions with their `whenEvent`/`givenCondition` embeddings, for matching.
   *
   * The `thenAction` embedding is deliberately not loaded: matching only ever scores
   * against `whenEvent` and `givenCondition`, and the `thenAction` text itself is what the LLM needs.
   *
   * @param options.includeDisabled - Include subscriptions that have been disabled
   */
  async getAllEmbedded(options: { includeDisabled?: boolean } = {}): Promise<EmbeddedSubscription[]> {
    await this.initialize();

    // A subscription past its deadline is filtered out here as well as being pruned,
    // so it stops matching the moment it expires rather than the next time something
    // happens to run the prune.
    const result = await this.client.execute({
      sql: options.includeDisabled
        ? 'SELECT * FROM synapse_subscriptions ORDER BY created_at ASC'
        : `SELECT * FROM synapse_subscriptions
           WHERE enabled = 1 AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY created_at ASC`,
      args: options.includeDisabled ? [] : [new Date().toISOString()],
    });

    return result.rows.map((row) => ({
      ...this.toSubscription(row),
      whenEmbedding: fromBlob(row.when_embedding),
      givenEmbedding: row.given_embedding === null ? null : fromBlob(row.given_embedding),
    }));
  }

  /**
   * List subscriptions without their embeddings.
   *
   * @param options.includeDisabled - Include subscriptions that have been disabled
   */
  async list(options: { includeDisabled?: boolean } = {}): Promise<Subscription[]> {
    await this.initialize();

    const result = await this.client.execute({
      sql: options.includeDisabled
        ? 'SELECT * FROM synapse_subscriptions ORDER BY created_at ASC'
        : `SELECT * FROM synapse_subscriptions
           WHERE enabled = 1 AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY created_at ASC`,
      args: options.includeDisabled ? [] : [new Date().toISOString()],
    });

    return result.rows.map((row) => this.toSubscription(row));
  }

  /**
   * Get a single subscription by id, or null when it doesn't exist.
   */
  async get(id: string): Promise<Subscription | null> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'SELECT * FROM synapse_subscriptions WHERE id = ?',
      args: [id],
    });

    const row = result.rows[0];
    return row ? this.toSubscription(row) : null;
  }

  /**
   * Record that a subscription fired.
   *
   * One-shot subscriptions ("the next time I get home...") are disabled here so
   * they never fire twice.
   *
   * @returns The updated subscription, or null when the id is unknown
   */
  async markTriggered(id: string): Promise<Subscription | null> {
    await this.initialize();

    const existing = await this.get(id);
    if (!existing) {
      return null;
    }

    const triggeredAt = new Date().toISOString();
    const triggerCount = existing.triggerCount + 1;

    // Spent when the firing budget is used up. oneShot is the older spelling of a
    // budget of one and is still honoured for rows written before the column existed.
    const spent = existing.oneShot || (existing.maxTriggerCount !== null && triggerCount >= existing.maxTriggerCount);

    await this.client.execute({
      sql: `
        UPDATE synapse_subscriptions
        SET last_triggered_at = ?, trigger_count = trigger_count + 1, enabled = ?
        WHERE id = ?
      `,
      args: [triggeredAt, spent ? 0 : 1, id],
    });

    return {
      ...existing,
      enabled: !spent,
      lastTriggeredAt: triggeredAt,
      triggerCount,
    };
  }

  /**
   * Deletes subscriptions that can never fire again.
   *
   * That is either of two things: the deadline has passed, or the firing budget is
   * used up. Both are permanent, so the rows are removed rather than disabled —
   * a disabled subscription is one a user might re-arm, whereas these are finished.
   *
   * Disabling by hand is left alone: `setEnabled(id, false)` is a pause, and pausing
   * something should not eventually delete it.
   *
   * @param now - The moment to judge deadlines against, for testing. Defaults to now.
   * @returns The subscriptions that were deleted, so the caller can say what went
   */
  async pruneExpired(now: Date = new Date()): Promise<Subscription[]> {
    await this.initialize();

    const timestamp = now.toISOString();
    const doomed = await this.client.execute({
      sql: `
        SELECT * FROM synapse_subscriptions
        WHERE (expires_at IS NOT NULL AND expires_at <= ?)
           OR (max_trigger_count IS NOT NULL AND trigger_count >= max_trigger_count)
      `,
      args: [timestamp],
    });

    if (doomed.rows.length === 0) {
      return [];
    }

    await this.client.execute({
      sql: `
        DELETE FROM synapse_subscriptions
        WHERE (expires_at IS NOT NULL AND expires_at <= ?)
           OR (max_trigger_count IS NOT NULL AND trigger_count >= max_trigger_count)
      `,
      args: [timestamp],
    });

    return doomed.rows.map((row) => this.toSubscription(row));
  }

  /**
   * Enable or disable a subscription without deleting it.
   *
   * @returns True when a subscription was updated
   */
  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'UPDATE synapse_subscriptions SET enabled = ? WHERE id = ?',
      args: [enabled ? 1 : 0, id],
    });

    return result.rowsAffected > 0;
  }

  /**
   * Permanently delete a subscription.
   *
   * @returns True when a subscription was deleted
   */
  async remove(id: string): Promise<boolean> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'DELETE FROM synapse_subscriptions WHERE id = ?',
      args: [id],
    });

    return result.rowsAffected > 0;
  }

  /**
   * Delete every subscription. Primarily useful for tests.
   */
  async clear(): Promise<void> {
    await this.initialize();

    await this.client.execute('DELETE FROM synapse_subscriptions');
  }

  private toSubscription(row: Record<string, unknown>): Subscription {
    return {
      id: String(row.id),
      source: String(row.source),
      whenEvent: String(row.when_text),
      givenCondition: row.given_text === null ? undefined : String(row.given_text),
      thenAction: String(row.then_text),
      oneShot: Number(row.one_shot) === 1,
      enabled: Number(row.enabled) === 1,
      createdAt: String(row.created_at),
      lastTriggeredAt: row.last_triggered_at === null ? null : String(row.last_triggered_at),
      triggerCount: Number(row.trigger_count),
      maxTriggerCount: row.max_trigger_count == null ? null : Number(row.max_trigger_count),
      expiresAt: row.expires_at == null ? null : String(row.expires_at),
    };
  }
}
