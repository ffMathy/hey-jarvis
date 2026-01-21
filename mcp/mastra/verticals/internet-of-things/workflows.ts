import { z } from 'zod';
import { getDeviceStateStorage, getEntityNoiseBaselineStorage } from '../../storage/index.js';
import { isValidationError } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { fetchHistoricalStates, getChangedDevicesSince } from './tools.js';

/**
 * Label used to mark devices/entities that should be excluded from state change monitoring.
 * This matches the old n8n behavior where 'sensitive' labeled items were filtered out.
 */
const SENSITIVE_LABEL = 'sensitive';

/**
 * Time window in seconds to look back for state changes.
 * Set to 3 hours to match the scheduler interval.
 */
const STATE_CHANGE_WINDOW_SECONDS = 3 * 60 * 60;

/**
 * Time window in seconds to look back for historical data when calculating noise baselines.
 * Set to 15 minutes to capture recent fluctuation patterns.
 */
const NOISE_BASELINE_HISTORY_SECONDS = 15 * 60;

// Calculate noise baselines from historical data
const calculateNoiseBaselines = createStep({
  id: 'calculate-noise-baselines',
  description:
    'Fetches historical state data and calculates noise baselines for entities to filter insignificant changes',
  inputSchema: z.object({}),
  outputSchema: z.object({
    baselinesCalculated: z.number(),
    timestamp: z.string(),
  }),
  execute: async () => {
    const startTime = new Date(Date.now() - NOISE_BASELINE_HISTORY_SECONDS * 1000).toISOString();
    const endTime = new Date().toISOString();

    logger.info('Calculating noise baselines', {
      startTime,
      endTime,
      windowSeconds: NOISE_BASELINE_HISTORY_SECONDS,
    });

    try {
      const result = await fetchHistoricalStates({
        startTime,
        endTime,
        minimalResponse: true,
      });

      // Calculate baselines from history
      const storage = await getEntityNoiseBaselineStorage();
      const baselines = await storage.calculateBaselinesFromHistory(result.history);

      logger.info('Noise baselines calculated', {
        baselinesCalculated: baselines.length,
        entityCount: result.entityCount,
      });

      return {
        baselinesCalculated: baselines.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Error calculating noise baselines', { error });
      return {
        baselinesCalculated: 0,
        timestamp: new Date().toISOString(),
      };
    }
  },
});

// Fetch recently changed device states from Home Assistant
const fetchRecentlyChangedDevices = createStep({
  id: 'fetch-recently-changed-devices',
  description: 'Fetches devices that changed state in the last 3 hours from Home Assistant',
  inputSchema: z.object({}),
  outputSchema: z.object({
    devices: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        entities: z.array(
          z.object({
            id: z.string(),
            newState: z.string(),
            lastChanged: z.string(),
          }),
        ),
      }),
    ),
    timestamp: z.string(),
  }),
  execute: async () => {
    const result = await getChangedDevicesSince.execute({
      sinceSeconds: STATE_CHANGE_WINDOW_SECONDS,
    });

    // Handle ValidationError case using type guard for proper type narrowing
    if (isValidationError(result)) {
      logger.error('IoT Monitoring: failed to fetch changed devices', { message: result.message });
      return {
        devices: [],
        timestamp: new Date().toISOString(),
      };
    }

    // Group by device and filter out sensitive labels (matching old n8n behavior)
    const deviceMap = new Map<
      string,
      { id: string; name: string; entities: Array<{ id: string; newState: string; lastChanged: string }> }
    >();

    for (const item of result.changed_devices) {
      // Skip if device or entity has the sensitive label
      if (item.device_label_ids?.includes(SENSITIVE_LABEL) || item.entity_label_ids?.includes(SENSITIVE_LABEL)) {
        continue;
      }

      const deviceId = item.device_id || 'unknown';
      const deviceName = item.device_name || 'Unknown Device';

      if (!deviceMap.has(deviceId)) {
        deviceMap.set(deviceId, {
          id: deviceId,
          name: deviceName,
          entities: [],
        });
      }

      const device = deviceMap.get(deviceId);
      if (device) {
        device.entities.push({
          id: item.entity_id,
          newState: item.state,
          lastChanged: new Date(item.last_changed * 1000).toISOString(),
        });
      }
    }

    const devices = Array.from(deviceMap.values());

    logger.info('IoT Monitoring: entities changed', {
      totalChanged: result.total_changed,
      windowSeconds: STATE_CHANGE_WINDOW_SECONDS,
      devicesWithChanges: devices.length,
    });

    return {
      devices,
      timestamp: new Date().toISOString(),
    };
  },
});

