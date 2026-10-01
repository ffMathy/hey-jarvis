import { TZDate } from '@date-fns/tz';
import { addDays, startOfDay } from 'date-fns';
import { asFacts, createDirectLookup, type LookupToolCaller } from '../../utils/direct-lookup-factory.js';
import { HOUSEHOLD_TIME_ZONE } from '../../utils/household.js';
import { getCalendarEvents } from './tools.js';

/**
 * The calendar questions answered without the agent: what is on today, tomorrow, and this week.
 *
 * Each is the one call the agent's instructions already make for them -- `getCalendarEvents`
 * across every calendar, over the days asked about -- with the days counted in the household's
 * time zone rather than the server's. Like the agent's call, each reports the calendars its events
 * came from as what it read.
 */

/** The most events a lookup reports, which is more than a spoken answer can carry anyway. */
const MAX_EVENTS = 25;

/** The span of days, starting `startInDays` from today, as the times a calendar search takes. */
export function householdDays(startInDays: number, dayCount: number, now = new Date()) {
  const today = startOfDay(new TZDate(now, HOUSEHOLD_TIME_ZONE));
  // In UTC, which the rest of the calendar vertical speaks: a TZDate writes its own offset otherwise.
  return {
    timeMin: new Date(addDays(today, startInDays).getTime()).toISOString(),
    timeMax: new Date(addDays(today, startInDays + dayCount).getTime()).toISOString(),
  };
}

async function eventsOn(callTool: LookupToolCaller, startInDays: number, dayCount: number): Promise<string> {
  const { events, unreachableCalendars } = await callTool(getCalendarEvents, {
    calendarId: 'primary',
    allCalendars: true,
    maxResults: MAX_EVENTS,
    ...householdDays(startInDays, dayCount),
  });

  return asFacts({
    events: events.map(({ summary, start, end, location }) => ({ summary, start, end, location })),
    ...(unreachableCalendars?.length && { unreachableCalendars }),
  });
}

export const calendarLookups = [
  createDirectLookup({
    id: 'calendar.today',
    agentId: 'calendar',
    description: 'What is on the calendar today',
    answer: (callTool) => eventsOn(callTool, 0, 1),
  }),
  createDirectLookup({
    id: 'calendar.tomorrow',
    agentId: 'calendar',
    description: 'What is on the calendar tomorrow',
    answer: (callTool) => eventsOn(callTool, 1, 1),
  }),
  createDirectLookup({
    id: 'calendar.week',
    agentId: 'calendar',
    description: 'What is on the calendar over the coming week, or coming up in general',
    answer: (callTool) => eventsOn(callTool, 0, 7),
  }),
];
