import { describe, expect, it } from 'bun:test';
import {
  isLastNotificationSensor,
  isNotificationSensor,
  readNotificationAttributes,
  toNotificationStateChange,
} from './notifications';

describe('isNotificationSensor', () => {
  it('matches both sensors whose state is the text of a notification', () => {
    expect(isNotificationSensor('sensor.pixel_9_last_notification')).toBe(true);
    expect(isNotificationSensor('sensor.pixel_9_last_removed_notification')).toBe(true);
  });

  it('leaves the rest of the phone alone', () => {
    expect(isNotificationSensor('sensor.pixel_9_battery_level')).toBe(false);
    expect(isNotificationSensor('sensor.pixel_9_active_notification_count')).toBe(false);
    expect(isNotificationSensor('binary_sensor.pixel_9_last_notification')).toBe(false);
  });

  it('reports only the posted one as a notification to file', () => {
    expect(isLastNotificationSensor('sensor.pixel_9_last_notification')).toBe(true);
    expect(isLastNotificationSensor('sensor.pixel_9_last_removed_notification')).toBe(false);
  });
});

describe('readNotificationAttributes', () => {
  it('reads the attributes the companion app sets', () => {
    expect(
      readNotificationAttributes({
        package: 'com.whatsapp',
        'android.title': 'Mom',
        'android.text': 'Dinner?',
        'android.bigText': 'Dinner at 6?',
        post_time: 1790000000000,
        channel_id: 'individual_chat',
      }),
    ).toEqual({ app: 'com.whatsapp', title: 'Mom', text: 'Dinner?', bigText: 'Dinner at 6?', postedAt: 1790000000000 });
  });

  it('drops attributes of the wrong type rather than passing them on', () => {
    expect(readNotificationAttributes({ package: 'com.whatsapp', 'android.title': 42, post_time: 'soon' })).toEqual({
      app: 'com.whatsapp',
      title: undefined,
      text: undefined,
      bigText: undefined,
      postedAt: undefined,
    });
  });

  it('refuses a notification that does not name its app', () => {
    expect(readNotificationAttributes({ 'android.title': 'Mom' })).toBeNull();
    expect(readNotificationAttributes({ package: '' })).toBeNull();
  });
});

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

  it('leaves out the fields the notification did not have', () => {
    expect(toNotificationStateChange({ app: 'com.whatsapp', title: 'Mom' })?.stateData).toEqual({
      app: 'com.whatsapp',
      title: 'Mom',
    });
  });

  it('registers nothing for a notification with neither a title nor text', () => {
    expect(toNotificationStateChange({ app: 'com.spotify.music', title: ' ' })).toBeNull();
  });
});
