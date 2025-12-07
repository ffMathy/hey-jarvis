// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { getAllCalendars, getCalendarEvents } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Calendar Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify Google OAuth credentials are configured
    if (
      !process.env.HEY_JARVIS_GOOGLE_CLIENT_ID ||
      !process.env.HEY_JARVIS_GOOGLE_CLIENT_SECRET ||
      !process.env.HEY_JARVIS_GOOGLE_REFRESH_TOKEN
    ) {
      throw new Error(
        'Google OAuth credentials are required for calendar tools tests. Set HEY_JARVIS_GOOGLE_CLIENT_ID, HEY_JARVIS_GOOGLE_CLIENT_SECRET, and HEY_JARVIS_GOOGLE_REFRESH_TOKEN environment variables.',
      );
    }
  });

  describe('getAllCalendars', () => {
    it('should retrieve all calendars', async () => {
      const result = await getAllCalendars.execute({});

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.calendars)).toBe(true);

      console.log('✅ Calendars retrieved successfully');
      console.log('   - Calendar count:', result.calendars.length);
    }, 30000);
  });

  describe('getCalendarEvents', () => {
    it('should retrieve calendar events', async () => {
      const result = await getCalendarEvents.execute({
        calendarId: 'primary',
        maxResults: 5,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);

      console.log('✅ Calendar events retrieved successfully');
      console.log('   - Event count:', result.events.length);
      // Do not log event details as they may contain sensitive information
    }, 30000);
  });
});
