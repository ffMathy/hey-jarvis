/**
 * Entity Noise Baseline Storage
 *
 * Stores noise baseline thresholds for IoT entities to filter out insignificant state changes.
 * Baselines are calculated from historical state data to determine typical fluctuation levels.
 */

import { type Client, createClient } from '@libsql/client';

export interface EntityNoiseBaseline {
  entityId: string;
  stateType: 'numeric' | 'string';
  numericThreshold?: number;
  typicalFluctuation?: number;
  sampleCount: number;
  lastCalculated: string;
  historicalStates: string[]; // Sample of recent states used for baseline
}

export interface NoiseAnalysisResult {
  entityId: string;
  isSignificantChange: boolean;
  oldValue: string;
  newValue: string;
  changeAmount?: number;
  threshold?: number;
}

/**
 * Maximum number of historical state samples to keep for reference
 */
const MAX_HISTORICAL_SAMPLES = 20;

export class EntityNoiseBaselineStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = createClient({
      url: `file:${databasePath}`,
    });
  }

  /**
   * Initialize the entity noise baseline table if it doesn't exist
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS iot_entity_noise_baselines (
        entity_id TEXT PRIMARY KEY,
        state_type TEXT NOT NULL,
        numeric_threshold REAL,
        typical_fluctuation REAL,
        sample_count INTEGER NOT NULL,
        last_calculated TEXT NOT NULL,
        historical_states TEXT NOT NULL
      )
    `);

    this.initialized = true;
  }

  /**
   * Get baseline for a specific entity
   */
  async getBaseline(entityId: string): Promise<EntityNoiseBaseline | null> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'SELECT * FROM iot_entity_noise_baselines WHERE entity_id = ?',
      args: [entityId],
    });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      entityId: row.entity_id as string,
      stateType: row.state_type as 'numeric' | 'string',
      numericThreshold: row.numeric_threshold ? (row.numeric_threshold as number) : undefined,
      typicalFluctuation: row.typical_fluctuation ? (row.typical_fluctuation as number) : undefined,
      sampleCount: row.sample_count as number,
      lastCalculated: row.last_calculated as string,
      historicalStates: JSON.parse(row.historical_states as string),
    };
  }

  /**
   * Get all baselines
   */
  async getAllBaselines(): Promise<Map<string, EntityNoiseBaseline>> {
    await this.initialize();

    const result = await this.client.execute('SELECT * FROM iot_entity_noise_baselines');

    const baselines = new Map<string, EntityNoiseBaseline>();
    for (const row of result.rows) {
      baselines.set(row.entity_id as string, {
        entityId: row.entity_id as string,
        stateType: row.state_type as 'numeric' | 'string',
        numericThreshold: row.numeric_threshold ? (row.numeric_threshold as number) : undefined,
        typicalFluctuation: row.typical_fluctuation ? (row.typical_fluctuation as number) : undefined,
        sampleCount: row.sample_count as number,
        lastCalculated: row.last_calculated as string,
        historicalStates: JSON.parse(row.historical_states as string),
      });
    }

    return baselines;
  }

  /**
   * Save or update a baseline for an entity
   */
  async saveBaseline(baseline: EntityNoiseBaseline): Promise<void> {
    await this.initialize();

    await this.client.execute({
      sql: `
        INSERT INTO iot_entity_noise_baselines (
          entity_id, state_type, numeric_threshold, typical_fluctuation,
          sample_count, last_calculated, historical_states
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_id) DO UPDATE SET
          state_type = excluded.state_type,
          numeric_threshold = excluded.numeric_threshold,
          typical_fluctuation = excluded.typical_fluctuation,
          sample_count = excluded.sample_count,
          last_calculated = excluded.last_calculated,
          historical_states = excluded.historical_states
      `,
      args: [
        baseline.entityId,
        baseline.stateType,
        baseline.numericThreshold ?? null,
        baseline.typicalFluctuation ?? null,
        baseline.sampleCount,
        baseline.lastCalculated,
        JSON.stringify(baseline.historicalStates),
      ],
    });
  }

  /**
   * Analyze if a state change is significant based on baseline
   */
  async isSignificantChange(entityId: string, oldState: string, newState: string): Promise<NoiseAnalysisResult> {
    const baseline = await this.getBaseline(entityId);

    // If no baseline exists, consider all changes significant
    if (!baseline) {
      return {
        entityId,
        isSignificantChange: true,
        oldValue: oldState,
        newValue: newState,
      };
    }

    // For string states, any change is significant
    if (baseline.stateType === 'string') {
      return {
        entityId,
        isSignificantChange: oldState !== newState,
        oldValue: oldState,
        newValue: newState,
      };
    }

    // For numeric states, check if change exceeds threshold
    const oldNumeric = Number.parseFloat(oldState);
    const newNumeric = Number.parseFloat(newState);

    // If either value is not a valid number, treat as string comparison
    if (Number.isNaN(oldNumeric) || Number.isNaN(newNumeric)) {
      return {
        entityId,
        isSignificantChange: oldState !== newState,
        oldValue: oldState,
        newValue: newState,
      };
    }

    const changeAmount = Math.abs(newNumeric - oldNumeric);
    const threshold = baseline.numericThreshold || 0;

    return {
      entityId,
      isSignificantChange: changeAmount > threshold,
      oldValue: oldState,
      newValue: newState,
      changeAmount,
      threshold,
    };
  }

  /**
   * Calculate and save baselines from historical state data
   */
  async calculateBaselinesFromHistory(
    history: Record<string, Array<{ state: string; last_changed: string }>>,
  ): Promise<EntityNoiseBaseline[]> {
    const baselines: EntityNoiseBaseline[] = [];

    for (const [entityId, states] of Object.entries(history)) {
      if (states.length < 2) {
        continue; // Need at least 2 states to calculate fluctuation
      }

      // Extract state values
      const stateValues = states.map((s) => s.state);

      // Try to parse as numeric
      const numericValues = stateValues.map((s) => Number.parseFloat(s)).filter((n) => !Number.isNaN(n));

      let baseline: EntityNoiseBaseline;

      if (numericValues.length > 0 && numericValues.length === stateValues.length) {
        // All values are numeric - calculate numeric threshold
        const fluctuations: number[] = [];
        for (let i = 1; i < numericValues.length; i++) {
          fluctuations.push(Math.abs(numericValues[i] - numericValues[i - 1]));
        }

        // Calculate average fluctuation
        const avgFluctuation = fluctuations.reduce((sum, f) => sum + f, 0) / fluctuations.length;

        // Calculate standard deviation
        const variance = fluctuations.reduce((sum, f) => sum + (f - avgFluctuation) ** 2, 0) / fluctuations.length;
        const stdDev = Math.sqrt(variance);

        // Set threshold to average + 1 standard deviation
        // This means changes larger than typical + 1 std dev are considered significant
        const threshold = avgFluctuation + stdDev;

        baseline = {
          entityId,
          stateType: 'numeric',
          numericThreshold: threshold,
          typicalFluctuation: avgFluctuation,
          sampleCount: states.length,
          lastCalculated: new Date().toISOString(),
          historicalStates: stateValues.slice(-MAX_HISTORICAL_SAMPLES), // Keep last N states as sample
        };
      } else {
        // String-based state - store samples for reference
        baseline = {
          entityId,
          stateType: 'string',
          sampleCount: states.length,
          lastCalculated: new Date().toISOString(),
          historicalStates: stateValues.slice(-MAX_HISTORICAL_SAMPLES), // Keep last N states as sample
        };
      }

      await this.saveBaseline(baseline);
      baselines.push(baseline);
    }

    return baselines;
  }

  /**
   * Clear all baselines
   */
  async clearAllBaselines(): Promise<void> {
    await this.initialize();

    await this.client.execute('DELETE FROM iot_entity_noise_baselines');
  }

  /**
   * Delete a specific baseline
   */
  async deleteBaseline(entityId: string): Promise<void> {
    await this.initialize();

    await this.client.execute({
      sql: 'DELETE FROM iot_entity_noise_baselines WHERE entity_id = ?',
      args: [entityId],
    });
  }
}
