/**
 * IoT Device State Storage
 *
 * Stores device states and tracks when they were last changed.
 * Used by the IoT monitoring workflow to detect state changes.
 */

import { type Client, createClient } from '@libsql/client';
import { isEqual } from 'lodash-es';

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

/**
 * Attributes that change frequently but are not meaningful for state change detection.
 * These are filtered out to prevent excessive notifications.
 */
const NOISY_ATTRIBUTES = new Set([
  // GPS/Location attributes that change constantly
  'latitude',
  'longitude',
  'gps_accuracy',
  'altitude',
  'speed',
  'bearing',
  'course',
  'vertical_accuracy',
  // Timestamp attributes
  'last_seen',
  'last_updated',
  'last_changed',
  'last_triggered',
  // Battery/signal attributes that fluctuate
  'battery_level',
  'signal_strength',
  'rssi',
  'linkquality',
  // Media player position that constantly updates
  'media_position',
  'media_position_updated_at',
  // Other frequently changing attributes
  'uptime',
  'cpu_percent',
  'memory_percent',
  'memory_free',
  'disk_free',
  'temperature',
]);

/**
 * Filter out noisy attributes that shouldn't trigger state change notifications.
 * Returns a new object with only meaningful attributes for comparison.
 */
function filterNoisyAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!NOISY_ATTRIBUTES.has(key.toLowerCase())) {
      filtered[key] = value;
    }
  }
  return filtered;
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

    // Filter out noisy attributes for comparison to reduce false positives
    const filteredCurrentAttributes = filterNoisyAttributes(attributes);
    const filteredPreviousAttributes = previousState ? filterNoisyAttributes(previousState.attributes) : {};

    // Check if state actually changed (using filtered attributes for comparison)
    const stateChanged =
      !previousState ||
      previousState.state !== state ||
      !isEqual(filteredPreviousAttributes, filteredCurrentAttributes);

    // Always update the last_updated timestamp (store full attributes for reference)
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

    // Return the change if state actually changed (only for meaningful changes)
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
