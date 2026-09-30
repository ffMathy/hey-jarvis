import { type calendar_v3, google } from 'googleapis';
import { chunk } from 'lodash-es';
import { z } from 'zod';
import { getGoogleAuth } from '../../credentials/google-auth.js';
import { type AffectedEntity, affectedEntitySchema, markAsAffectingEntities } from '../../utils/affected-entities.js';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';
import { createTtlCache } from '../../utils/ttl-cache.js';

// Tool to create a calendar event
export const createCalendarEvent = createTool({
  id: 'createCalendarEvent',
  description: 'Create a new event in Google Calendar',
  inputSchema: z.object({
    calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
    summary: z.string().describe('Event title/summary'),
    start: z.string().describe('Event start time in ISO 8601 format (e.g., 2024-01-15T10:00:00Z)'),
    end: z.string().describe('Event end time in ISO 8601 format (e.g., 2024-01-15T11:00:00Z)'),
    description: z.string().optional().describe('Event description'),
    location: z.string().optional().describe('Event location'),
    attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
  }),
  outputSchema: z.object({
    id: z.string().describe('The id of the new event'),
    summary: z.string().describe('Its title'),
    start: z.string().describe('When it starts'),
    end: z.string().describe('When it ends'),
    htmlLink: z.string().describe('A link to it in Google Calendar'),
    status: z.string().describe('Its status, such as "confirmed"'),
    calendar: affectedEntitySchema
      .optional()
      .describe('The calendar the event is in, by its id and name, when the calendar list has it'),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary: inputData.summary,
      description: inputData.description,
      location: inputData.location,
      start: {
        dateTime: inputData.start,
        timeZone: 'UTC',
      },
      end: {
        dateTime: inputData.end,
        timeZone: 'UTC',
      },
      attendees: inputData.attendees?.map((email: string) => ({ email })),
    };

    const [response, touchedCalendar] = await Promise.all([
      calendar.events.insert({
        calendarId: inputData.calendarId,
        requestBody: event,
      }),
      lookUpCalendar(inputData.calendarId),
    ]);

    return {
      id: response.data.id!,
      summary: response.data.summary!,
      start: response.data.start?.dateTime || response.data.start?.date || '',
      end: response.data.end?.dateTime || response.data.end?.date || '',
      htmlLink: response.data.htmlLink!,
      status: response.data.status!,
      calendar: touchedCalendar,
    };
  },
});

