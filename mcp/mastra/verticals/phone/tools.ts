import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import twilio from 'twilio';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

const ELEVENLABS_PHONE_NUMBER_ID = 'Q8MKRgesP6ZKPi4NMyKu';

/**
 * Tool to send a text message (SMS) via Twilio.
 *
 * This tool uses Twilio's official SDK to send SMS messages to phone numbers.
 *
 * Required environment variables:
 * - HEY_JARVIS_TWILIO_ACCOUNT_SID: Your Twilio Account SID
 * - HEY_JARVIS_TWILIO_AUTH_TOKEN: Your Twilio Auth Token
 * - HEY_JARVIS_TWILIO_PHONE_NUMBER: The Twilio phone number to send from (in E.164 format)
 */
export const sendTextMessage = createTool({
  id: 'sendTextMessage',
  description:
    'Send a text message (SMS) to a phone number using Twilio. Use this for non-urgent notifications when the user is away from home, or when a message does not require immediate attention.',
  inputSchema: z.object({
    phoneNumber: z
      .string()
      .describe(
        'The phone number to send the SMS to in E.164 format (e.g., "+1234567890"). Must include country code.',
      ),
    message: z
      .string()
      .describe('The text message content to send. Should be concise (SMS has a 160 character limit per segment).'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    messageSid: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const { phoneNumber, message } = inputData;

      const accountSid = process.env.HEY_JARVIS_TWILIO_ACCOUNT_SID;
      const authToken = process.env.HEY_JARVIS_TWILIO_AUTH_TOKEN;
      const fromNumber = process.env.HEY_JARVIS_TWILIO_PHONE_NUMBER;

      if (!accountSid) {
        throw new Error('Twilio Account SID not configured. Set HEY_JARVIS_TWILIO_ACCOUNT_SID environment variable.');
      }

      if (!authToken) {
        throw new Error('Twilio Auth Token not configured. Set HEY_JARVIS_TWILIO_AUTH_TOKEN environment variable.');
      }

      if (!fromNumber) {
        throw new Error('Twilio phone number not configured. Set HEY_JARVIS_TWILIO_PHONE_NUMBER environment variable.');
      }

      const client = twilio(accountSid, authToken);

      const response = await client.messages.create({
        body: message,
        from: fromNumber,
        to: phoneNumber,
      });

      return {
        success: true,
        message: `Text message sent successfully to ${phoneNumber}`,
        messageSid: response.sid,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error sending text message: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

/**
 * Tool to initiate an outbound phone call via ElevenLabs Twilio integration.
 *
 * This tool uses the ElevenLabs Conversational AI platform to make outbound calls
 * using a configured agent. The agent will speak a custom first message to the
 * recipient and can then engage in a conversational interaction.
 *
 * Required environment variables:
 * - HEY_JARVIS_ELEVENLABS_API_KEY: Your ElevenLabs API key
 * - HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID or HEY_JARVIS_ELEVENLABS_AGENT_ID: The ID of the ElevenLabs conversational agent
 */
export const initiatePhoneCall = createTool({
  id: 'initiatePhoneCall',
  description:
    'Initiate an outbound phone call to a phone number using ElevenLabs Twilio integration. The conversational agent will call the specified phone number and speak a custom first message, then engage in conversation with the recipient.',
  inputSchema: z.object({
    phoneNumber: z
      .string()
      .describe('The phone number to call in E.164 format (e.g., "+1234567890"). Must include country code.'),
    firstMessage: z
      .string()
      .describe('The initial message that the agent will speak to the recipient when they answer the call.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    conversationId: z.string().optional(),
    callSid: z.string().optional(),
  }),
  execute: async (inputData) => {
    try {
      const { phoneNumber, firstMessage } = inputData;

      const apiKey = process.env.HEY_JARVIS_ELEVENLABS_API_KEY;
      const agentId = process.env.HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID || process.env.HEY_JARVIS_ELEVENLABS_AGENT_ID;

      if (!apiKey) {
        throw new Error('ElevenLabs API key not configured. Set HEY_JARVIS_ELEVENLABS_API_KEY environment variable.');
      }

      if (!agentId) {
        throw new Error(
          'ElevenLabs agent ID not configured. Set HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID or HEY_JARVIS_ELEVENLABS_AGENT_ID environment variable.',
        );
      }

      const client = new ElevenLabsClient({ apiKey });

      const response = await client.conversationalAi.twilio.outboundCall({
        agentId,
        agentPhoneNumberId: ELEVENLABS_PHONE_NUMBER_ID,
        toNumber: phoneNumber,
        conversationInitiationClientData: {
          conversationConfigOverride: {
            agent: {
              firstMessage,
            },
          },
        },
      });

      if (response.success) {
        return {
          success: true,
          message: `Phone call initiated successfully to ${phoneNumber}`,
          conversationId: response.conversationId,
          callSid: response.callSid,
        };
      }

      return {
        success: false,
        message: response.message || 'Failed to initiate phone call',
        conversationId: response.conversationId,
        callSid: response.callSid,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error initiating phone call: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});

export const phoneTools = {
  initiatePhoneCall,
  sendTextMessage,
};
