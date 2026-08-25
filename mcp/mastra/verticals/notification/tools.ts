import { z } from 'zod';
import { createTool, executeTool } from '../../utils/tool-factory.js';
import { sendEmail } from '../email/tools.js';
import { initiatePhoneCall, sendTextMessage } from '../phone/tools.js';
import {
  buildPushPayload,
  callService,
  DEFAULT_ANNOUNCE_SILENCE_SECONDS,
  findAnnounceServices,
  findMobileAppNotifyService,
} from './channels.js';
import { getUserPresence } from './presence.js';
import { decideNotificationChannel, type NotificationChannel } from './routing.js';
import {
  describeNotificationTarget,
  getPrimaryUserName,
  getPrimaryUserPhoneNumber,
  isUserTarget,
  type NotificationTarget,
  notificationTargetSchema,
} from './targets.js';

/**
 * Announce a message on the Home Assistant Voice Preview Edition speakers.
 *
 * The Hey Jarvis firmware exposes this as an ESPHome `announce` service (see
 * `home-assistant-voice-firmware/home-assistant-voice.elevenlabs.yaml`): the device speaks the
 * message and then stays in a normal conversation until the room has been silent for
 * `silence_seconds`, so the user can simply answer back.
 *
 * The service is looked up rather than assumed. The device is flashed with a MAC suffix in its
 * name, so the service is called `esphome.hass_elevenlabs_<mac>_announce` and no fixed name can
 * be right for every house.
 */
export const notifyDevice = createTool({
  id: 'notifyDevice',
  description:
    'Announce a message out loud on the Home Assistant Voice Preview Edition speakers running the Hey Jarvis ElevenLabs firmware. The device speaks the message and stays listening, so the user can answer back. Only reaches people who are in the house, and speaks over whatever else is going on in the room.',
  inputSchema: z.object({
    message: z.string().describe('The notification message that Jarvis will speak out loud'),
    deviceName: z
      .string()
      .optional()
      .describe(
        'Optional: name (or part of the name) of a single device to announce on, e.g. "kitchen". Announces on every Hey Jarvis voice device when omitted.',
      ),
    silenceSeconds: z
      .number()
      .optional()
      .describe(
        `How many seconds of silence end the conversation that follows the announcement. Defaults to ${DEFAULT_ANNOUNCE_SILENCE_SECONDS}.`,
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    servicesCalled: z.array(z.string()),
  }),
  execute: async (inputData) => {
    const { message, deviceName, silenceSeconds = DEFAULT_ANNOUNCE_SILENCE_SECONDS } = inputData;

    const services = await findAnnounceServices(deviceName);

    if (services.length === 0) {
      return {
        success: false,
        message: deviceName
          ? `No Hey Jarvis voice device matching "${deviceName}" exposes an announce service.`
          : 'No Hey Jarvis voice device exposes an announce service. Check that the device is flashed with the Hey Jarvis ElevenLabs firmware and connected to Home Assistant.',
        servicesCalled: [],
      };
    }

    for (const service of services) {
      await callService(service, { message, silence_seconds: silenceSeconds });
    }

    const servicesCalled = services.map(({ domain, service }) => `${domain}.${service}`);

    return {
      success: true,
      message: `Announced on ${servicesCalled.length} voice device(s): ${servicesCalled.join(', ')}`,
      servicesCalled,
    };
  },
});

/**
 * Send a push notification through the Home Assistant companion app.
 *
 * This is the quiet channel: it reaches the user wherever he is, without speaking over a room or
 * ringing a phone, which makes it the right default for anything that is not urgent and the
 * fallback for anything urgent that arrives while the phone is silenced.
 */
export const sendPushNotification = createTool({
  id: 'sendPushNotification',
  description:
    "Send a push notification to the primary user's phone through the Home Assistant companion app. Silent and unobtrusive: it reaches the user wherever he is without speaking out loud or ringing him.",
  inputSchema: z.object({
    message: z.string().describe('The notification body'),
    title: z.string().optional().describe('Optional: the notification title'),
    isUrgent: z
      .boolean()
      .optional()
      .describe('Whether to push the notification through immediately and surface it past a focus mode'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    serviceCalled: z.string(),
  }),
  execute: async (inputData) => {
    const { message, title, isUrgent = false } = inputData;

    const service = await findMobileAppNotifyService();
    await callService(service, buildPushPayload({ message, title, isUrgent }));

    const serviceCalled = `${service.domain}.${service.service}`;

    return {
      success: true,
      message: `Push notification sent via ${serviceCalled}`,
      serviceCalled,
    };
  },
});

/**
 * Report where the primary user is and whether his phone would make a sound.
 *
 * `sendNotification` works this out for itself, so this exists for the times somebody needs to
 * know *why* a message went out the way it did — or wants to check before writing one.
 */
export const getPrimaryUserPresence = createTool({
  id: 'getPrimaryUserPresence',
  description:
    'Check where the primary user is right now: in the car, at home or out, and whether his phone is on silent or in do-not-disturb. This is what decides how a notification to the user is delivered.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    userName: z.string(),
    isInCar: z.boolean(),
    isHome: z.boolean(),
    isPhoneSilenced: z.boolean(),
    reasons: z.object({
      home: z.string(),
      car: z.string(),
      phone: z.string(),
    }),
  }),
  execute: async () => await getUserPresence(),
});