// Tool to delete a calendar event
export const deleteCalendarEvent = createTool({
  id: 'deleteCalendarEvent',
  description: 'Delete an event from Google Calendar',
  inputSchema: z.object({
    calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
    eventId: z.string().describe('Event ID to delete'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether the event was deleted'),
    message: z.string().describe('What happened, in a sentence'),
    calendar: affectedEntitySchema
      .optional()
      .describe('The calendar the event is in, by its id and name, when the calendar list has it'),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const [, touchedCalendar] = await Promise.all([
      calendar.events.delete({
        calendarId: inputData.calendarId,
        eventId: inputData.eventId,
        sendUpdates: 'none',
      }),
      lookUpCalendar(inputData.calendarId),
    ]);

    return {
      success: true,
      message: `Event ${inputData.eventId} deleted successfully`,
      calendar: touchedCalendar,
    };
  },
});

/** The changes `updateCalendarEvent` can make to an event. */
export interface EventChanges {
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  location?: string;
}

/**
 * The patch that makes exactly the changes asked for, and leaves the rest of the event alone.
 *
 * A new time is sent with `date` cleared, because a patch merges into the event's own start and
 * end: moving an all-day event to a time would otherwise leave it carrying both.
 */
export function buildEventPatch(changes: EventChanges): calendar_v3.Schema$Event {
  const patch: calendar_v3.Schema$Event = {};

  if (changes.summary) {
    patch.summary = changes.summary;
  }
  if (changes.description !== undefined) {
    patch.description = changes.description;
  }
  if (changes.location !== undefined) {
    patch.location = changes.location;
  }
  if (changes.start) {
    patch.start = { dateTime: changes.start, timeZone: 'UTC', date: null };
  }
  if (changes.end) {
    patch.end = { dateTime: changes.end, timeZone: 'UTC', date: null };
  }

  return patch;
}

/**
 * Tool to update a calendar event
 *
 * One `patch` rather than a `get` followed by an `update`: half the round trips, and an `update`
 * replaces the whole event with what it is sent, which silently dropped the attendees, reminders
 * and recurrence of every event this tool touched.
 */
export const updateCalendarEvent = createTool({
  id: 'updateCalendarEvent',
  description: 'Update an existing event in Google Calendar. Only the fields given are changed.',
  inputSchema: z.object({
    calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
    eventId: z.string().describe('Event ID to update'),
    summary: z.string().optional().describe('New event title/summary'),
    start: z.string().optional().describe('New start time in ISO 8601 format'),
    end: z.string().optional().describe('New end time in ISO 8601 format'),
    description: z.string().optional().describe('New event description'),
    location: z.string().optional().describe('New event location'),
  }),
  outputSchema: z.object({
    id: z.string().describe('The id of the event'),
    summary: z.string().describe('Its title, as it is now'),
    start: z.string().describe('When it starts, as it is now'),
    end: z.string().describe('When it ends, as it is now'),
    htmlLink: z.string().describe('A link to it in Google Calendar'),
    status: z.string().describe('Its status, such as "confirmed"'),
    calendar: affectedEntitySchema
      .optional()
      .describe('The calendar the event is in, by its id and name, when the calendar list has it'),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const [response, touchedCalendar] = await Promise.all([
      calendar.events.patch({
        calendarId: inputData.calendarId,
        eventId: inputData.eventId,
        requestBody: buildEventPatch(inputData),
      }),
      lookUpCalendar(inputData.calendarId),
    ]);

    return {
      id: response.data.id!,
      summary: response.data.summary!,
      start: response.data.start?.dateTime || response.data.start?.date || '',
      end: response.data.end?.dateTime || response.data.end?.date || '',
      htmlLink: response.data.htmlLink!,
      status: response.data.status!,
      calendar: touchedCalendar,
    };
  },
});

const calendarEventSchema = z.object({
  id: z.string().describe('The event id, which updating or deleting it needs'),
  calendarId: z.string().describe('The calendar the event is in, which updating or deleting it needs'),
  summary: z.string().describe('Its title'),
  start: z.string().describe('When it starts: a time, or a date for an all-day event'),
  end: z.string().describe('When it ends: a time, or a date for an all-day event'),
  description: z.string().optional().describe('Its description, if any'),
  location: z.string().optional().describe('Where it is, if given'),
  status: z.string().describe('Its status, such as "confirmed"'),
  htmlLink: z.string().describe('A link to it in Google Calendar'),
});

/** An event as `getCalendarEvents` lists it. */
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

/** Only the fields the tool reports, so Google leaves out attendees, reminders and the rest. */
const EVENT_LIST_FIELDS = 'items(id,summary,start,end,description,location,status,htmlLink)';

/**
 * How many calendars are asked for their events at once.
 *
 * A household's calendars -- shared ones, birthdays, holidays -- are a handful, so in practice
 * they are all asked at once; the bound only keeps an account with dozens from bursting its quota.
 */
const CALENDAR_CONCURRENCY = 5;

/**
 * Asks several calendars for their events at once and merges them into one list in start order,
 * cut to `maxResults`.
 *
 * "What is on this week" used to be a model round trip to list the calendars and then one more
 * per calendar, each waited through in turn. Each calendar is asked for up to `maxResults` events
 * of its own, so the earliest `maxResults` overall are always among them. A calendar that cannot
 * be read is named in `unreachableCalendars` rather than failing the rest.
 *
 * @param listEvents - Lists one calendar's events
 * @param concurrency - How many calendars may be asked at once
 */
export async function collectEventsFromCalendars(
  calendars: Array<{ id: string; name: string }>,
  maxResults: number,
  listEvents: (calendarId: string) => Promise<CalendarEvent[]>,
  concurrency: number = CALENDAR_CONCURRENCY,
): Promise<{ events: CalendarEvent[]; unreachableCalendars: string[] }> {
  const events: CalendarEvent[] = [];
  const unreachableCalendars: string[] = [];

  for (const wave of chunk(calendars, concurrency)) {
    const settled = await Promise.allSettled(wave.map((calendar) => listEvents(calendar.id)));
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        events.push(...result.value);
      } else {
        unreachableCalendars.push(wave[index].name);
      }
    });
  }

  events.sort((first, second) => Date.parse(first.start) - Date.parse(second.start));
  return { events: events.slice(0, maxResults), unreachableCalendars };
}

