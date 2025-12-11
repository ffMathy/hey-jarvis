import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { z } from 'zod';
import { getCredentialsStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';

/**
 * Creates and configures a Google OAuth2 client for Calendar API access.
 *
 * The client automatically refreshes access tokens using the stored refresh token.
 * Refresh tokens are long-lived (6+ months with regular use) and only need to be
 * obtained once using the `nx generate-tokens mcp` command.
 *
 * Credentials are loaded in this order:
 * 1. Environment variables (HEY_JARVIS_GOOGLE_*)
 * 2. Mastra storage (oauth_credentials table)
 *
 * @throws {Error} If credentials are not found in either location
 */
const getGoogleAuth = async (): Promise<OAuth2Client> => {
  const clientId = process.env.HEY_JARVIS_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.HEY_JARVIS_GOOGLE_CLIENT_SECRET;
  let refreshToken = process.env.HEY_JARVIS_GOOGLE_REFRESH_TOKEN;

  // Fallback to Mastra storage for refresh token only
  if (!refreshToken) {
    try {
      const credentialsStorage = await getCredentialsStorage();
      refreshToken = (await credentialsStorage.getRefreshToken('google')) ?? undefined;
    } catch (_error) {
      // Storage error - continue to show helpful error message below
    }
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing required Google OAuth2 credentials.\n' +
        '\n' +
        'Option 1: Set environment variables:\n' +
        '  - HEY_JARVIS_GOOGLE_CLIENT_ID\n' +
        '  - HEY_JARVIS_GOOGLE_CLIENT_SECRET\n' +
        '  - HEY_JARVIS_GOOGLE_REFRESH_TOKEN\n' +
        '\n' +
        'Option 2: Store refresh token in Mastra (client ID/secret still required in env):\n' +
        '  Run `nx generate-tokens mcp`',
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Listen for token refresh events and update storage automatically
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.refresh_token) {
      // OAuth provider has issued a new refresh token - update storage
      logger.info('New refresh token received from Google - updating storage');
      try {
        const credentialsStorage = await getCredentialsStorage();
        await credentialsStorage.renewRefreshToken('google', tokens.refresh_token);
        logger.info('Refresh token updated in storage');
      } catch (error) {
        logger.error('Failed to update refresh token in storage', { error });
      }
    }
    // Access token refresh is automatic and expected - no logging needed for normal operation
  });

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
    const auth = await getGoogleAuth();
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
    const auth = await getGoogleAuth();
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
    const auth = await getGoogleAuth();
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
        description: event.description ?? undefined,
        location: event.location ?? undefined,
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
    const auth = await getGoogleAuth();
    const calendar = google.calendar({ version: 'v3', auth });

    const response = await calendar.calendarList.list();

    const calendars = response.data.items || [];

    return {
      calendars: calendars.map((cal) => ({
        id: cal.id!,
        summary: cal.summary!,
        description: cal.description ?? undefined,
        primary: cal.primary ?? undefined,
        backgroundColor: cal.backgroundColor ?? undefined,
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