/**
 * Send a notification to somebody, over whichever channel actually reaches them.
 *
 * The choice of channel is deterministic and lives in `routing.ts`; this tool gathers what that
 * decision needs (for the user: where he is) and then carries it out.
 */
export const sendNotification = createTool({
  id: 'sendNotification',
  description:
    "Send a notification to someone, picking the delivery channel automatically. For the primary user (Mathias) the channel follows where he is: a call from Jarvis while he is in the car, a spoken announcement in the house for urgent messages when his phone is not silenced, and a push notification otherwise. Contacts are called or texted on their phone number, or emailed when that is all that is known about them. This is the tool to use for every notification — don't pick a channel by hand.",
  inputSchema: z.object({
    target: notificationTargetSchema,
    message: z
      .string()
      .describe(
        'The message to deliver, written to be spoken out loud: one or two sentences, no markup. Around 10-20 words works best for voice, and an SMS costs a segment per 160 characters.',
      ),
    isUrgent: z
      .boolean()
      .optional()
      .describe(
        'Whether the message needs attention right now — a security alert, a leak, something time-critical. Routine updates, reminders and status changes are not urgent.',
      ),
    title: z
      .string()
      .optional()
      .describe('Optional: a short title, used as the push notification heading or the email subject'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    channel: z.string(),
    target: z.string(),
    reason: z.string(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const { target, message, isUrgent = false, title } = inputData;

    const presence = isUserTarget(target) ? await getUserPresence() : undefined;
    const { channel, reason } = decideNotificationChannel({ target, isUrgent, presence });
    const targetName = describeNotificationTarget(target);

    const delivery = await deliver({ channel, target, message, title, isUrgent });

    return {
      success: delivery.success,
      channel,
      target: targetName,
      reason,
      message: delivery.message,
    };
  },
});

interface DeliveryInput {
  channel: NotificationChannel;
  target: NotificationTarget;
  message: string;
  title?: string;
  isUrgent: boolean;
}

/**
 * Carries out a routing decision.
 *
 * Split from `sendNotification` so the routing tree and the delivery mechanics stay separately
 * readable: one is about people, the other about services.
 */
async function deliver(input: DeliveryInput): Promise<{ success: boolean; message: string }> {
  switch (input.channel) {
    case 'phone-call': {
      const result = await executeTool(initiatePhoneCall, {
        phoneNumber: resolvePhoneNumber(input.target),
        firstMessage: input.message,
      });
      return { success: result.success, message: result.message };
    }

    case 'voice-announcement': {
      const result = await executeTool(notifyDevice, { message: input.message });
      return { success: result.success, message: result.message };
    }

    case 'push-notification': {
      const result = await executeTool(sendPushNotification, {
        message: input.message,
        title: input.title,
        isUrgent: input.isUrgent,
      });
      return { success: result.success, message: result.message };
    }

    case 'text-message': {
      const result = await executeTool(sendTextMessage, {
        phoneNumber: resolvePhoneNumber(input.target),
        message: input.message,
      });
      return { success: result.success, message: result.message };
    }

    case 'email': {
      const result = await executeTool(sendEmail, {
        subject: input.title ?? 'A message from Jarvis',
        bodyContent: `<p>${escapeHtml(input.message)}</p>`,
        toRecipients: [resolveEmailAddress(input.target)],
      });
      return { success: result.success, message: result.message };
    }
  }
}

/**
 * The number to ring or text.
 *
 * A contact carries its own; the primary user does not, because a `user` target deliberately
 * holds no contact details — so his has to come from configuration.
 */
function resolvePhoneNumber(target: NotificationTarget): string {
  if (isUserTarget(target)) {
    const phoneNumber = getPrimaryUserPhoneNumber();
    if (!phoneNumber) {
      throw new Error(
        `${getPrimaryUserName()} has to be reached by phone, but no number is configured. Set HEY_JARVIS_PRIMARY_USER_PHONE_NUMBER to his number in E.164 format.`,
      );
    }
    return phoneNumber;
  }

  const phoneNumber = target.phoneNumber?.trim();
  if (!phoneNumber) {
    throw new Error(`${describeNotificationTarget(target)} has no phone number to reach.`);
  }
  return phoneNumber;
}

function resolveEmailAddress(target: NotificationTarget): string {
  const email = isUserTarget(target) ? undefined : target.email?.trim();
  if (!email) {
    throw new Error(`${describeNotificationTarget(target)} has no email address to write to.`);
  }
  return email;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const notificationTools = {
  getPrimaryUserPresence,
  notifyDevice,
  sendNotification,
  sendPushNotification,
};
