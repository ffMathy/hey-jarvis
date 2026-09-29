import { describe, expect, it } from 'bun:test';
import { phoneNotificationSchema, toNotificationStateChange } from './workflows';

describe('toNotificationStateChange', () => {
  it('files a notification as a phone state change', () => {
    expect(
      toNotificationStateChange({
        app: 'com.whatsapp',
        title: 'Mom',
        text: 'Dinner at 6?',
        postedAt: Date.UTC(2026, 8, 29, 16, 30),
      }),
    ).toEqual({
      source: 'phone',
      stateType: 'notification_posted',
      stateData: {
        app: 'com.whatsapp',
        title: 'Mom',
        text: 'Dinner at 6?',
        postedAt: '2026-09-29T16:30:00.000Z',
      },
    });
  });

  it('prefers the expanded text over the short one it is usually a truncation of', () => {
    const change = toNotificationStateChange({
      app: 'com.google.android.gm',
      title: 'Your order has shipped',
      text: 'Your order has…',
      bigText: 'Your order has shipped and arrives Thursday.',
    });

    expect(change?.stateData.text).toBe('Your order has shipped and arrives Thursday.');
  });

  it('falls back to the short text when the expanded one is blank', () => {
    const change = toNotificationStateChange({ app: 'com.whatsapp', text: 'On my way', bigText: '  ' });

    expect(change?.stateData.text).toBe('On my way');
  });

  it('leaves out the fields Home Assistant sent as null', () => {
    const change = toNotificationStateChange({
      app: 'com.whatsapp',
      title: 'Mom',
      text: null,
      bigText: null,
      postedAt: null,
    });

    expect(change?.stateData).toEqual({ app: 'com.whatsapp', title: 'Mom' });
  });

  it('registers nothing for a notification with neither a title nor text', () => {
    expect(toNotificationStateChange({ app: 'com.spotify.music', title: ' ', text: null })).toBeNull();
  });
});

describe('phoneNotificationSchema', () => {
  it('accepts exactly what the documented rest_command payload renders', () => {
    const payload = { app: 'com.whatsapp', title: 'Mom', text: 'Dinner?', bigText: null, postedAt: 1790000000000 };

    expect(phoneNotificationSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a notification without the app that posted it', () => {
    expect(phoneNotificationSchema.safeParse({ title: 'Mom', text: 'Dinner?' }).success).toBe(false);
  });
});
