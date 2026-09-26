/**
 * Service-call tests.
 *
 * A push notification used to start by fetching Home Assistant's whole list of services to find
 * the phone's notify service, every time. These pin what replaced that: the list is kept and
 * refreshed behind the request, a pinned service skips it entirely, and a kept list that has gone
 * stale is caught by the call that fails rather than by the user never hearing the message.
 *
 * Home Assistant is faked at `fetch`, scoped to each test, and given a made-up address.
 */

import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import { announceOnVoiceDevices, callPrimaryUserNotifyService, resetServicesCacheForTest } from './channels.js';

const environmentKeys = [
  'HEY_JARVIS_HOME_ASSISTANT_URL',
  'HEY_JARVIS_HOME_ASSISTANT_TOKEN',
  'HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE',
  'HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE',
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));

const SERVICES_PATH = '/api/services';

/** The URL a `fetch` call was made with, whichever of its three forms it came in. */
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

/**
 * A Home Assistant that offers `offered` services and records every call made to one.
 *
 * `failing` services answer a call with an error. Calls take a moment to answer, so calls made
 * one after another and calls made together can be told apart by `mostCallsAtOnce`.
 */
function fakeHomeAssistant(state: { offered: Record<string, string[]>; failing?: string[] }) {
  const calledServices: string[] = [];
  let serviceListRequests = 0;
  let callsInFlight = 0;
  let mostCallsAtOnce = 0;

  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const path = new URL(urlOf(input)).pathname;

        if (path === SERVICES_PATH) {
          serviceListRequests += 1;
          const entries = Object.entries(state.offered).map(([domain, services]) => ({
            domain,
            services: Object.fromEntries(services.map((service) => [service, {}])),
          }));
          return new Response(JSON.stringify(entries));
        }

        const service = path.slice(`${SERVICES_PATH}/`.length).replace('/', '.');
        calledServices.push(service);
        callsInFlight += 1;
        mostCallsAtOnce = Math.max(mostCallsAtOnce, callsInFlight);
        await Bun.sleep(5);
        callsInFlight -= 1;

        return state.failing?.includes(service)
          ? new Response('Service not found', { status: 400, statusText: 'Bad Request' })
          : new Response('[]');
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return {
    calledServices,
    fetchSpy,
    serviceListRequests: () => serviceListRequests,
    mostCallsAtOnce: () => mostCallsAtOnce,
  };
}

beforeEach(() => {
  for (const key of environmentKeys) {
    delete process.env[key];
  }
  process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
  process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
  resetServicesCacheForTest();
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetServicesCacheForTest();
  setSystemTime();
});

