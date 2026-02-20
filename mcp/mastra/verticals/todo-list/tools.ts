import type { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { z } from 'zod';
import { getCredentialsStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { createTool } from '../../utils/tool-factory.js';

/**
 * Creates and configures a Google OAuth2 client for Tasks API access.
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

// Tool to create a task
export const createTask = createTool({
  id: 'createTask',
  description: 'Create a new task in Google Tasks',
  inputSchema: z.object({
    taskListId: z.string().default('@default').describe('Task list ID (default: @default for the default task list)'),
    title: z.string().describe('Task title'),
    notes: z.string().optional().describe('Task notes/description'),
    dueDate: z.string().optional().describe('Due date in ISO 8601 format (e.g., 2024-01-15T10:00:00Z)'),
  }),
  outputSchema: z.object({
    id: z.string(),
    title: z.string(),
    notes: z.string().optional(),
    due: z.string().optional(),
    status: z.string(),
    selfLink: z.string(),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    const task: { title: string; notes?: string; due?: string } = {
      title: inputData.title,
      notes: inputData.notes,
    };

    if (inputData.dueDate) {
      task.due = inputData.dueDate;
    }

    const response = await tasks.tasks.insert({
      tasklist: inputData.taskListId,
      requestBody: task,
    });

    return {
      id: response.data.id!,
      title: response.data.title!,
      notes: response.data.notes ?? undefined,
      due: response.data.due ?? undefined,
      status: response.data.status!,
      selfLink: response.data.selfLink!,
    };
  },
});

// Tool to delete a task
export const deleteTask = createTool({
  id: 'deleteTask',
  description: 'Delete a task from Google Tasks',
  inputSchema: z.object({
    taskListId: z.string().default('@default').describe('Task list ID (default: @default for the default task list)'),
    taskId: z.string().describe('Task ID to delete'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    await tasks.tasks.delete({
      tasklist: inputData.taskListId,
      task: inputData.taskId,
    });

    return {
      success: true,
      message: `Task ${inputData.taskId} deleted successfully`,
    };
  },
});

// Tool to get all tasks
export const getAllTasks = createTool({
  id: 'getAllTasks',
  description: 'Get all tasks from a Google Tasks list',
  inputSchema: z.object({
    taskListId: z.string().default('@default').describe('Task list ID (default: @default for the default task list)'),
    showCompleted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include completed tasks in results (default: false)'),
    maxResults: z.number().optional().default(100).describe('Maximum number of tasks to return (default: 100)'),
  }),
  outputSchema: z.object({
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        notes: z.string().optional(),
        due: z.string().optional(),
        status: z.string(),
        completed: z.string().optional(),
        selfLink: z.string(),
      }),
    ),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    const response = await tasks.tasks.list({
      tasklist: inputData.taskListId,
      showCompleted: inputData.showCompleted,
      maxResults: inputData.maxResults,
    });

    const taskItems = response.data.items || [];

    return {
      tasks: taskItems.map((task) => ({
        id: task.id!,
        title: task.title!,
        notes: task.notes ?? undefined,
        due: task.due ?? undefined,
        status: task.status!,
        completed: task.completed ?? undefined,
        selfLink: task.selfLink!,
      })),
    };
  },
});

// Tool to update a task
export const updateTask = createTool({
  id: 'updateTask',
  description: 'Update an existing task in Google Tasks',
  inputSchema: z.object({
    taskListId: z.string().default('@default').describe('Task list ID (default: @default for the default task list)'),
    taskId: z.string().describe('Task ID to update'),
    title: z.string().optional().describe('New task title'),
    notes: z.string().optional().describe('New task notes/description'),
    dueDate: z.string().optional().describe('New due date in ISO 8601 format'),
    status: z.enum(['needsAction', 'completed']).optional().describe('Task status'),
  }),
  outputSchema: z.object({
    id: z.string(),
    title: z.string(),
    notes: z.string().optional(),
    due: z.string().optional(),
    status: z.string(),
    completed: z.string().optional(),
    selfLink: z.string(),
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    // First get the existing task
    const existingTask = await tasks.tasks.get({
      tasklist: inputData.taskListId,
      task: inputData.taskId,
    });

    // Prepare update payload
    const updatedTask: {
      title: string | null | undefined;
      notes: string | null | undefined;
      status: string | null | undefined;
      due?: string | null;
    } = {
      title: inputData.title || existingTask.data.title,
      notes: inputData.notes !== undefined ? inputData.notes : existingTask.data.notes,
      status: inputData.status || existingTask.data.status,
    };

    if (inputData.dueDate !== undefined) {
      updatedTask.due = inputData.dueDate;
    } else if (existingTask.data.due) {
      updatedTask.due = existingTask.data.due;
    }

    const response = await tasks.tasks.update({
      tasklist: inputData.taskListId,
      task: inputData.taskId,
      requestBody: updatedTask,
    });

    return {
      id: response.data.id!,
      title: response.data.title!,
      notes: response.data.notes ?? undefined,
      due: response.data.due ?? undefined,
      status: response.data.status!,
      completed: response.data.completed ?? undefined,
      selfLink: response.data.selfLink!,
    };
  },
});

// Tool to get all task lists
export const getAllTaskLists = createTool({
  id: 'getAllTaskLists',
  description: 'Get all task lists available in the Google Tasks account',
  inputSchema: z.object({}),
  outputSchema: z.object({
    taskLists: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        selfLink: z.string(),
      }),
    ),
  }),
  execute: async () => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    const response = await tasks.tasklists.list();

    const taskLists = response.data.items || [];

    return {
      taskLists: taskLists.map((list) => ({
        id: list.id!,
        title: list.title!,
        selfLink: list.selfLink!,
      })),
    };
  },
});

// Export all tools together for convenience
export const todoListTools = {
  createTask,
  deleteTask,
  getAllTasks,
  updateTask,
  getAllTaskLists,
};
