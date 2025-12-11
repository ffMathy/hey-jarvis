import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { getAllTaskLists, getAllTasks } from './tools';

describe('Todo List Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify Google OAuth credentials are configured
    if (
      !process.env.HEY_JARVIS_GOOGLE_CLIENT_ID ||
      !process.env.HEY_JARVIS_GOOGLE_CLIENT_SECRET ||
      !process.env.HEY_JARVIS_GOOGLE_REFRESH_TOKEN
    ) {
      throw new Error(
        'Google OAuth credentials are required for todo list tools tests. Set HEY_JARVIS_GOOGLE_CLIENT_ID, HEY_JARVIS_GOOGLE_CLIENT_SECRET, and HEY_JARVIS_GOOGLE_REFRESH_TOKEN environment variables.',
      );
    }
  });

  describe('getAllTaskLists', () => {
    it('should retrieve all task lists', async () => {
      const result = await getAllTaskLists.execute({});

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.taskLists)).toBe(true);

      console.log('✅ Task lists retrieved successfully');
      console.log('   - Task list count:', result.taskLists.length);
    }, 30000);
  });

  describe('getAllTasks', () => {
    it('should retrieve all tasks', async () => {
      const result = await getAllTasks.execute({
        taskListId: '@default',
        maxResults: 10,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.tasks)).toBe(true);

      console.log('✅ Tasks retrieved successfully');
      console.log('   - Task count:', result.tasks.length);
      // Do not log task titles as they may contain sensitive information
    }, 30000);
  });
});
