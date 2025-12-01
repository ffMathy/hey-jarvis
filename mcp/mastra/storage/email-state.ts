/**
 * Email State Storage
 *
 * Stores the last processed email timestamp to enable fetching only new emails.
 * Used by the email monitoring workflow to avoid processing the same emails repeatedly.
 */

import { type Client, createClient } from '@libsql/client';

export interface LastEmailState {
  folder: string;
  lastEmailId: string;
  lastEmailReceivedDateTime: string;
  updatedAt: string;
}

export class EmailStateStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = createClient({
      url: `file:${databasePath}`,
    });
  }

  /**
   * Initialize the email state table if it doesn't exist
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS email_last_seen (
        folder TEXT PRIMARY KEY,
        last_email_id TEXT NOT NULL,
        last_email_received_date_time TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.initialized = true;
  }

  /**
   * Get the last seen email state for a folder
   */
  async getLastSeenEmail(folder: string): Promise<LastEmailState | null> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'SELECT * FROM email_last_seen WHERE folder = ?',
      args: [folder],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      folder: row.folder as string,
      lastEmailId: row.last_email_id as string,
      lastEmailReceivedDateTime: row.last_email_received_date_time as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * Update the last seen email for a folder
   */
  async setLastSeenEmail(folder: string, emailId: string, receivedDateTime: string): Promise<void> {
    await this.initialize();

    const now = new Date().toISOString();

    await this.client.execute({
      sql: `
        INSERT INTO email_last_seen (folder, last_email_id, last_email_received_date_time, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(folder) DO UPDATE SET
          last_email_id = excluded.last_email_id,
          last_email_received_date_time = excluded.last_email_received_date_time,
          updated_at = excluded.updated_at
      `,
      args: [folder, emailId, receivedDateTime, now],
    });
  }

  /**
   * Clear the last seen email state for a folder
   */
  async clearLastSeenEmail(folder: string): Promise<void> {
    await this.initialize();

    await this.client.execute({
      sql: 'DELETE FROM email_last_seen WHERE folder = ?',
      args: [folder],
    });
  }

  /**
   * Clear all last seen email states
   */
  async clearAllLastSeenEmails(): Promise<void> {
    await this.initialize();

    await this.client.execute('DELETE FROM email_last_seen');
  }
}
