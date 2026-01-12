/**
 * Tests for Entity Noise Baseline Storage
 *
 * Tests the storage and calculation of noise baselines for IoT entities.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import path from 'path';
import { EntityNoiseBaselineStorage } from '../mastra/storage/entity-noise-baseline.js';

describe('EntityNoiseBaselineStorage', () => {
  let storage: EntityNoiseBaselineStorage;
  const testDbPath = path.join('/tmp', `test-noise-baseline-${Date.now()}.db`);

  beforeEach(async () => {
    storage = new EntityNoiseBaselineStorage(testDbPath);
  });

  afterEach(async () => {
    await storage.clearAllBaselines();
  });

  describe('calculateBaselinesFromHistory', () => {
    test('should calculate numeric baseline from temperature fluctuations', async () => {
      const history = {
        'sensor.temperature': [
          { state: '20.1', last_changed: '2024-01-01T12:00:00Z' },
          { state: '20.2', last_changed: '2024-01-01T12:05:00Z' },
          { state: '20.0', last_changed: '2024-01-01T12:10:00Z' },
          { state: '20.3', last_changed: '2024-01-01T12:15:00Z' },
          { state: '20.1', last_changed: '2024-01-01T12:20:00Z' },
        ],
      };

      const baselines = await storage.calculateBaselinesFromHistory(history);

      expect(baselines.length).toBe(1);
      expect(baselines[0].entityId).toBe('sensor.temperature');
      expect(baselines[0].stateType).toBe('numeric');
      expect(baselines[0].numericThreshold).toBeGreaterThan(0);
      expect(baselines[0].typicalFluctuation).toBeGreaterThan(0);
      expect(baselines[0].sampleCount).toBe(5);
    });

    test('should handle string states', async () => {
      const history = {
        'light.living_room': [
          { state: 'on', last_changed: '2024-01-01T12:00:00Z' },
          { state: 'off', last_changed: '2024-01-01T12:05:00Z' },
          { state: 'on', last_changed: '2024-01-01T12:10:00Z' },
        ],
      };

      const baselines = await storage.calculateBaselinesFromHistory(history);

      expect(baselines.length).toBe(1);
      expect(baselines[0].entityId).toBe('light.living_room');
      expect(baselines[0].stateType).toBe('string');
      expect(baselines[0].numericThreshold).toBeUndefined();
      expect(baselines[0].sampleCount).toBe(3);
    });

    test('should skip entities with less than 2 states', async () => {
      const history = {
        'sensor.single': [{ state: '20.0', last_changed: '2024-01-01T12:00:00Z' }],
        'sensor.multiple': [
          { state: '20.0', last_changed: '2024-01-01T12:00:00Z' },
          { state: '20.1', last_changed: '2024-01-01T12:05:00Z' },
        ],
      };

      const baselines = await storage.calculateBaselinesFromHistory(history);

      expect(baselines.length).toBe(1);
      expect(baselines[0].entityId).toBe('sensor.multiple');
    });
  });

  describe('isSignificantChange', () => {
    test('should detect significant numeric change exceeding threshold', async () => {
      // Create a baseline with known threshold
      await storage.saveBaseline({
        entityId: 'sensor.temperature',
        stateType: 'numeric',
        numericThreshold: 0.5,
        typicalFluctuation: 0.1,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0', '20.1', '20.0', '20.2', '20.1'],
      });

      const result = await storage.isSignificantChange('sensor.temperature', '20.0', '21.0');

      expect(result.isSignificantChange).toBe(true);
      expect(result.changeAmount).toBeGreaterThan(0.5);
    });

    test('should filter insignificant numeric change below threshold', async () => {
      // Create a baseline with known threshold
      await storage.saveBaseline({
        entityId: 'sensor.temperature',
        stateType: 'numeric',
        numericThreshold: 0.5,
        typicalFluctuation: 0.1,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0', '20.1', '20.0', '20.2', '20.1'],
      });

      const result = await storage.isSignificantChange('sensor.temperature', '20.0', '20.2');

      // Small change of 0.2 should be below the 0.5 threshold
      expect(result.isSignificantChange).toBe(false);
      expect(result.changeAmount).toBeLessThanOrEqual(0.5);
    });

    test('should detect string state changes', async () => {
      await storage.saveBaseline({
        entityId: 'light.living_room',
        stateType: 'string',
        sampleCount: 3,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['on', 'off', 'on'],
      });

      const resultSame = await storage.isSignificantChange('light.living_room', 'on', 'on');
      expect(resultSame.isSignificantChange).toBe(false);

      const resultDifferent = await storage.isSignificantChange('light.living_room', 'on', 'off');
      expect(resultDifferent.isSignificantChange).toBe(true);
    });

    test('should consider all changes significant when no baseline exists', async () => {
      const result = await storage.isSignificantChange('sensor.unknown', '20.0', '20.1');

      expect(result.isSignificantChange).toBe(true);
    });
  });

  describe('getBaseline and saveBaseline', () => {
    test('should save and retrieve baseline', async () => {
      const baseline = {
        entityId: 'sensor.test',
        stateType: 'numeric' as const,
        numericThreshold: 0.5,
        typicalFluctuation: 0.1,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0', '20.1', '20.0', '20.2', '20.1'],
      };

      await storage.saveBaseline(baseline);
      const retrieved = await storage.getBaseline('sensor.test');

      expect(retrieved).toBeDefined();
      expect(retrieved?.entityId).toBe(baseline.entityId);
      expect(retrieved?.stateType).toBe(baseline.stateType);
      expect(retrieved?.numericThreshold).toBe(baseline.numericThreshold);
    });

    test('should update existing baseline', async () => {
      const baseline = {
        entityId: 'sensor.test',
        stateType: 'numeric' as const,
        numericThreshold: 0.5,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0', '20.1'],
      };

      await storage.saveBaseline(baseline);

      const updated = {
        ...baseline,
        numericThreshold: 1.0,
        sampleCount: 10,
      };

      await storage.saveBaseline(updated);
      const retrieved = await storage.getBaseline('sensor.test');

      expect(retrieved?.numericThreshold).toBe(1.0);
      expect(retrieved?.sampleCount).toBe(10);
    });

    test('should return null for non-existent baseline', async () => {
      const retrieved = await storage.getBaseline('sensor.nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('getAllBaselines', () => {
    test('should return all baselines', async () => {
      await storage.saveBaseline({
        entityId: 'sensor.temp1',
        stateType: 'numeric',
        numericThreshold: 0.5,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0'],
      });

      await storage.saveBaseline({
        entityId: 'sensor.temp2',
        stateType: 'numeric',
        numericThreshold: 0.3,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['21.0'],
      });

      const baselines = await storage.getAllBaselines();

      expect(baselines.size).toBe(2);
      expect(baselines.has('sensor.temp1')).toBe(true);
      expect(baselines.has('sensor.temp2')).toBe(true);
    });

    test('should return empty map when no baselines exist', async () => {
      const baselines = await storage.getAllBaselines();
      expect(baselines.size).toBe(0);
    });
  });

  describe('deleteBaseline', () => {
    test('should delete a specific baseline', async () => {
      await storage.saveBaseline({
        entityId: 'sensor.test',
        stateType: 'numeric',
        numericThreshold: 0.5,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0'],
      });

      await storage.deleteBaseline('sensor.test');
      const retrieved = await storage.getBaseline('sensor.test');

      expect(retrieved).toBeNull();
    });
  });

  describe('clearAllBaselines', () => {
    test('should clear all baselines', async () => {
      await storage.saveBaseline({
        entityId: 'sensor.test1',
        stateType: 'numeric',
        numericThreshold: 0.5,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['20.0'],
      });

      await storage.saveBaseline({
        entityId: 'sensor.test2',
        stateType: 'numeric',
        numericThreshold: 0.3,
        sampleCount: 5,
        lastCalculated: new Date().toISOString(),
        historicalStates: ['21.0'],
      });

      await storage.clearAllBaselines();
      const baselines = await storage.getAllBaselines();

      expect(baselines.size).toBe(0);
    });
  });
});