/**
 * How long the list of calendars is reused.
 *
 * Asking every calendar for its events starts from this list, and a calendar is added about as
 * often as a household changes, so it is fetched once in a while rather than on every request.
 */
const CALENDAR_LIST_TTL_MS = 10 * 60_000;

/** One of the user's calendars, as the calendar list reports it. */
export interface CalendarListEntry {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  backgroundColor?: string;
}

const calendarListCache = createTtlCache<CalendarListEntry[]>({ ttlMs: CALENDAR_LIST_TTL_MS, maxEntries: 1 });

async function loadCalendarList(): Promise<CalendarListEntry[]> {
  const auth = await getGoogleAuth();
  const calendar = google.calendar({ version: 'v3', auth });

  const response = await calendar.calendarList.list({
    fields: 'items(id,summary,description,primary,backgroundColor)',
  });

  return (response.data.items || []).map((entry) => ({
    id: entry.id!,
    summary: entry.summary!,
    description: entry.description ?? undefined,
    primary: entry.primary ?? undefined,
    backgroundColor: entry.backgroundColor ?? undefined,
  }));
}

/** The calendars the user has, reused for {@link CALENDAR_LIST_TTL_MS}. */
async function getCalendarList(): Promise<CalendarListEntry[]> {
  return await calendarListCache.get('calendars', loadCalendarList);
}

/** The alias Google Calendar accepts for the account's own calendar, and the tools' default. */
const PRIMARY_CALENDAR_ID = 'primary';

/**
 * A calendar as sir's headset records it -- by its real id, with its name -- or undefined when the
 * list does not have it.
 *
 * The real id rather than the one asked for, because "primary" and the account's own address are
 * the same calendar: the headset matches by id, so a calendar placed in the room under one would
 * never light up when a request reached it under the other.
 */
export function describeCalendar(calendars: CalendarListEntry[], calendarId: string): AffectedEntity | undefined {
  const entry = calendars.find(
    (candidate) => candidate.id === calendarId || (calendarId === PRIMARY_CALENDAR_ID && candidate.primary === true),
  );
  return entry ? { id: entry.id, name: entry.summary } : undefined;
}

/**
 * The calendar a tool touched, looked up in the cached list alongside the tool's own call. Never
 * rejects.
 *
 * A calendar the list cannot describe is still reported by the id it was asked for -- except the
 * alias, which would be recorded as a calendar of its own.
 */
async function lookUpCalendar(calendarId: string): Promise<AffectedEntity | undefined> {
  const asAsked = calendarId === PRIMARY_CALENDAR_ID ? undefined : { id: calendarId };

  try {
    return describeCalendar(await getCalendarList(), calendarId) ?? asAsked;
  } catch (error) {
    logger.warn('Could not look up the calendar a tool touched', {
      error: error instanceof Error ? error.message : String(error),
    });
    return asAsked;
  }
}

