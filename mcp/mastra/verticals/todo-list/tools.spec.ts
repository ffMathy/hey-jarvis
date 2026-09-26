/**
 * The parts of the task tools that decide how much a request costs: finding the one task to act
 * on without reading the whole list back, and changing it with a patch that carries only what
 * changed. Neither reaches Google.
 */

import { describe, expect, it } from 'bun:test';
import { buildTaskPatch, filterTasks, type TaskSummary } from './tools.js';

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
