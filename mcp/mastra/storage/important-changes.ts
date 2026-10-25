/**
 * Important Change Storage
 *
 * Things the State Change Reactor decided sir would want to hear about -- "your parcel arrives
 * today between two and four" -- kept until the next time he talks to Jarvis, so they can be
 * mentioned in passing while whatever he asked for is being done.
 *
 * In SQLite rather than in memory because the two halves run in different processes: the reactor
 * notes a change wherever the state change was filed, and `routePromptWorkflow` reads it in the
 * MCP server (see `sqlite-client.ts` for the processes sharing this file).
 */

import type { Client } from '@libsql/client';
import { openSqliteClient } from './sqlite-client.js';

/** How long a change is worth bringing up. After a day it is old news, mentioned or not. */
export const IMPORTANT_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

export interface ImportantChange {
  id: string;
  /** What to tell sir, as one sentence. */
  summary: string;
  /** The vertical the change came from. */
  source: string;
  notedAt: string;
}

export class ImportantChangeStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = openSqliteClient(databasePath);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS important_changes (
        id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        source TEXT NOT NULL,
        noted_at TEXT NOT NULL,
        mentioned_at TEXT
      )
    `);

    this.initialized = true;
  }

  async add(change: { summary: string; source: string }, now = new Date()): Promise<ImportantChange> {
    await this.initialize();

    const stored: ImportantChange = {
      id: crypto.randomUUID(),
      summary: change.summary,
      source: change.source,
      notedAt: now.toISOString(),
    };

    await this.client.execute({
      sql: 'INSERT INTO important_changes (id, summary, source, noted_at) VALUES (?, ?, ?, ?)',
      args: [stored.id, stored.summary, stored.source, stored.notedAt],
    });

    return stored;
  }

  /**
   * Hands over the changes sir has not been told about yet, newest first, and marks them told.
   *
   * One statement, so two requests arriving together cannot both claim the same change and have
   * it said twice. Anything past `limit` stays for the next request.
   */
  async claimUnmentioned(limit: number, now = new Date()): Promise<ImportantChange[]> {
    await this.initialize();

    const oldestWorthMentioning = new Date(now.getTime() - IMPORTANT_CHANGE_TTL_MS).toISOString();

    // Housekeeping on the way past: the table only ever holds a day of rows.
    await this.client.execute({
      sql: 'DELETE FROM important_changes WHERE noted_at < ?',
      args: [oldestWorthMentioning],
    });

    const result = await this.client.execute({
      sql: `
        UPDATE important_changes SET mentioned_at = ?
        WHERE id IN (
          SELECT id FROM important_changes
          WHERE mentioned_at IS NULL AND noted_at >= ?
          ORDER BY noted_at DESC
          LIMIT ?
        )
        RETURNING id, summary, source, noted_at
      `,
      args: [now.toISOString(), oldestWorthMentioning, limit],
    });

    return result.rows
      .map((row) => ({
        id: row.id as string,
        summary: row.summary as string,
        source: row.source as string,
        notedAt: row.noted_at as string,
      }))
      .sort((left, right) => right.notedAt.localeCompare(left.notedAt));
  }

  async clear(): Promise<void> {
    await this.initialize();
    await this.client.execute('DELETE FROM important_changes');
  }
}