// Tool to get calendar events
export const getCalendarEvents = createTool({
  id: 'getCalendarEvents',
  description:
    'Get events from Google Calendar within a time range. Pass allCalendars: true to see what is on across every calendar in one call, and query to find a particular event by a word in it.',
  inputSchema: z.object({
    calendarId: z.string().default('primary').describe('Calendar ID (default: primary). Ignored with allCalendars'),
    allCalendars: z
      .boolean()
      .optional()
      .describe('Search every calendar in the account at once instead of one. Use it for "what is on" questions'),
    query: z
      .string()
      .optional()
      .describe('Only events containing this text in their title, description, location or attendees, e.g. "dentist"'),
    timeMin: z.string().optional().describe('Start time for event search in ISO 8601 format (defaults to now)'),
    timeMax: z.string().optional().describe('End time for event search in ISO 8601 format'),
    maxResults: z.number().optional().default(10).describe('Maximum number of events to return (default: 10)'),
  }),
  outputSchema: z.object({
    events: z.array(calendarEventSchema).describe('The events found, in start order'),
    unreachableCalendars: z
      .array(z.string())
      .optional()
      .describe('Calendars whose events could not be fetched, when searching all of them'),
    calendars: z
      .array(affectedEntitySchema)
      .describe(
        'The calendars read, by id and name: the one asked, or with allCalendars only those the events came from',
      ),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });
    const timeMin = inputData.timeMin || new Date().toISOString();

    const listEvents = async (calendarId: string): Promise<CalendarEvent[]> => {
      const response = await calendar.events.list({
        calendarId,
        timeMin,
        timeMax: inputData.timeMax,
        maxResults: inputData.maxResults,
        q: inputData.query,
        singleEvents: true,
        orderBy: 'startTime',
        fields: EVENT_LIST_FIELDS,
      });

      return (response.data.items || []).map((event) => ({
        id: event.id!,
        calendarId,
        summary: event.summary || '',
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        description: event.description ?? undefined,
        location: event.location ?? undefined,
        status: event.status!,
        htmlLink: event.htmlLink!,
      }));
    };

    if (!inputData.allCalendars) {
      const [events, readCalendar] = await Promise.all([
        listEvents(inputData.calendarId),
        lookUpCalendar(inputData.calendarId),
      ]);
      return { events, calendars: readCalendar ? [readCalendar] : [] };
    }

    const calendars = (await getCalendarList()).map((entry) => ({ id: entry.id, name: entry.summary }));
    const collected = await collectEventsFromCalendars(calendars, inputData.maxResults, listEvents);

    // Reading every calendar in the account is a survey of them, so only the ones the answer came
    // from count as read.
    const answeringCalendarIds = new Set(collected.events.map((event) => event.calendarId));
    return { ...collected, calendars: calendars.filter((calendar) => answeringCalendarIds.has(calendar.id)) };
  },
});

// Tool to get all calendars
export const getAllCalendars = createTool({
  id: 'getAllCalendars',
  description:
    'Get all calendars available in the Google Calendar account. Only needed for the ID of a calendar the user names; to see events across all of them, use getCalendarEvents with allCalendars instead.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    calendars: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        description: z.string().optional(),
        primary: z.boolean().optional(),
        backgroundColor: z.string().optional(),
      }),
    ),
  }),
  execute: async () => ({ calendars: await getCalendarList() }),
});

const touchedCalendarSchema = z.object({ calendar: affectedEntitySchema.optional() });

/** The calendar an event was created, changed or deleted in. */
function readTouchedCalendar(_toolArguments: unknown, toolResult: unknown): AffectedEntity[] {
  const { calendar } = touchedCalendarSchema.parse(toolResult);
  return calendar ? [calendar] : [];
}

markAsAffectingEntities(createCalendarEvent, readTouchedCalendar);
markAsAffectingEntities(updateCalendarEvent, readTouchedCalendar);
markAsAffectingEntities(deleteCalendarEvent, readTouchedCalendar);

const readCalendarsSchema = z.object({ calendars: z.array(affectedEntitySchema) });

// Listing every calendar is a survey, so getAllCalendars is deliberately left unmarked.
markAsAffectingEntities(
  getCalendarEvents,
  (_toolArguments, toolResult) => readCalendarsSchema.parse(toolResult).calendars,
);

// Export all tools together for convenience
export const calendarTools = {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getCalendarEvents,
  getAllCalendars,
};
