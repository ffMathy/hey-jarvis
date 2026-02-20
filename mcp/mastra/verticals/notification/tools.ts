import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

/**
 * Tool to send proactive notifications to Home Assistant Voice Preview Edition devices.
 *
 * NOTE: This tool requires Home Assistant configuration to expose a service that can trigger
 * the elevenlabs_stream.start action with custom parameters.
 *
 * Example Home Assistant configuration (in configuration.yaml or scripts.yaml):
 *
 * ```yaml
 * script:
 *   jarvis_notify:
 *     fields:
 *       message:
 *         description: 'The notification message'
 *       device:
 *         description: 'Device entity ID (optional)'
 *       timeout:
 *         description: 'Timeout in milliseconds (default: 5000)'
 *     sequence:
 *       - event: esphome.hass_elevenlabs_notification
 *         event_data:
 *           message: "{{ message }}"
 *           device: "{{ device | default('') }}"
 *           timeout: "{{ timeout | default(5000) }}"
 * ```
 *
 * And in the ESPHome device configuration:
 *
 * ```yaml
 * api:
 *   services:
 *     - service: send_notification
 *       variables:
 *         message: string
 *         timeout: int
 *       then:
 *         - elevenlabs_stream.start:
 *             initial_message: !lambda 'return message;'
 *             timeout: !lambda 'return timeout;'
 * ```
 */
export const notifyDevice = createTool({
  id: 'notifyDevice',
  description:
    'Send a proactive voice notification to Home Assistant Voice Preview Edition device(s) running the Hey Jarvis ElevenLabs firmware. The notification will start a conversation where the user can respond, with a configurable timeout if no response is received. Requires proper Home Assistant and ESPHome configuration (see tool documentation).',
  inputSchema: z.object({
    message: z.string().describe('The notification message that Jarvis will speak to the user'),
    deviceName: z
      .string()
      .optional()
      .describe(
        'Optional: Name of the device to notify (e.g., "hass_elevenlabs"). If not provided, attempts to notify all configured devices.',
      ),
    conversationTimeout: z
      .number()
      .optional()
      .default(5000)
      .describe(
        'Timeout in milliseconds after which the conversation ends if no user input. Default is 5000 (5 seconds)',
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    serviceCalled: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const { message, deviceName, conversationTimeout = 5000 } = inputData;

      // Get Home Assistant Supervisor API URL from environment
      const supervisorToken = process.env.SUPERVISOR_TOKEN;
      const homeAssistantUrl = process.env.HOME_ASSISTANT_URL || 'http://supervisor/core';

      if (!supervisorToken) {
        return {
          success: false,
          message:
            'Home Assistant Supervisor token not available. This tool only works when running inside Home Assistant addon.',
        };
      }

      // Construct the ESPHome service name
      // ESPHome devices expose services as esphome.{device_name}_{service_name}
      const serviceDomain = 'esphome';
      const devicePrefix = deviceName || 'hass_elevenlabs'; // Default device name
      const serviceName = `${devicePrefix}_send_notification`;

      // Call the ESPHome service
      const serviceData = {
        message: message,
        timeout: conversationTimeout,
      };

      const response = await fetch(`${homeAssistantUrl}/api/services/${serviceDomain}/${serviceName}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supervisorToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(serviceData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          message: `Failed to send notification: ${response.status} ${response.statusText}. Error: ${errorText}. Make sure the ESPHome device has the send_notification service configured.`,
          serviceCalled: `${serviceDomain}.${serviceName}`,
        };
      }

      return {
        success: true,
        message: `Notification sent successfully to ${deviceName || 'default device'}`,
        serviceCalled: `${serviceDomain}.${serviceName}`,
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
  notifyDevice,
};
