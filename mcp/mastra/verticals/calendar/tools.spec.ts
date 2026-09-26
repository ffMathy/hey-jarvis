/**
 * The parts of the calendar tools that decide how many round trips a request costs.
 *
 * "What is on this week" is one tool call that asks every calendar at once, from a list of
 * calendars that is not fetched again on every request, and changing an event is one patch that
 * carries only what changed. Google itself is never reached: each helper takes its I/O as a
 * function, and these hand it a fake.
 */

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { buildEventPatch, type CalendarEvent, collectEventsFromCalendars, reuseFor } from './tools.js';

function event(id: string, calendarId: string, start: string): CalendarEvent {
  return { id, calendarId, summary: id, start, end: start, status: 'confirmed', htmlLink: `https://calendar/${id}` };
}

const family = { id: 'family@group', name: 'Family' };
const work = { id: 'work@group', name: 'Work' };
const birthdays = { id: 'birthdays@group', name: 'Birthdays' };

afterEach(() => {
  setSystemTime();
});

describe('collectEventsFromCalendars', () => {
  it('merges every calendar into one list in start order', async () => {
    const eventsByCalendar: Record<string, CalendarEvent[]> = {
      [family.id]: [event('dinner', family.id, '2026-09-27T18:00:00+02:00')],
      [work.id]: [
        event('standup', work.id, '2026-09-27T09:00:00+02:00'),
        event('review', work.id, '2026-09-28T13:00:00+02:00'),
      ],
    };

    const { events, unreachableCalendars } = await collectEventsFromCalendars(
      [family, work],
      10,
      async (calendarId) => eventsByCalendar[calendarId] ?? [],
    );

    expect(events.map((listed) => listed.id)).toEqual(['standup', 'dinner', 'review']);
    expect(unreachableCalendars).toEqual([]);
  });

  it('asks the calendars at the same time rather than one after another', async () => {
    let inFlight = 0;
    let mostInFlight = 0;

    await collectEventsFromCalendars([family, work, birthdays], 10, async () => {
      inFlight++;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await Bun.sleep(5);
      inFlight--;
      return [];
    });

    expect(mostInFlight).toBe(3);
  });

  it('never asks more calendars at once than the bound', async () => {
    let inFlight = 0;
    let mostInFlight = 0;

    await collectEventsFromCalendars(
      [family, work, birthdays],
      10,
      async () => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        await Bun.sleep(5);
        inFlight--;
        return [];
      },
      2,
    );

    expect(mostInFlight).toBe(2);
  });

  it('keeps only the earliest events when there are more than asked for', async () => {
    const { events } = await collectEventsFromCalendars([family, work], 2, async (calendarId) => [
      event(`${calendarId}-late`, calendarId, '2026-09-30T10:00:00Z'),
      event(
        `${calendarId}-early`,
        calendarId,
        calendarId === family.id ? '2026-09-27T08:00:00Z' : '2026-09-27T09:00:00Z',
      ),
    ]);

    expect(events.map((listed) => listed.id)).toEqual([`${family.id}-early`, `${work.id}-early`]);
  });

  it('names a calendar that could not be read and still answers with the rest', async () => {
    const { events, unreachableCalendars } = await collectEventsFromCalendars(
      [family, work],
      10,
      async (calendarId) => {
        if (calendarId === work.id) {
          throw new Error('Not Found');
        }
        return [event('dinner', family.id, '2026-09-27T18:00:00Z')];
      },
    );

    expect(events.map((listed) => listed.id)).toEqual(['dinner']);
    expect(unreachableCalendars).toEqual(['Work']);
  });
});

describe('reuseFor', () => {
  it('loads once and reuses the value until it is stale', async () => {
    setSystemTime(new Date('2026-09-26T08:00:00Z'));
    let loads = 0;
    const getValue = reuseFor(60_000, async () => ++loads);

    expect(await getValue()).toBe(1);
    expect(await getValue()).toBe(1);

    setSystemTime(new Date('2026-09-26T08:01:00Z'));
    expect(await getValue()).toBe(2);
  });

  it('shares one load between concurrent callers', async () => {
    let loads = 0;
    const getValue = reuseFor(60_000, async () => {
      await Bun.sleep(5);
      return ++loads;
    });

    expect(await Promise.all([getValue(), getValue()])).toEqual([1, 1]);
    expect(loads).toBe(1);
  });

  it('does not keep a failed load', async () => {
    let loads = 0;
    const getValue = reuseFor(60_000, async () => {
      loads++;
      if (loads === 1) {
        throw new Error('Service Unavailable');
      }
      return loads;
    });

    await expect(getValue()).rejects.toThrow('Service Unavailable');
    expect(await getValue()).toBe(2);
  });
});

describe('buildEventPatch', () => {
  it('carries only the fields that change', () => {
    expect(buildEventPatch({ summary: 'Dentist' })).toEqual({ summary: 'Dentist' });
    expect(buildEventPatch({})).toEqual({});
  });

  it('can clear a description or location with an empty string', () => {
    expect(buildEventPatch({ description: '', location: '' })).toEqual({ description: '', location: '' });
  });

  it('moves an event to a time, clearing any all-day date it had', () => {
    expect(buildEventPatch({ start: '2026-09-27T10:00:00Z', end: '2026-09-27T11:00:00Z' })).toEqual({
      start: { dateTime: '2026-09-27T10:00:00Z', timeZone: 'UTC', date: null },
      end: { dateTime: '2026-09-27T11:00:00Z', timeZone: 'UTC', date: null },
    });
  });
});
