/**
 * Routing tests.
 *
 * The decision tree is pure — it takes a target, an urgency and a presence reading, and returns a
 * channel — so every branch is exercised here without a house, a car, a phone or a network.
 */

import { describe, expect, it } from 'bun:test';
import type { UserPresence } from './presence.js';
import { decideNotificationChannel } from './routing.js';
import type { ContactTarget, NotificationTarget } from './targets.js';

const user: NotificationTarget = { type: 'user' };

function presenceOf(overrides: Partial<Omit<UserPresence, 'reasons'>> = {}): UserPresence {
  return {
    userName: 'Mathias',
    isHome: false,
    isInCar: false,
    isPhoneSilenced: false,
    reasons: { home: 'home reason', car: 'car reason', phone: 'phone reason' },
    ...overrides,
  };
}

function contact(overrides: Partial<ContactTarget> = {}): NotificationTarget {
  return { type: 'contact', name: 'Julie', phoneNumber: '+4512345678', ...overrides };
}

describe('decideNotificationChannel', () => {
  describe('the primary user in the car', () => {
    it('calls him, urgent or not', () => {
      for (const isUrgent of [true, false]) {
        const decision = decideNotificationChannel({
          target: user,
          isUrgent,
          presence: presenceOf({ isInCar: true }),
        });

        expect(decision.channel).toBe('phone-call');
        expect(decision.reason).toContain('in the car');
      }
    });

    it('calls him even when he is technically also home, since being in the car wins', () => {
      // The car parked in the driveway is inside the home zone, so both flags can be true at once.
      const decision = decideNotificationChannel({
        target: user,
        isUrgent: true,
        presence: presenceOf({ isInCar: true, isHome: true }),
      });

      expect(decision.channel).toBe('phone-call');
    });

    it('calls him even with a silenced phone, because a silent phone is not a reason to stay unreachable in traffic', () => {
      const decision = decideNotificationChannel({
        target: user,
        isUrgent: false,
        presence: presenceOf({ isInCar: true, isPhoneSilenced: true }),
      });

      expect(decision.channel).toBe('phone-call');
    });
  });

  describe('the primary user at home', () => {
    it('announces an urgent message on the voice speakers when the phone is audible', () => {
      const decision = decideNotificationChannel({
        target: user,
        isUrgent: true,
        presence: presenceOf({ isHome: true }),
      });

      expect(decision.channel).toBe('voice-announcement');
    });

    it('pushes an urgent message instead of announcing it when the phone is silenced', () => {
      const decision = decideNotificationChannel({
        target: user,
        isUrgent: true,
        presence: presenceOf({ isHome: true, isPhoneSilenced: true }),
      });

      expect(decision.channel).toBe('push-notification');
      expect(decision.reason).toContain('silenced phone');
    });

    it('pushes a non-urgent message rather than speaking over the room', () => {
      const decision = decideNotificationChannel({
        target: user,
        isUrgent: false,
        presence: presenceOf({ isHome: true }),
      });

      expect(decision.channel).toBe('push-notification');
    });

    it('pushes a non-urgent message whether or not the phone is silenced', () => {
      const decision = decideNotificationChannel({
        target: user,
        isUrgent: false,
        presence: presenceOf({ isHome: true, isPhoneSilenced: true }),
      });

      expect(decision.channel).toBe('push-notification');
    });
  });

  describe('the primary user out of the house', () => {
    it('calls him when it is urgent', () => {
      const decision = decideNotificationChannel({ target: user, isUrgent: true, presence: presenceOf() });

      expect(decision.channel).toBe('phone-call');
    });

    it('pushes when it is not urgent', () => {
      const decision = decideNotificationChannel({ target: user, isUrgent: false, presence: presenceOf() });

      expect(decision.channel).toBe('push-notification');
    });

    it('never announces in an empty house', () => {
      for (const isUrgent of [true, false]) {
        const decision = decideNotificationChannel({ target: user, isUrgent, presence: presenceOf() });

        expect(decision.channel).not.toBe('voice-announcement');
      }
    });
  });

  it('refuses to route to the user without a presence reading', () => {
    expect(() => decideNotificationChannel({ target: user, isUrgent: true })).toThrow(/where he is/);
  });

  describe('contacts', () => {
    it('calls a contact with a phone number when it is urgent', () => {
      const decision = decideNotificationChannel({ target: contact(), isUrgent: true });

      expect(decision.channel).toBe('phone-call');
    });

    it('texts a contact with a phone number when it is not urgent', () => {
      const decision = decideNotificationChannel({ target: contact(), isUrgent: false });

      expect(decision.channel).toBe('text-message');
    });

    it('emails a contact that has no phone number', () => {
      const emailOnly = contact({ phoneNumber: undefined, email: 'julie@example.com' });

      for (const isUrgent of [true, false]) {
        expect(decideNotificationChannel({ target: emailOnly, isUrgent }).channel).toBe('email');
      }
    });

    it('prefers the phone number when a contact has both', () => {
      const both = contact({ email: 'julie@example.com' });

      expect(decideNotificationChannel({ target: both, isUrgent: true }).channel).toBe('phone-call');
      expect(decideNotificationChannel({ target: both, isUrgent: false }).channel).toBe('text-message');
    });

    it('treats a blank phone number as no phone number', () => {
      const blank = contact({ phoneNumber: '   ', email: 'julie@example.com' });

      expect(decideNotificationChannel({ target: blank, isUrgent: false }).channel).toBe('email');
    });

    it('refuses a contact with no way to reach them', () => {
      expect(() => decideNotificationChannel({ target: { type: 'contact', name: 'Nobody' }, isUrgent: false })).toThrow(
        /neither a phone number nor an email address/,
      );
    });

    it('ignores presence, which says nothing about where a contact is', () => {
      const decision = decideNotificationChannel({
        target: contact(),
        isUrgent: true,
        presence: presenceOf({ isHome: true, isInCar: false }),
      });

      expect(decision.channel).toBe('phone-call');
    });
  });

  it('always explains itself', () => {
    const decisions = [
      decideNotificationChannel({ target: user, isUrgent: true, presence: presenceOf({ isInCar: true }) }),
      decideNotificationChannel({ target: user, isUrgent: true, presence: presenceOf({ isHome: true }) }),
      decideNotificationChannel({ target: user, isUrgent: false, presence: presenceOf() }),
      decideNotificationChannel({ target: contact(), isUrgent: false }),
    ];

    for (const decision of decisions) {
      expect(decision.reason.length).toBeGreaterThan(0);
    }
  });
});
