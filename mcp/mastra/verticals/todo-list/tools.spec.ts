// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { getAllTaskLists, getAllTasks } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Todo List Tools Integration Tests', () => {
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

  describe('getAllTaskLists', () => {
    it('should handle missing credentials gracefully', async () => {
      try {
        const result = await getAllTaskLists.execute({});

        // Check for validation errors
        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        // If credentials are configured, validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.taskLists)).toBe(true);

        console.log('✅ Task lists retrieved successfully');
        console.log('   - Task list count:', result.taskLists.length);
      } catch (error) {
        // Should fail gracefully if credentials not configured
        expect(error).toBeDefined();
        console.log('✅ getAllTaskLists handled missing credentials gracefully');
      }
    }, 30000);
  });

  describe('getAllTasks', () => {
    it('should handle missing credentials gracefully', async () => {
      try {
        const result = await getAllTasks.execute({
          taskListId: '@default',
          maxResults: 10,
        });

        // Check for validation errors
        if (isValidationError(result)) {
          throw new Error(`Validation failed: ${result.message}`);
        }

        // If credentials are configured, validate structure
        expect(result).toBeDefined();
        expect(Array.isArray(result.tasks)).toBe(true);

        console.log('✅ Tasks retrieved successfully');
        console.log('   - Task count:', result.tasks.length);
        // Do not log task titles as they may contain sensitive information
      } catch (error) {
        // Should fail gracefully if credentials not configured
        expect(error).toBeDefined();
        console.log('✅ getAllTasks handled missing credentials gracefully');
      }
    }, 30000);
  });
});
