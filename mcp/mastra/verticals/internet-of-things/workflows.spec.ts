import { describe, expect, it } from 'bun:test';
import { isCompanionNotificationSensor } from './workflows';

describe('isCompanionNotificationSensor', () => {
  it('matches the sensors whose state is a notification, which reach Synapse through their own route', () => {
    expect(isCompanionNotificationSensor('sensor.pixel_9_last_notification')).toBe(true);
    expect(isCompanionNotificationSensor('sensor.pixel_9_last_removed_notification')).toBe(true);
  });

  it('leaves the rest of the phone to the poll', () => {
    expect(isCompanionNotificationSensor('sensor.pixel_9_battery_level')).toBe(false);
    expect(isCompanionNotificationSensor('sensor.pixel_9_active_notification_count')).toBe(false);
    expect(isCompanionNotificationSensor('binary_sensor.pixel_9_last_notification')).toBe(false);
  });
});
