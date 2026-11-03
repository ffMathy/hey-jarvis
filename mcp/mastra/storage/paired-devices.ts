/**
 * Paired Device Storage
 *
 * The devices sir has paired with this server, each with a token of its own, so that a device which
 * cannot hold an ElevenLabs key comfortably — the Quest headset, where it would be typed on a virtual
 * keyboard and kept in a browser's storage — can have the server start its conversations instead (see
 * `verticals/api/paired-devices.ts`).
 *
 * **Only a hash of each token is kept.** The token itself is handed to the device once, when it is
 * paired, and never again: a copy of this database is not a copy of any device's token. The token is
 * 256 random bits, so a plain SHA-256 is enough — there is nothing for a slow hash to stretch.
 */

import type { Client } from '@libsql/client';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { openSqliteClient } from './sqlite-client.js';

/** A paired device, as sir sees it in the list: never with its token. */
export interface PairedDevice {
  id: string;
  name: string;
  pairedAt: string;
  /** When the device last asked for a conversation, or null when it has not yet. */
  lastUsedAt: string | null;
}

/** How many random bytes a device token is made of: 256 bits. */
const TOKEN_BYTES = 32;

/** The hash a token is looked up by. */
function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class PairedDeviceStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = openSqliteClient(databasePath);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS paired_devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        paired_at TEXT NOT NULL,
        last_used_at TEXT
      )
    `);

    this.initialized = true;
  }

  /** Pairs a new device, and hands back its token — the only time the token is ever seen. */
  async pair(name: string, now = new Date()): Promise<{ device: PairedDevice; token: string }> {
    await this.initialize();

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const device: PairedDevice = { id: randomUUID(), name, pairedAt: now.toISOString(), lastUsedAt: null };
    await this.client.execute({
      sql: 'INSERT INTO paired_devices (id, name, token_hash, paired_at, last_used_at) VALUES (?, ?, ?, ?, NULL)',
      args: [device.id, device.name, hashOf(token), device.pairedAt],
    });

    return { device, token };
  }

  /**
   * The device a token belongs to, noted as used now — or `undefined` when no paired device has that
   * token, because it never had one or because it was unpaired.
   */
  async authenticate(token: string, now = new Date()): Promise<PairedDevice | undefined> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'UPDATE paired_devices SET last_used_at = ? WHERE token_hash = ? RETURNING id, name, paired_at, last_used_at',
      args: [now.toISOString(), hashOf(token)],
    });
    const [row] = result.rows;
    if (!row) return undefined;

    return {
      id: String(row.id),
      name: String(row.name),
      pairedAt: String(row.paired_at),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
    };
  }

  /** Every paired device, the most recently paired first. */
  async list(): Promise<PairedDevice[]> {
    await this.initialize();

    const result = await this.client.execute(
      'SELECT id, name, paired_at, last_used_at FROM paired_devices ORDER BY paired_at DESC, rowid DESC',
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      pairedAt: String(row.paired_at),
      lastUsedAt: row.last_used_at === null ? null : String(row.last_used_at),
    }));
  }

  /** Unpairs a device, so that its token is refused from now on. Says whether there was one. */
  async unpair(id: string): Promise<boolean> {
    await this.initialize();

    const result = await this.client.execute({ sql: 'DELETE FROM paired_devices WHERE id = ?', args: [id] });
    return result.rowsAffected > 0;
  }
}
