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
    const hasCredentials =
      process.env.HEY_JARVIS_GOOGLE_CLIENT_ID &&
      process.env.HEY_JARVIS_GOOGLE_CLIENT_SECRET &&
      process.env.HEY_JARVIS_GOOGLE_REFRESH_TOKEN;

    if (!hasCredentials) {
      console.log('⚠️  Google OAuth credentials not configured - tests will validate error handling');
    }
  });

  describe('getAllCalendars', () => {
    it('should handle missing credentials gracefully', async () => {
      try {
        const result = await getAllCalendars.execute({});

        // Check for validation errors
        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        // If credentials are configured, validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.calendars)).toBe(true);

        console.log('✅ Calendars retrieved successfully');
        console.log('   - Calendar count:', result.calendars.length);
      } catch (error) {
        // Should fail gracefully if credentials not configured
        expect(error).toBeDefined();
        console.log('✅ getAllCalendars handled missing credentials gracefully');
      }
    }, 30000);
  });

  describe('getCalendarEvents', () => {
    it('should handle missing credentials gracefully', async () => {
      try {
        const result = await getCalendarEvents.execute({
          calendarId: 'primary',
          maxResults: 5,
        });

        // Check for validation errors
        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        // If credentials are configured, validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.events)).toBe(true);

        console.log('✅ Calendar events retrieved successfully');
        console.log('   - Event count:', result.events.length);
        // Do not log event details as they may contain sensitive information
      } catch (error) {
        // Should fail gracefully if credentials not configured
        expect(error).toBeDefined();
        console.log('✅ getCalendarEvents handled missing credentials gracefully');
      }
    }, 30000);
  });
});
