import { google, type tasks_v1 } from 'googleapis';
import { z } from 'zod';
import { getGoogleAuth } from '../../credentials/google-auth.js';
import {
  AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS,
  type AffectedEntity,
  affectedEntitySchema,
  lookUpWithinTimeLimit,
  markAsAffectingEntities,
} from '../../utils/affected-entities.js';
import { createTool } from '../../utils/tool-factory.js';
import { createTtlCache } from '../../utils/ttl-cache.js';

/** The alias Google Tasks accepts for the account's default list, and the tools' default. */
const DEFAULT_TASK_LIST_ID = '@default';

/**
 * How long a task list's real id and title are reused.
 *
 * They are looked up only so sir's headset can record the list a request touched, and a list is
 * renamed about as often as it is created.
 */
const TASK_LIST_TTL_MS = 10 * 60_000;

const taskListCache = createTtlCache<AffectedEntity>({ ttlMs: TASK_LIST_TTL_MS, maxEntries: 20 });

/**
 * A task list as sir's headset records it -- by its real id, with its title -- from what Google
 * Tasks says about it.
 *
 * The real id rather than the one asked for, because "@default" and the default list's own id are
 * the same list: the headset matches by id, so a list placed in the room under one would never light
 * up when a request reached it under the other.
 */
export function describeTaskList(taskList: tasks_v1.Schema$TaskList, askedFor: string): AffectedEntity {
  return { id: taskList.id ?? askedFor, name: taskList.title ?? undefined };
}

/**
 * The task list a tool touched, looked up alongside the tool's own call. Never rejects, and never
 * holds the tool up past the lookup's time limit (see `lookUpWithinTimeLimit`): the task is what sir
 * asked for, and the list's title only lights it up on his headset.
 *
 * The request is asked once, with no retries, and times out with the limit, because nothing but the
 * glow waits on it: Google's client would otherwise retry a failing list for seconds, and wait on a
 * hanging one for as long as it hangs. A list that cannot be looked up in time is still reported by
 * the id it was asked for -- except the alias, which would be recorded as a list of its own.
 */
async function lookUpTaskList(taskListId: string): Promise<AffectedEntity | undefined> {
  return await lookUpWithinTimeLimit(
    'the task list a tool touched',
    () =>
      taskListCache.get(taskListId, async () => {
        const tasks = google.tasks({ version: 'v1', auth: await getGoogleAuth() });
        const response = await tasks.tasklists.get(
          { tasklist: taskListId, fields: 'id,title' },
          { retry: false, timeout: AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS },
        );
        return describeTaskList(response.data, taskListId);
      }),
    taskListId === DEFAULT_TASK_LIST_ID ? undefined : { id: taskListId },
  );
}

/** The task list a tool reports it touched. */
const touchedTaskListField = affectedEntitySchema
  .optional()
  .describe('The task list this touched, by its id and title, when it could be looked up');

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
    id: z.string().describe('The id of the new task'),
    title: z.string().describe('Its title'),
    notes: z.string().optional().describe('Its notes, if any'),
    due: z.string().optional().describe('When it is due, if it has a date'),
    status: z.string().describe('Its status: needsAction or completed'),
    selfLink: z.string().describe('A link to it in the Google Tasks API'),
    taskList: touchedTaskListField,
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

    const [response, taskList] = await Promise.all([
      tasks.tasks.insert({
        tasklist: inputData.taskListId,
        requestBody: task,
      }),
      lookUpTaskList(inputData.taskListId),
    ]);

    return {
      id: response.data.id!,
      title: response.data.title!,
      notes: response.data.notes ?? undefined,
      due: response.data.due ?? undefined,
      status: response.data.status!,
      selfLink: response.data.selfLink!,
      taskList,
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
    success: z.boolean().describe('Whether the task was deleted'),
    message: z.string().describe('What happened, in a sentence'),
    taskList: touchedTaskListField,
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    const [, taskList] = await Promise.all([
      tasks.tasks.delete({
        tasklist: inputData.taskListId,
        task: inputData.taskId,
      }),
      lookUpTaskList(inputData.taskListId),
    ]);

    return {
      success: true,
      message: `Task ${inputData.taskId} deleted successfully`,
      taskList,
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
    tasks: z
      .array(
        z.object({
          id: z.string().describe('The task id, which updating or deleting it needs'),
          title: z.string().describe('Its title'),
          notes: z.string().optional().describe('Its notes, if any'),
          due: z.string().optional().describe('When it is due, if it has a date'),
          status: z.string().describe('Its status: needsAction or completed'),
          completed: z.string().optional().describe('When it was completed, if it was'),
          selfLink: z.string().describe('A link to it in the Google Tasks API'),
        }),
      )
      .describe('The tasks in the list, narrowed by the search if one was given'),
    taskList: touchedTaskListField,
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    const [response, taskList] = await Promise.all([
      tasks.tasks.list({
        tasklist: inputData.taskListId,
        showCompleted: inputData.showCompleted,
        maxResults: inputData.maxResults,
        // Only what is reported, so Google leaves out etags, positions, links and the rest.
        fields: 'items(id,title,notes,due,status,completed,selfLink)',
      }),
      lookUpTaskList(inputData.taskListId),
    ]);

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

    return { tasks: filterTasks(listedTasks, inputData.search), taskList };
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
    id: z.string().describe('The id of the task'),
    title: z.string().describe('Its title, as it is now'),
    notes: z.string().optional().describe('Its notes, as they are now'),
    due: z.string().optional().describe('When it is due, as it is now'),
    status: z.string().describe('Its status, as it is now: needsAction or completed'),
    completed: z.string().optional().describe('When it was completed, if it is'),
    selfLink: z.string().describe('A link to it in the Google Tasks API'),
    taskList: touchedTaskListField,
  }),
  execute: async (inputData) => {
    const auth = await getGoogleAuth();
    const tasks = google.tasks({ version: 'v1', auth });

    const [response, taskList] = await Promise.all([
      tasks.tasks.patch({
        tasklist: inputData.taskListId,
        task: inputData.taskId,
        requestBody: buildTaskPatch(inputData),
      }),
      lookUpTaskList(inputData.taskListId),
    ]);

    return {
      id: response.data.id!,
      title: response.data.title!,
      notes: response.data.notes ?? undefined,
      due: response.data.due ?? undefined,
      status: response.data.status!,
      completed: response.data.completed ?? undefined,
      selfLink: response.data.selfLink!,
      taskList,
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

const touchedTaskListSchema = z.object({ taskList: affectedEntitySchema.optional() });

/**
 * The task list a task was read, added, changed or deleted in -- the list, not the task, since the
 * list is what sir places in the room and a task comes and goes.
 */
function readTouchedTaskList(_toolArguments: unknown, toolResult: unknown): AffectedEntity[] {
  const { taskList } = touchedTaskListSchema.parse(toolResult);
  return taskList ? [taskList] : [];
}

markAsAffectingEntities(createTask, readTouchedTaskList);
markAsAffectingEntities(deleteTask, readTouchedTaskList);
markAsAffectingEntities(getAllTasks, readTouchedTaskList);
markAsAffectingEntities(updateTask, readTouchedTaskList);
// Listing every task list is a survey, so getAllTaskLists is deliberately left unmarked.

// Export all tools together for convenience
export const todoListTools = {
  createTask,
  deleteTask,
  getAllTasks,
  updateTask,
  getAllTaskLists,
};
