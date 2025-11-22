/**
 * OAuth Credentials Storage
 *
 * Stores only OAuth2 refresh tokens in persistent storage.
 * Client IDs and secrets are always read from environment variables for security.
 */

import { type Client, createClient } from '@libsql/client';

export class CredentialsStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = createClient({
      url: `file:${databasePath}`,
    });
  }

  /**
   * Initialize the credentials table if it doesn't exist
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS oauth_credentials (
        provider TEXT PRIMARY KEY,
        refresh_token TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.initialized = true;
  }

  /**
   * Store OAuth refresh token for a provider
   */
  async setRefreshToken(provider: string, refreshToken: string): Promise<void> {
    await this.initialize();

    const now = new Date().toISOString();

    await this.client.execute({
      sql: `
        INSERT INTO oauth_credentials (provider, refresh_token, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(provider) DO UPDATE SET
          refresh_token = excluded.refresh_token,
          updated_at = excluded.updated_at
      `,
      args: [provider, refreshToken, now, now],
    });
  }

  /**
   * Retrieve OAuth refresh token for a provider
   */
  async getRefreshToken(provider: string): Promise<string | null> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'SELECT refresh_token FROM oauth_credentials WHERE provider = ?',
      args: [provider],
    });

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0].refresh_token as string;
  }

  /**
   * Delete refresh token for a provider
   */
  async deleteRefreshToken(provider: string): Promise<void> {
    await this.initialize();

    await this.client.execute({
      sql: 'DELETE FROM oauth_credentials WHERE provider = ?',
      args: [provider],
    });
  }

  /**
   * Update refresh token when renewed by OAuth provider
   * This is called automatically when the OAuth client receives a new refresh token
   */
  async renewRefreshToken(provider: string, newRefreshToken: string): Promise<void> {
    await this.initialize();

    // Use UPSERT pattern - same as setRefreshToken but with explicit renewal semantics
    await this.client.execute({
      sql: `INSERT INTO oauth_credentials (provider, refresh_token, created_at, updated_at)
            VALUES (?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(provider) DO UPDATE SET
              refresh_token = excluded.refresh_token,
              updated_at = datetime('now')`,
      args: [provider, newRefreshToken],
    });
  }

  /**
   * List all stored providers
   */
  async listProviders(): Promise<string[]> {
    await this.initialize();

    const result = await this.client.execute('SELECT provider FROM oauth_credentials');

    return result.rows.map((row) => row.provider as string);
  }

  /**
   * Check if refresh token exists for a provider
   */
  async hasRefreshToken(provider: string): Promise<boolean> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'SELECT COUNT(*) as count FROM oauth_credentials WHERE provider = ?',
      args: [provider],
    });

    return (result.rows[0].count as number) > 0;
  }
}
