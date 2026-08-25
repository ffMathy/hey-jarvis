import { beforeAll, describe, expect, it } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
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
      const result = await executeTool(getAllTaskLists, {});

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.taskLists)).toBe(true);

      console.log('✅ Task lists retrieved successfully');
      console.log('   - Task list count:', result.taskLists.length);
    }, 30000);
  });

  describe('getAllTasks', () => {
    it('should retrieve all tasks', async () => {
      // Mastra types the call site with the schema's *output*, so the defaulted
      // fields have to be spelled out here.
      const result = await executeTool(getAllTasks, {
        taskListId: '@default',
        showCompleted: false,
        maxResults: 10,
      });

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.tasks)).toBe(true);

      console.log('✅ Tasks retrieved successfully');
      console.log('   - Task count:', result.tasks.length);
      // Do not log task titles as they may contain sensitive information
    }, 30000);
  });
});