// Trigger state change notifications for detected changes
const triggerStateChangeNotifications = createStep({
  id: 'trigger-state-change-notifications',
  description: 'Triggers state change notifications for detected IoT device changes, filtering out noise',
  inputSchema: z.object({
    devices: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        entities: z.array(
          z.object({
            id: z.string(),
            newState: z.string(),
            lastChanged: z.string(),
          }),
        ),
      }),
    ),
    timestamp: z.string(),
  }),
  outputSchema: z.object({
    changesProcessed: z.number(),
    notificationsTriggered: z.number(),
    filteredAsNoise: z.number(),
    timestamp: z.string(),
  }),
  execute: async ({ inputData }) => {
    let changesProcessed = 0;
    let notificationsTriggered = 0;
    let filteredAsNoise = 0;

    // Get storage instances
    const noiseBaselineStorage = await getEntityNoiseBaselineStorage();
    const deviceStateStorage = await getDeviceStateStorage();

    for (const device of inputData.devices) {
      for (const entity of device.entities) {
        changesProcessed++;

        try {
          // Get the previous state from device state storage
          const previousState = await deviceStateStorage.getState(entity.id);

          // Update the state in storage
          await deviceStateStorage.updateState(
            entity.id,
            entity.newState,
            {}, // attributes not available from getChangedDevicesSince
            entity.lastChanged,
          );

          // Check if this is a significant change using noise baseline
          if (previousState) {
            const analysis = await noiseBaselineStorage.isSignificantChange(
              entity.id,
              previousState.state,
              entity.newState,
            );

            if (!analysis.isSignificantChange) {
              logger.info('State change filtered as noise', {
                entityId: entity.id,
                deviceName: device.name,
                oldValue: previousState.state,
                newValue: entity.newState,
                changeAmount: analysis.changeAmount,
                threshold: analysis.threshold,
              });
              filteredAsNoise++;
              continue; // Skip this change as it's within noise threshold
            }
          }

          // If we reach here, the change is significant (or no baseline/previous state exists)
          await registerStateChange.execute({
            source: 'internet-of-things',
            stateType: 'device_state_change',
            stateData: {
              deviceId: device.id,
              deviceName: device.name,
              entityId: entity.id,
              newState: entity.newState,
              lastChanged: entity.lastChanged,
              detectedAt: inputData.timestamp,
            },
          });

          notificationsTriggered++;

          logger.info('State change registered', {
            entityId: entity.id,
            deviceName: device.name,
            // Do not log newState value as it may contain sensitive data
          });
        } catch (error) {
          logger.error('Failed to register state change', {
            entityId: entity.id,
            error,
          });
        }
      }
    }

    return {
      changesProcessed,
      notificationsTriggered,
      filteredAsNoise,
      timestamp: inputData.timestamp,
    };
  },
});

// IoT Monitoring Workflow
// Uses Home Assistant's last_changed timestamp to detect recent state changes,
// filters out sensitive devices/entities, calculates noise baselines from historical data,
// and triggers state change notifications only for significant changes.
export const iotMonitoringWorkflow = createWorkflow({
  id: 'iotMonitoringWorkflow',
  stateSchema: z.object({}).partial(), // No state needed for this workflow
  inputSchema: z.object({}),
  outputSchema: z.object({
    changesProcessed: z.number(),
    notificationsTriggered: z.number(),
    filteredAsNoise: z.number(),
    timestamp: z.string(),
  }),
})
  .then(calculateNoiseBaselines)
  .then(fetchRecentlyChangedDevices)
  .then(triggerStateChangeNotifications)
  .commit();
