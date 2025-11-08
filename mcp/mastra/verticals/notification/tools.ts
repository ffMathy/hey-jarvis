import { createTool } from '../../utils/tool-factory.js';
import { z } from 'zod';

/**
 * Tool to send proactive notifications to Home Assistant Voice Preview Edition devices.
 * This triggers the elevenlabs_stream.start action with a custom initial message and timeout.
 */
export const notifyDeviceTool = createTool({
  id: 'notify-device',
  description: 'Send a proactive voice notification to Home Assistant Voice Preview Edition device(s) running the Hey Jarvis ElevenLabs firmware. The notification will start a conversation where the user can respond, with a 5-second timeout if no response is received.',
  inputSchema: z.object({
    message: z.string().describe('The notification message that Jarvis will speak to the user'),
    deviceEntityId: z.string().optional().describe('Optional: Specific device entity ID to notify. If not provided, notifies all devices. Example: "binary_sensor.hass_elevenlabs_center_button"'),
    conversationTimeout: z.number().optional().default(5000).describe('Timeout in milliseconds after which the conversation ends if no user input. Default is 5000 (5 seconds)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    devicesNotified: z.array(z.string()).optional(),
  }),
  execute: async ({ context }) => {
    try {
      const { message, deviceEntityId, conversationTimeout = 5000 } = context;
      
      // Get Home Assistant Supervisor API URL from environment
      const supervisorToken = process.env.SUPERVISOR_TOKEN;
      const homeAssistantUrl = process.env.HOME_ASSISTANT_URL || 'http://supervisor/core';
      
      if (!supervisorToken) {
        return {
          success: false,
          message: 'Home Assistant Supervisor token not available. This tool only works when running inside Home Assistant addon.',
        };
      }

      // Call Home Assistant service to trigger notification
      // We'll use the elevenlabs_stream.start service with custom parameters
      const serviceData: any = {
        initial_message: message,
        timeout: conversationTimeout,
      };

      // If specific device is provided, target that device
      if (deviceEntityId) {
        serviceData.entity_id = deviceEntityId;
      }

      const response = await fetch(`${homeAssistantUrl}/api/services/elevenlabs_stream/start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supervisorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serviceData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: `Failed to send notification: ${response.status} ${response.statusText}. ${errorText}`,
        };
      }

      const result = await response.json();
      
      return {
        success: true,
        message: deviceEntityId 
          ? `Notification sent to device ${deviceEntityId}` 
          : 'Notification sent to all available devices',
        devicesNotified: result.context?.entity_id ? [result.context.entity_id] : undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error sending notification: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const notificationTools = {
  notifyDevice: notifyDeviceTool,
};
