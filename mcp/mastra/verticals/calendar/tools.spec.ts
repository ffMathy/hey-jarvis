/**
 * The parts of the calendar tools that decide how many round trips a request costs.
 *
 * "What is on this week" is one tool call that asks every calendar at once, from a list of
 * calendars that is not fetched again on every request, and changing an event is one patch that
 * carries only what changed. Google itself is never reached: each helper takes its I/O as a
 * function, and these hand it a fake.
 */

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import { readAffectedEntities } from '../../utils/affected-entities.js';
import {
  buildEventPatch,
  type CalendarEvent,
  collectEventsFromCalendars,
  createCalendarEvent,
  deleteCalendarEvent,
  describeCalendar,
  getAllCalendars,
  getCalendarEvents,
  updateCalendarEvent,
} from './tools.js';

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

/**
 * What the calendar tools report as touched, which sir's headset lights up: the calendar, by its
 * real id, since that is what he places in the room -- not the events, which come and go.
 */
describe('the calendars a request touches', () => {
  const list = [
    { id: 'mathias@example.com', summary: 'Mathias', primary: true },
    { id: 'family@group', summary: 'Family' },
  ];
  const family = { id: 'family@group', name: 'Family' };

  it('names the account’s own calendar by its real id, whichever way it was asked for', () => {
    expect(describeCalendar(list, 'primary')).toEqual({ id: 'mathias@example.com', name: 'Mathias' });
    expect(describeCalendar(list, 'mathias@example.com')).toEqual({ id: 'mathias@example.com', name: 'Mathias' });
    expect(describeCalendar(list, 'family@group')).toEqual(family);
    expect(describeCalendar(list, 'someone-else@group')).toBeUndefined();
  });

  it('is the calendar an event was created, changed or deleted in', () => {
    const changed = { id: 'e1', summary: 'Dinner', start: '', end: '', htmlLink: '', status: 'confirmed' };

    for (const tool of [createCalendarEvent, updateCalendarEvent]) {
      expect(readAffectedEntities(tool.id, {}, { ...changed, calendar: family })).toEqual([family]);
    }
    expect(readAffectedEntities(deleteCalendarEvent.id, {}, { success: true, message: '', calendar: family })).toEqual([
      family,
    ]);
    expect(readAffectedEntities(createCalendarEvent.id, {}, changed)).toEqual([]);
  });

  it('is every calendar a lookup read', () => {
    expect(readAffectedEntities(getCalendarEvents.id, {}, { events: [], calendars: [family] })).toEqual([family]);
  });

  it('is nothing for the list of every calendar, which is a survey', () => {
    expect(readAffectedEntities(getAllCalendars.id, {}, { calendars: list })).toEqual([]);
  });
});
