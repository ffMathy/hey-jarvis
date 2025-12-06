import { z } from 'zod';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { getChangedDevicesSince } from './tools.js';

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

    console.log(
      `📊 IoT Monitoring: ${result.total_changed} entities changed in last ${STATE_CHANGE_WINDOW_SECONDS}s, ${devices.length} non-sensitive device(s) with changes`,
    );

    return {
      devices,
      timestamp: new Date().toISOString(),
    };
  },
});

// Trigger state change notifications for detected changes
const triggerStateChangeNotifications = createStep({
  id: 'trigger-state-change-notifications',
  description: 'Triggers state change notifications for detected IoT device changes',
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
    timestamp: z.string(),
  }),
  execute: async ({ inputData }) => {
    let changesProcessed = 0;
    let notificationsTriggered = 0;

    for (const device of inputData.devices) {
      for (const entity of device.entities) {
        changesProcessed++;
        try {
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

          console.log(`🔔 State change registered: ${entity.id} on ${device.name} changed to "${entity.newState}"`);
        } catch (error) {
          console.error(`❌ Failed to register state change for ${entity.id}:`, error);
        }
      }
    }

    return {
      changesProcessed,
      notificationsTriggered,
      timestamp: inputData.timestamp,
    };
  },
});

// IoT Monitoring Workflow
// Uses Home Assistant's last_changed timestamp to detect recent state changes,
// filters out sensitive devices/entities, and triggers state change notifications.
// This matches the old n8n behavior of polling for changes in the last 60 seconds.
export const iotMonitoringWorkflow = createWorkflow({
  id: 'iotMonitoringWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    changesProcessed: z.number(),
    notificationsTriggered: z.number(),
    timestamp: z.string(),
  }),
})
  .then(fetchRecentlyChangedDevices)
  .then(triggerStateChangeNotifications)
  .commit();
