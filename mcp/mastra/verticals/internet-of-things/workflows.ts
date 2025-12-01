import { z } from 'zod';
import { type DeviceStateChange, getDeviceStateStorage } from '../../storage/index.js';
import { createStep, createWorkflow } from '../../utils/workflow-factory.js';
import { registerStateChange } from '../synapse/tools.js';
import { getAllDevices } from './tools.js';

// Fetch all device states from Home Assistant
const fetchDeviceStates = createStep({
  id: 'fetch-device-states',
  description: 'Fetches all device states from Home Assistant',
  inputSchema: z.object({}),
  outputSchema: z.object({
    devices: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        entities: z.array(
          z.object({
            id: z.string(),
            domain: z.string(),
            state: z.string(),
            attributes: z.record(z.unknown()),
            last_changed: z.string(),
          }),
        ),
      }),
    ),
    timestamp: z.string(),
  }),
  execute: async () => {
    const result = await getAllDevices.execute({});

    return {
      devices: result.devices.map((device) => ({
        id: device.id,
        name: device.name,
        entities: device.entities.map((entity) => ({
          id: entity.id,
          domain: entity.domain,
          state: entity.state,
          attributes: entity.attributes,
          last_changed: entity.last_changed,
        })),
      })),
      timestamp: new Date().toISOString(),
    };
  },
});

// Compare with stored states and detect changes
const detectStateChanges = createStep({
  id: 'detect-state-changes',
  description: 'Compares current device states with stored states and detects changes',
  inputSchema: z.object({
    devices: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        entities: z.array(
          z.object({
            id: z.string(),
            domain: z.string(),
            state: z.string(),
            attributes: z.record(z.unknown()),
            last_changed: z.string(),
          }),
        ),
      }),
    ),
    timestamp: z.string(),
  }),
  outputSchema: z.object({
    changes: z.array(
      z.object({
        entityId: z.string(),
        previousState: z.string(),
        currentState: z.string(),
        previousAttributes: z.record(z.unknown()),
        currentAttributes: z.record(z.unknown()),
        changedAt: z.string(),
      }),
    ),
    totalEntities: z.number(),
    timestamp: z.string(),
  }),
  execute: async ({ inputData }) => {
    const storage = await getDeviceStateStorage();

    // Flatten all entities from all devices
    const currentStates = inputData.devices.flatMap((device) =>
      device.entities.map((entity) => ({
        entityId: entity.id,
        state: entity.state,
        attributes: entity.attributes,
        lastChanged: entity.last_changed,
      })),
    );

    // Update storage and get changes
    const changes = await storage.updateStates(currentStates);

    console.log(
      `📊 IoT Monitoring: ${currentStates.length} entities tracked, ${changes.length} state change(s) detected`,
    );

    return {
      changes,
      totalEntities: currentStates.length,
      timestamp: inputData.timestamp,
    };
  },
});

// Trigger state change notifications for detected changes
const triggerStateChangeNotifications = createStep({
  id: 'trigger-state-change-notifications',
  description: 'Triggers state change notifications for detected IoT device changes',
  inputSchema: z.object({
    changes: z.array(
      z.object({
        entityId: z.string(),
        previousState: z.string(),
        currentState: z.string(),
        previousAttributes: z.record(z.unknown()),
        currentAttributes: z.record(z.unknown()),
        changedAt: z.string(),
      }),
    ),
    totalEntities: z.number(),
    timestamp: z.string(),
  }),
  outputSchema: z.object({
    changesProcessed: z.number(),
    notificationsTriggered: z.number(),
    timestamp: z.string(),
  }),
  execute: async ({ inputData }) => {
    let notificationsTriggered = 0;

    for (const change of inputData.changes) {
      try {
        await registerStateChange.execute({
          source: 'internet-of-things',
          stateType: 'device_state_change',
          stateData: {
            entityId: change.entityId,
            previousState: change.previousState,
            currentState: change.currentState,
            previousAttributes: change.previousAttributes,
            currentAttributes: change.currentAttributes,
            changedAt: change.changedAt,
            detectedAt: inputData.timestamp,
          },
        });

        notificationsTriggered++;

        console.log(
          `🔔 State change registered: ${change.entityId} changed from "${change.previousState}" to "${change.currentState}"`,
        );
      } catch (error) {
        console.error(`❌ Failed to register state change for ${change.entityId}:`, error);
      }
    }

    return {
      changesProcessed: inputData.changes.length,
      notificationsTriggered,
      timestamp: inputData.timestamp,
    };
  },
});

// IoT Monitoring Workflow
// Polls all device states, compares with stored states, detects changes,
// and triggers the state change notification system
export const iotMonitoringWorkflow = createWorkflow({
  id: 'iotMonitoringWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({
    changesProcessed: z.number(),
    notificationsTriggered: z.number(),
    timestamp: z.string(),
  }),
})
  .then(fetchDeviceStates)
  .then(detectStateChanges)
  .then(triggerStateChangeNotifications)
  .commit();
