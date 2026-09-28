import type { UserPresence } from './presence.js';
import {
  assertContactIsReachable,
  describeNotificationTarget,
  isUserTarget,
  type NotificationTarget,
} from './targets.js';

/**
 * The ways Jarvis can reach somebody.
 *
 * - `phone-call` — an ElevenLabs agent rings the target and delivers the message out loud, as Jarvis.
 * - `voice-announcement` — the Home Assistant Voice Preview Edition speakers announce it in the house.
 * - `push-notification` — a push notification through the Home Assistant companion app.
 * - `text-message` — an SMS through Twilio.
 * - `email` — an email.
 */
export type NotificationChannel = 'phone-call' | 'voice-announcement' | 'push-notification' | 'text-message' | 'email';

export interface ChannelDecision {
  channel: NotificationChannel;
  /** Why this channel, in one sentence. Carried through to the tool's output so a surprising route can be traced. */
  reason: string;
}

export interface RoutingInput {
  target: NotificationTarget;
  isUrgent: boolean;
  /** Where the primary user is. Required for `user` targets, unused for contacts. */
  presence?: UserPresence;
}

/**
 * Picks the channel a notification goes out on.
 *
 * Pure on purpose: every branch below is a decision about *people*, and keeping it away from the
 * delivery code means the whole tree can be tested without a house, a car or a phone.
 *
 * For the primary user the tree is, in order:
 *
 * 1. **In the car** → call him. A driver cannot read a push notification, and the house speakers
 *    are nowhere near him, so Jarvis rings instead — urgent or not.
 * 2. **At home and it is urgent** → announce it on the voice speakers, *unless* his phone is on
 *    silent or in do-not-disturb, which is him asking the house to stay quiet. Then it falls back
 *    to a push notification, which is silent but still delivered.
 * 3. **At home and it is not urgent** → push notification. Nothing routine is worth talking over
 *    the room for.
 * 4. **Out** → a call if it is urgent, a push notification otherwise.
 *
 * Contacts have no presence to reason about, so they are routed on what Jarvis knows about them:
 * a phone number gets a call when urgent and an SMS when not, and an email address is the
 * fallback when there is no number.
 */
export function decideNotificationChannel({ target, isUrgent, presence }: RoutingInput): ChannelDecision {
  if (isUserTarget(target)) {
    if (!presence) {
      throw new Error(
        `Cannot route a notification to ${describeNotificationTarget(target)} without knowing where he is.`,
      );
    }

    return decideForPrimaryUser(presence, isUrgent);
  }

  assertContactIsReachable(target);

  const name = describeNotificationTarget(target);

  if (target.phoneNumber?.trim()) {
    return isUrgent
      ? { channel: 'phone-call', reason: `${name} has a phone number and the message is urgent, so Jarvis calls.` }
      : {
          channel: 'text-message',
          reason: `${name} has a phone number and the message is not urgent, so it goes out as an SMS.`,
        };
  }

  return { channel: 'email', reason: `${name} has no phone number, so the message goes out by email.` };
}

function decideForPrimaryUser(presence: UserPresence, isUrgent: boolean): ChannelDecision {
  const { userName, isHome, isInCar, isPhoneSilenced, reasons } = presence;

  if (isInCar) {
    return {
      channel: 'phone-call',
      reason: `${userName} is in the car, so Jarvis calls him with the message. ${reasons.car}`,
    };
  }

  if (isHome) {
    if (!isUrgent) {
      return {
        channel: 'push-notification',
        reason: `${userName} is home and the message is not urgent, so it goes out as a push notification rather than being spoken aloud.`,
      };
    }

    if (isPhoneSilenced) {
      return {
        channel: 'push-notification',
        reason: `${userName} is home and the message is urgent, but announcing it would talk over a silenced phone, so it goes out as a push notification instead. ${reasons.phone}`,
      };
    }

    return {
      channel: 'voice-announcement',
      reason: `${userName} is home, the message is urgent, and his phone is audible, so the house announces it. ${reasons.phone}`,
    };
  }

  if (isUrgent) {
    return {
      channel: 'phone-call',
      reason: `${userName} is away and the message is urgent, so Jarvis calls him. ${reasons.home}`,
    };
  }

  return {
    channel: 'push-notification',
    reason: `${userName} is away and the message is not urgent, so it goes out as a push notification. ${reasons.home}`,
  };
}

/**
 * Picks the channel a question for the primary user goes out on.
 *
 * A question is only worth asking where he can answer it, so this keeps to the two channels that
 * carry his reply back to Jarvis — a call, and the house speakers, which stay listening after they
 * speak. Whichever he answers on, his reply reaches `routePromptWorkflow` like anything else he
 * says, and is matched to the question it answers (see `routing/questions.ts`).
 *
 * 1. **In the car** → call him, as for any notification.
 * 2. **Phone silenced** → he has asked for quiet, and neither a call nor the speakers can reach him
 *    without breaking it. The question goes out as a push notification instead, saying that he can
 *    answer it the next time he talks to Jarvis — the question stays open until then.
 * 3. **At home** → the house asks him out loud, and listens for his answer.
 * 4. **Out** → call him.
 *
 * Unlike a notification, urgency does not come into it: a question holds up the work that asked
 * it until it is answered, so it is always worth asking now.
 */
export function decideQuestionChannel(presence: UserPresence): ChannelDecision {
  const { userName, isHome, isInCar, isPhoneSilenced, reasons } = presence;

  if (isInCar) {
    return {
      channel: 'phone-call',
      reason: `${userName} is in the car, so Jarvis calls him to ask. ${reasons.car}`,
    };
  }

  if (isPhoneSilenced) {
    return {
      channel: 'push-notification',
      reason: `${userName}'s phone is silenced, so rather than ring him or talk over the room, the question goes out as a push notification he can answer the next time he talks to Jarvis. ${reasons.phone}`,
    };
  }

  if (isHome) {
    return {
      channel: 'voice-announcement',
      reason: `${userName} is home, so the house asks him out loud and listens for his answer. ${reasons.home}`,
    };
  }

  return {
    channel: 'phone-call',
    reason: `${userName} is away, so Jarvis calls him to ask. ${reasons.home}`,
  };
}