describe('callPrimaryUserNotifyService', () => {
  it('looks the phone up once, then pushes straight to it', async () => {
    const homeAssistant = fakeHomeAssistant({ offered: { notify: ['mobile_app_mathias_iphone'] } });

    await callPrimaryUserNotifyService({ message: 'One' }, 'Mathias');
    await callPrimaryUserNotifyService({ message: 'Two' }, 'Mathias');

    expect(homeAssistant.serviceListRequests()).toBe(1);
    expect(homeAssistant.calledServices).toEqual([
      'notify.mobile_app_mathias_iphone',
      'notify.mobile_app_mathias_iphone',
    ]);
    homeAssistant.fetchSpy.mockRestore();
  });

  it('calls a pinned service without asking which services exist', async () => {
    process.env.HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE = 'notify.mobile_app_work_phone';
    const homeAssistant = fakeHomeAssistant({ offered: {} });

    const service = await callPrimaryUserNotifyService({ message: 'Hi' }, 'Mathias');

    expect(service).toEqual({ domain: 'notify', service: 'mobile_app_work_phone' });
    expect(homeAssistant.serviceListRequests()).toBe(0);
    homeAssistant.fetchSpy.mockRestore();
  });

  it('pushes from a stale list at once and refreshes it behind the request', async () => {
    setSystemTime(new Date('2026-09-26T08:00:00Z'));
    const homeAssistant = fakeHomeAssistant({ offered: { notify: ['mobile_app_mathias_iphone'] } });
    await callPrimaryUserNotifyService({ message: 'One' }, 'Mathias');

    setSystemTime(new Date('2026-09-26T09:00:00Z'));
    await callPrimaryUserNotifyService({ message: 'Two' }, 'Mathias');
    await Bun.sleep(10);

    expect(homeAssistant.calledServices).toHaveLength(2);
    expect(homeAssistant.serviceListRequests()).toBe(2);
    homeAssistant.fetchSpy.mockRestore();
  });

  it('moves to the phone that replaced the one a kept list names', async () => {
    // Keep a list naming the old phone, then replace it the way re-installing the app does.
    const warmUp = fakeHomeAssistant({ offered: { notify: ['mobile_app_mathias_iphone'] } });
    await callPrimaryUserNotifyService({ message: 'Warm up' }, 'Mathias');
    warmUp.fetchSpy.mockRestore();

    const replaced = fakeHomeAssistant({
      offered: { notify: ['mobile_app_mathias_pixel'] },
      failing: ['notify.mobile_app_mathias_iphone'],
    });

    const service = await callPrimaryUserNotifyService({ message: 'Hi' }, 'Mathias');

    expect(service.service).toBe('mobile_app_mathias_pixel');
    expect(replaced.calledServices).toEqual(['notify.mobile_app_mathias_iphone', 'notify.mobile_app_mathias_pixel']);
    replaced.fetchSpy.mockRestore();
  });

  it('does not push twice to a phone that fails while it is still offered', async () => {
    const warmUp = fakeHomeAssistant({ offered: { notify: ['mobile_app_mathias_iphone'] } });
    await callPrimaryUserNotifyService({ message: 'Warm up' }, 'Mathias');
    warmUp.fetchSpy.mockRestore();

    const failing = fakeHomeAssistant({
      offered: { notify: ['mobile_app_mathias_iphone'] },
      failing: ['notify.mobile_app_mathias_iphone'],
    });

    await expect(callPrimaryUserNotifyService({ message: 'Hi' }, 'Mathias')).rejects.toThrow('Service not found');
    expect(failing.calledServices).toEqual(['notify.mobile_app_mathias_iphone']);
    failing.fetchSpy.mockRestore();
  });
});

describe('announceOnVoiceDevices', () => {
  const speakers = ['hass_elevenlabs_a1b2c3_announce', 'kitchen_speaker_announce'];

  it('announces on every voice device at once', async () => {
    const homeAssistant = fakeHomeAssistant({ offered: { esphome: speakers } });

    const called = await announceOnVoiceDevices({ message: 'Water on the floor.' });

    expect(called.map(({ service }) => service)).toEqual(speakers);
    expect(homeAssistant.mostCallsAtOnce()).toBe(2);
    homeAssistant.fetchSpy.mockRestore();
  });

  it('looks again when a kept list has no device by the name asked for', async () => {
    const warmUp = fakeHomeAssistant({ offered: { esphome: speakers } });
    await announceOnVoiceDevices({ message: 'Warm up' });
    warmUp.fetchSpy.mockRestore();

    const withGarage = fakeHomeAssistant({ offered: { esphome: [...speakers, 'garage_speaker_announce'] } });
    const called = await announceOnVoiceDevices({ message: 'The door is open.' }, 'garage');

    expect(called).toEqual([{ domain: 'esphome', service: 'garage_speaker_announce' }]);
    expect(withGarage.serviceListRequests()).toBe(1);
    withGarage.fetchSpy.mockRestore();
  });

  it('drops a speaker that has gone, without repeating the message on the others', async () => {
    const warmUp = fakeHomeAssistant({ offered: { esphome: speakers } });
    await announceOnVoiceDevices({ message: 'Warm up' });
    warmUp.fetchSpy.mockRestore();

    const oneGone = fakeHomeAssistant({
      offered: { esphome: ['kitchen_speaker_announce'] },
      failing: ['esphome.hass_elevenlabs_a1b2c3_announce'],
    });
    const called = await announceOnVoiceDevices({ message: 'Water on the floor.' });

    expect(called).toEqual([{ domain: 'esphome', service: 'kitchen_speaker_announce' }]);
    expect([...oneGone.calledServices].sort()).toEqual([
      'esphome.hass_elevenlabs_a1b2c3_announce',
      'esphome.kitchen_speaker_announce',
    ]);
    oneGone.fetchSpy.mockRestore();
  });
});
