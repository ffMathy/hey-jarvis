/**
 * The table synapse subscriptions were kept in before they moved into Jarvis's Knowledge.
 *
 * Read once, to move what it holds across, and then dropped; see `migrateLegacySubscriptions`
 * in `verticals/synapse/subscription-store.ts`. Remove both once every deployment has started
 * on a version that has moved its subscriptions.
 */

import type { Client } from '@libsql/client';
import { openSqliteClient } from './sqlite-client.js';

const LEGACY_TABLE = 'synapse_subscriptions';

/** A row of the old table, in the shape a subscription has today. */
export interface LegacySubscription {
  id: string;
  source: string;
  whenEvent: string;
  givenCondition?: string;
  thenAction: string;
  oneShot: boolean;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
  triggerCount: number;
  maxTriggerCount: number | null;
  expiresAt: string | null;
}

/**
 * Reads a row. A database created before subscriptions could have a budget or a deadline has no
 * such columns, which reads as no limit, the way the old table read them.
 */
function toLegacySubscription(row: Record<string, unknown>): LegacySubscription {
  return {
    id: String(row.id),
    source: String(row.source),
    whenEvent: String(row.when_text),
    givenCondition: row.given_text == null ? undefined : String(row.given_text),
    thenAction: String(row.then_text),
    oneShot: Number(row.one_shot) === 1,
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.created_at),
    lastTriggeredAt: row.last_triggered_at == null ? null : String(row.last_triggered_at),
    triggerCount: Number(row.trigger_count),
    maxTriggerCount: row.max_trigger_count == null ? null : Number(row.max_trigger_count),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
  };
}

export class LegacySubscriptionTable {
  private client: Client;

  constructor(databasePath: string) {
    this.client = openSqliteClient(databasePath);
  }

  /**
   * Every subscription in the old table, oldest first, or null when there is no such table.
   *
   * Read in one transaction: the other process may drop the table while this one reads it, and a
   * read transaction keeps seeing the table it started with.
   */
  async readAll(): Promise<LegacySubscription[] | null> {
    const transaction = await this.client.transaction('read');
    try {
      const table = await transaction.execute({
        sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        args: [LEGACY_TABLE],
      });
      if (table.rows.length === 0) {
        return null;
      }

      const rows = await transaction.execute(`SELECT * FROM ${LEGACY_TABLE} ORDER BY created_at ASC`);
      return rows.rows.map((row) => toLegacySubscription(row));
    } finally {
      transaction.close();
    }
  }

  /** Drops the old table, once what it held has been moved. */
  async drop(): Promise<void> {
    await this.client.execute(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
  }
}
