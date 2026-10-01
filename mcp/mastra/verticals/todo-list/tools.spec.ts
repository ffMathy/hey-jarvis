/**
 * The parts of the task tools that decide how much a request costs: finding the one task to act
 * on without reading the whole list back, and changing it with a patch that carries only what
 * changed. Neither reaches Google.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { type FakeGoogle, fakeGoogle, googleJson } from '../../../tests/utils/fake-google.js';
import { AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS, readAffectedEntities } from '../../utils/affected-entities.js';
import { executeTool } from '../../utils/tool-factory.js';
import {
  buildTaskPatch,
  createTask,
  deleteTask,
  describeTaskList,
  filterTasks,
  getAllTaskLists,
  getAllTasks,
  type TaskSummary,
  updateTask,
} from './tools.js';

function task(id: string, title: string, notes?: string): TaskSummary {
  return { id, title, notes, status: 'needsAction', selfLink: `https://tasks/${id}` };
}

describe('filterTasks', () => {
  const tasks = [task('milk', 'Buy milk'), task('tax', 'File taxes', 'Before the deadline'), task('car', 'Wash car')];

  it('finds tasks by any part of their title or notes, in any case', () => {
    expect(filterTasks(tasks, 'MILK').map((found) => found.id)).toEqual(['milk']);
    expect(filterTasks(tasks, 'deadline').map((found) => found.id)).toEqual(['tax']);
  });

  it('lists everything when there is nothing to search for', () => {
    expect(filterTasks(tasks)).toEqual(tasks);
    expect(filterTasks(tasks, '  ')).toEqual(tasks);
  });
});

describe('buildTaskPatch', () => {
  it('carries only the fields that change', () => {
    expect(buildTaskPatch({ status: 'completed' })).toEqual({ status: 'completed' });
    expect(buildTaskPatch({ title: 'Buy oat milk', dueDate: '2026-09-27T00:00:00Z' })).toEqual({
      title: 'Buy oat milk',
      due: '2026-09-27T00:00:00Z',
    });
    expect(buildTaskPatch({})).toEqual({});
  });

  it('can clear the notes with an empty string', () => {
    expect(buildTaskPatch({ notes: '' })).toEqual({ notes: '' });
  });

  it('clears the completion date when a task is reopened', () => {
    expect(buildTaskPatch({ status: 'needsAction' })).toEqual({ status: 'needsAction', completed: null });
  });
});

/**
 * What the task tools report as touched, which sir's headset lights up: the list, by its real id,
 * since that is what he places in the room -- not the task, which comes and goes.
 */
describe('the task lists a request touches', () => {
  const groceries = { id: 'MDk1NTEw', name: 'Groceries' };

  it('names a list by the real id Google gives it, whichever way it was asked for', () => {
    expect(describeTaskList({ id: 'MDk1NTEw', title: 'Groceries' }, '@default')).toEqual(groceries);
  });

  it('is the list a task was read, added, changed or deleted in', () => {
    const changed = { id: 't1', title: 'Buy milk', status: 'needsAction', selfLink: '', taskList: groceries };

    expect(readAffectedEntities(createTask.id, {}, changed)).toEqual([groceries]);
    expect(readAffectedEntities(updateTask.id, {}, changed)).toEqual([groceries]);
    expect(readAffectedEntities(deleteTask.id, {}, { success: true, message: '', taskList: groceries })).toEqual([
      groceries,
    ]);
    expect(readAffectedEntities(getAllTasks.id, {}, { tasks: [], taskList: groceries })).toEqual([groceries]);
  });

  it('is nothing when the list could not be looked up, or for the list of every list, which is a survey', () => {
    expect(readAffectedEntities(getAllTasks.id, {}, { tasks: [] })).toEqual([]);
    expect(readAffectedEntities(getAllTaskLists.id, {}, { taskLists: [{ ...groceries, selfLink: '' }] })).toEqual([]);
  });
});

/**
 * The task list, when it is looked up only to name the list a tool touched.
 *
 * The task sir asked for is what he is waiting on; the title only lights the list up on his headset.
 * So the lookup is asked once, with no retries, and is given up on at the lookup's time limit -- and
 * the list is then named by the id it was asked for.
 */
describe('the task list, looked up alongside a task being added', () => {
  const ADDED = { id: 't1', title: 'Buy milk', status: 'needsAction', selfLink: 'https://tasks/t1' };

  let google: FakeGoogle | undefined;

  afterEach(() => {
    google?.restore();
    google = undefined;
  });

  /** Adds a task to a list of its own, so no other spec's cached lookup of it can answer. */
  async function addTask(taskListId: string) {
    const startedAt = Date.now();
    const added = await executeTool(createTask, { taskListId, title: 'Buy milk' });
    return { added, elapsedMs: Date.now() - startedAt };
  }

  function lookUps(): URL[] {
    return (google?.requests ?? []).filter((url) => url.pathname.includes('/users/@me/lists/'));
  }

  it('asks once and does not wait on Google retrying a list that fails', async () => {
    google = await fakeGoogle(({ url }) =>
      url.pathname.includes('/users/@me/lists/')
        ? new Response('Service Unavailable', { status: 503 })
        : googleJson(ADDED),
    );

    const { added, elapsedMs } = await addTask('failing-list');

    expect(added.id).toBe('t1');
    expect(added.taskList).toEqual({ id: 'failing-list' });
    expect(lookUps()).toHaveLength(1);
    expect(elapsedMs).toBeLessThan(AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS);
  });

  it('never holds the task up while the lookup hangs', async () => {
    google = await fakeGoogle(({ url, hang }) =>
      url.pathname.includes('/users/@me/lists/') ? hang() : googleJson(ADDED),
    );

    const { added, elapsedMs } = await addTask('hanging-list');

    expect(added.taskList).toEqual({ id: 'hanging-list' });
    expect(elapsedMs).toBeLessThan(AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS + 1_000);
  });

  it('still names the list by its real id and title when the lookup answers', async () => {
    google = await fakeGoogle(({ url }) =>
      url.pathname.includes('/users/@me/lists/')
        ? googleJson({ id: 'MDk1NTEw', title: 'Groceries' })
        : googleJson(ADDED),
    );

    const { added } = await addTask('@default');

    expect(added.taskList).toEqual({ id: 'MDk1NTEw', name: 'Groceries' });
  });
});
