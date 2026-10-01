import { describe, expect, it } from 'bun:test';
import { createSerialQueue } from './serial-queue';

type Task = { kind: 'chunk'; id: number } | { kind: 'reset' };

/** A queue whose tasks finish only when the test says so, recording what ran and what was dropped. */
function controlledQueue(maximumWaiting?: number) {
  const started: string[] = [];
  const dropped: string[] = [];
  const errors: unknown[] = [];
  const finishers: Array<() => void> = [];
  const name = (task: Task) => (task.kind === 'chunk' ? `chunk ${task.id}` : 'reset');
  const queue = createSerialQueue<Task>({
    run(task) {
      started.push(name(task));
      if (task.kind === 'chunk' && task.id < 0) return Promise.reject(new Error('graph failed'));
      return new Promise<void>((resolve) => finishers.push(resolve));
    },
    isDroppable: (task) => task.kind === 'chunk',
    onDropped: (task) => dropped.push(name(task)),
    onError: (error) => errors.push(error),
    maximumWaiting,
  });
  async function finishNext() {
    finishers.shift()?.();
    // Let the queue's loop pick up the next task.
    await Promise.resolve();
    await Promise.resolve();
  }
  return { queue, started, dropped, errors, finishNext };
}

describe('the serial queue', () => {
  it('runs one task at a time, in order', async () => {
    const { queue, started, finishNext } = controlledQueue();
    queue.add({ kind: 'chunk', id: 1 });
    queue.add({ kind: 'chunk', id: 2 });
    expect(started).toEqual(['chunk 1']);
    expect(queue.waiting).toBe(1);
    await finishNext();
    expect(started).toEqual(['chunk 1', 'chunk 2']);
    await finishNext();
    await queue.idle();
    expect(queue.waiting).toBe(0);
  });

  it('drops the oldest waiting chunk once more than three are waiting', async () => {
    const { queue, started, dropped, finishNext } = controlledQueue();
    for (let id = 1; id <= 6; id++) queue.add({ kind: 'chunk', id });
    // Chunk 1 is running; 2 and 3 were dropped to keep 4, 5 and 6.
    expect(dropped).toEqual(['chunk 2', 'chunk 3']);
    expect(queue.waiting).toBe(3);
    for (let step = 0; step < 4; step++) await finishNext();
    expect(started).toEqual(['chunk 1', 'chunk 4', 'chunk 5', 'chunk 6']);
  });

  it('never drops a reset, and runs it between the chunks around it', async () => {
    const { queue, started, dropped, finishNext } = controlledQueue();
    queue.add({ kind: 'chunk', id: 1 });
    queue.add({ kind: 'reset' });
    for (let id = 2; id <= 5; id++) queue.add({ kind: 'chunk', id });
    expect(dropped).toEqual(['chunk 2', 'chunk 3']);
    for (let step = 0; step < 4; step++) await finishNext();
    expect(started).toEqual(['chunk 1', 'reset', 'chunk 4', 'chunk 5']);
  });

  it('keeps going after a task fails, and reports the failure', async () => {
    const { queue, started, errors, finishNext } = controlledQueue();
    queue.add({ kind: 'chunk', id: -1 });
    queue.add({ kind: 'chunk', id: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['chunk -1', 'chunk 2']);
    expect(errors).toHaveLength(1);
    await finishNext();
    await queue.idle();
  });

  it('takes its limit as an option', () => {
    const { queue, dropped } = controlledQueue(1);
    for (let id = 1; id <= 4; id++) queue.add({ kind: 'chunk', id });
    expect(dropped).toEqual(['chunk 2', 'chunk 3']);
  });
});
