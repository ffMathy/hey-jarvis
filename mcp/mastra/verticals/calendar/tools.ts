import { google } from 'googleapis';
import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';

// Get OAuth2 credentials from environment
const getGoogleAuth = () => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google Calendar credentials not found. Please set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.',
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return oauth2Client;
};

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
    id: z.string(),
    summary: z.string(),
    start: z.string(),
    end: z.string(),
    htmlLink: z.string(),
    status: z.string(),
  }),
  execute: async (inputData) => {
    const auth = getGoogleAuth();
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
      attendees: inputData.attendees?.map((email) => ({ email })),
    };

    const response = await calendar.events.insert({
      calendarId: inputData.calendarId,
      requestBody: event,
    });

    return {
      id: response.data.id!,
      summary: response.data.summary!,
      start: response.data.start?.dateTime || response.data.start?.date || '',
      end: response.data.end?.dateTime || response.data.end?.date || '',
      htmlLink: response.data.htmlLink!,
      status: response.data.status!,
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
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId: inputData.calendarId,
      eventId: inputData.eventId,
      sendUpdates: 'none',
    });

    return {
      success: true,
      message: `Event ${inputData.eventId} deleted successfully`,
    };
  },
});

// Tool to update a calendar event
export const updateCalendarEvent = createTool({
  id: 'updateCalendarEvent',
  description: 'Update an existing event in Google Calendar',
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
    id: z.string(),
    summary: z.string(),
    start: z.string(),
    end: z.string(),
    htmlLink: z.string(),
    status: z.string(),
  }),
  execute: async (inputData) => {
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    // First, get the existing event
    const existingEvent = await calendar.events.get({
      calendarId: inputData.calendarId,
      eventId: inputData.eventId,
    });

    // Prepare update payload
    const updatedEvent = {
      summary: inputData.summary || existingEvent.data.summary,
      description: inputData.description !== undefined ? inputData.description : existingEvent.data.description,
      location: inputData.location !== undefined ? inputData.location : existingEvent.data.location,
      start: inputData.start
        ? {
            dateTime: inputData.start,
            timeZone: 'UTC',
          }
        : existingEvent.data.start,
      end: inputData.end
        ? {
            dateTime: inputData.end,
            timeZone: 'UTC',
          }
        : existingEvent.data.end,
    };

    const response = await calendar.events.update({
      calendarId: inputData.calendarId,
      eventId: inputData.eventId,
      requestBody: updatedEvent,
    });

    return {
      id: response.data.id!,
      summary: response.data.summary!,
      start: response.data.start?.dateTime || response.data.start?.date || '',
      end: response.data.end?.dateTime || response.data.end?.date || '',
      htmlLink: response.data.htmlLink!,
      status: response.data.status!,
    };
  },
});

// Tool to get calendar events
export const getCalendarEvents = createTool({
  id: 'getCalendarEvents',
  description: 'Get events from Google Calendar within a time range',
  inputSchema: z.object({
    calendarId: z.string().default('primary').describe('Calendar ID (default: primary)'),
    timeMin: z.string().optional().describe('Start time for event search in ISO 8601 format (defaults to now)'),
    timeMax: z.string().optional().describe('End time for event search in ISO 8601 format'),
    maxResults: z.number().optional().default(10).describe('Maximum number of events to return (default: 10)'),
  }),
  outputSchema: z.object({
    events: z.array(
      z.object({
        id: z.string(),
        summary: z.string(),
        start: z.string(),
        end: z.string(),
        description: z.string().optional(),
        location: z.string().optional(),
        status: z.string(),
        htmlLink: z.string(),
      }),
    ),
  }),
  execute: async (inputData) => {
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.events.list({
      calendarId: inputData.calendarId,
      timeMin: inputData.timeMin || new Date().toISOString(),
      timeMax: inputData.timeMax,
      maxResults: inputData.maxResults,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    return {
      events: events.map((event) => ({
        id: event.id!,
        summary: event.summary || '',
        start: event.start?.dateTime || event.start?.date || '',
        end: event.end?.dateTime || event.end?.date || '',
        description: event.description,
        location: event.location,
        status: event.status!,
        htmlLink: event.htmlLink!,
      })),
    };
  },
});

// Tool to get all calendars
export const getAllCalendars = createTool({
  id: 'getAllCalendars',
  description: 'Get all calendars available in the Google Calendar account',
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
  execute: async () => {
    const auth = getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.calendarList.list();

    const calendars = response.data.items || [];

    return {
      calendars: calendars.map((cal) => ({
        id: cal.id!,
        summary: cal.summary!,
        description: cal.description,
        primary: cal.primary,
        backgroundColor: cal.backgroundColor,
      })),
    };
  },
});

// Export all tools together for convenience
export const calendarTools = {
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getCalendarEvents,
  getAllCalendars,
};
