/**
 * IoT Device State Storage
 *
 * Stores device states and tracks when they were last changed.
 * Used by the IoT monitoring workflow to detect state changes.
 */

import { type Client, createClient } from '@libsql/client';

export interface StoredDeviceState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: string;
  lastUpdated: string;
}

export interface DeviceStateChange {
  entityId: string;
  previousState: string;
  currentState: string;
  previousAttributes: Record<string, unknown>;
  currentAttributes: Record<string, unknown>;
  changedAt: string;
}

export class DeviceStateStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = createClient({
      url: `file:${databasePath}`,
    });
  }

  /**
   * Initialize the device state table if it doesn't exist
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS iot_device_states (
        entity_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        attributes TEXT NOT NULL,
        last_changed TEXT NOT NULL,
        last_updated TEXT NOT NULL
      )
    `);

    this.initialized = true;
  }

  /**
   * Get all stored device states
   */
  async getAllStates(): Promise<Map<string, StoredDeviceState>> {
    await this.initialize();

    const result = await this.client.execute('SELECT * FROM iot_device_states');

    const states = new Map<string, StoredDeviceState>();
    for (const row of result.rows) {
      states.set(row.entity_id as string, {
        entityId: row.entity_id as string,
        state: row.state as string,
        attributes: JSON.parse(row.attributes as string),
        lastChanged: row.last_changed as string,
        lastUpdated: row.last_updated as string,
      });
    }

    return states;
  }

  /**
   * Get a specific device state
   */
  async getState(entityId: string): Promise<StoredDeviceState | null> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'SELECT * FROM iot_device_states WHERE entity_id = ?',
      args: [entityId],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      entityId: row.entity_id as string,
      state: row.state as string,
      attributes: JSON.parse(row.attributes as string),
      lastChanged: row.last_changed as string,
      lastUpdated: row.last_updated as string,
    };
  }

  /**
   * Update a device state, returning the previous state if it changed
   */
  async updateState(
    entityId: string,
    state: string,
    attributes: Record<string, unknown>,
    lastChanged: string,
  ): Promise<DeviceStateChange | null> {
    await this.initialize();

    const now = new Date().toISOString();
    const previousState = await this.getState(entityId);

    // Check if state actually changed
    const stateChanged =
      !previousState ||
      previousState.state !== state ||
      JSON.stringify(previousState.attributes) !== JSON.stringify(attributes);

    // Always update the last_updated timestamp
    await this.client.execute({
      sql: `
        INSERT INTO iot_device_states (entity_id, state, attributes, last_changed, last_updated)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entity_id) DO UPDATE SET
          state = excluded.state,
          attributes = excluded.attributes,
          last_changed = CASE 
            WHEN iot_device_states.state != excluded.state 
              OR iot_device_states.attributes != excluded.attributes 
            THEN excluded.last_changed 
            ELSE iot_device_states.last_changed 
          END,
          last_updated = excluded.last_updated
      `,
      args: [entityId, state, JSON.stringify(attributes), lastChanged, now],
    });

    // Return the change if state actually changed
    if (stateChanged && previousState) {
      return {
        entityId,
        previousState: previousState.state,
        currentState: state,
        previousAttributes: previousState.attributes,
        currentAttributes: attributes,
        changedAt: lastChanged,
      };
    }

    return null;
  }

  /**
   * Bulk update device states and return all changes
   */
  async updateStates(
    states: Array<{ entityId: string; state: string; attributes: Record<string, unknown>; lastChanged: string }>,
  ): Promise<DeviceStateChange[]> {
    const changes: DeviceStateChange[] = [];

    for (const deviceState of states) {
      const change = await this.updateState(
        deviceState.entityId,
        deviceState.state,
        deviceState.attributes,
        deviceState.lastChanged,
      );
      if (change) {
        changes.push(change);
      }
    }

    return changes;
  }

  /**
   * Delete a device state
   */
  async deleteState(entityId: string): Promise<void> {
    await this.initialize();

    await this.client.execute({
      sql: 'DELETE FROM iot_device_states WHERE entity_id = ?',
      args: [entityId],
    });
  }

  /**
   * Clear all device states
   */
  async clearAllStates(): Promise<void> {
    await this.initialize();

    await this.client.execute('DELETE FROM iot_device_states');
  }
}
