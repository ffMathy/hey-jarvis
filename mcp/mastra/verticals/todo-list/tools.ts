import { google, type tasks_v1 } from 'googleapis';
import { z } from 'zod';
import { getGoogleAuth } from '../../credentials/google-auth.js';
import { createTool } from '../../utils/tool-factory.js';

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

/** A task as the tools report it. */
export interface TaskSummary {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: string;
  completed?: string;
  selfLink: string;
}

/**
 * Narrows tasks to those whose title or notes contain `search`, ignoring case.
 *
 * A substring rather than an exact match because the words arrive from speech: "milk" has to find
 * "Buy milk". Google Tasks has no search of its own, so this runs on the page that was fetched.
 */
export function filterTasks(tasks: TaskSummary[], search?: string): TaskSummary[] {
  const wantedText = search?.trim().toLowerCase();
  if (!wantedText) {
    return tasks;
  }

  return tasks.filter((task) => `${task.title} ${task.notes ?? ''}`.toLowerCase().includes(wantedText));
}

// Tool to get all tasks
export const getAllTasks = createTool({
  id: 'getAllTasks',
  description:
    'Get the tasks in a Google Tasks list. Pass search to get only the tasks mentioning a word, e.g. to find the one task to update or delete.',
  inputSchema: z.object({
    taskListId: z.string().default('@default').describe('Task list ID (default: @default for the default task list)'),
    search: z.string().optional().describe('Only tasks whose title or notes contain this, e.g. "milk"'),
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
      // Only what is reported, so Google leaves out etags, positions, links and the rest.
      fields: 'items(id,title,notes,due,status,completed,selfLink)',
    });

    const taskItems = response.data.items || [];
    const listedTasks = taskItems.map((task) => ({
      id: task.id!,
      title: task.title!,
      notes: task.notes ?? undefined,
      due: task.due ?? undefined,
      status: task.status!,
      completed: task.completed ?? undefined,
      selfLink: task.selfLink!,
    }));

    return { tasks: filterTasks(listedTasks, inputData.search) };
  },
});

/** The changes `updateTask` can make to a task. */
export interface TaskChanges {
  title?: string;
  notes?: string;
  dueDate?: string;
  status?: 'needsAction' | 'completed';
}

/**
 * The patch that makes exactly the changes asked for, and leaves the rest of the task alone.
 *
 * Reopening a task clears its completion date along with its status, which is what the Tasks
 * API expects of a task that is no longer done.
 */
export function buildTaskPatch(changes: TaskChanges): tasks_v1.Schema$Task {
  const patch: tasks_v1.Schema$Task = {};

  if (changes.title) {
    patch.title = changes.title;
  }
  if (changes.notes !== undefined) {
    patch.notes = changes.notes;
  }
  if (changes.dueDate !== undefined) {
    patch.due = changes.dueDate;
  }
  if (changes.status) {
    patch.status = changes.status;
  }
  if (changes.status === 'needsAction') {
    patch.completed = null;
  }

  return patch;
}

/**
 * Tool to update a task
 *
 * One `patch` rather than a `get` followed by an `update`, so marking something done is one
 * round trip to Google instead of two.
 */
export const updateTask = createTool({
  id: 'updateTask',
  description: 'Update an existing task in Google Tasks, e.g. to mark it completed. Only the fields given are changed.',
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

    const response = await tasks.tasks.patch({
      tasklist: inputData.taskListId,
      task: inputData.taskId,
      requestBody: buildTaskPatch(inputData),
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
