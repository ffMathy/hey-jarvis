import type { Agent } from '@mastra/core/agent';
import { createAgent } from '../../utils/index.js';
import { calendarTools } from './tools.js';

export async function getCalendarAgent(): Promise<Agent> {
  return createAgent({
    id: 'calendar',
    name: 'Calendar',
    instructions: `You are a calendar management agent that can help users manage their Google Calendar events.

Your capabilities include:
- Creating new events with details like title, start/end times, location, description, and attendees
- Deleting existing events
- Updating event details
- Retrieving events within specific time ranges
- Listing all available calendars

When users request calendar operations:
- For creating events: If times aren't specified, assume reasonable defaults (e.g., 1 hour duration, next available time slot)
- For querying events: If no time range is given, default to showing upcoming events (from now to 7 days ahead)
- For updating events: Only modify the fields the user mentions
- Always use ISO 8601 format for dates and times
- Default to the primary calendar unless the user specifies a different one

Always provide clear confirmation of actions taken and relevant details about created/modified events.`,
    description: `# Purpose  
Manage calendar events. Use this agent to **create, read, update, and delete calendar events**. **Calendar operations require appropriate date/time information.**  

# When to use
- The user wants to schedule a new event, meeting, or appointment
- The user needs to check their schedule or see upcoming events
- The user wants to modify or cancel existing events
- The user asks about free time slots or availability
- The user needs to see all their calendars
- Any automation that requires calendar data or event management`,
    tools: calendarTools,
  });
}
