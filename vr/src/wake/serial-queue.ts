/**
 * One task at a time, in order, dropping the oldest audio when it falls behind.
 *
 * Every chunk runs three graphs, each awaiting onnxruntime-web, and the pipeline's buffers are
 * shared between chunks, so two chunks must never be in flight at once — and a reset must land
 * between chunks, never in the middle of one. If the worker cannot keep up (a slow headset, a
 * garbage collection, the first frames of the room), chunks pile up; rather than fall further
 * and further behind the user's voice, the oldest waiting chunk is dropped once more than a few
 * are waiting. Tasks that are not droppable — a reset — are never dropped.
 */

/** Waiting tasks (not counting the one running) beyond which the oldest droppable one goes. */
export const MAXIMUM_WAITING = 3;

export interface SerialQueueOptions<Task> {
  run(task: Task): Promise<void>;
  isDroppable(task: Task): boolean;
  onDropped(task: Task): void;
  onError(error: unknown): void;
  maximumWaiting?: number;
}

export interface SerialQueue<Task> {
  add(task: Task): void;
  /** Tasks waiting, not counting the one running. */
  readonly waiting: number;
  /** Resolves once nothing is running or waiting. */
  idle(): Promise<void>;
}

export function createSerialQueue<Task>(options: SerialQueueOptions<Task>): SerialQueue<Task> {
  const maximumWaiting = options.maximumWaiting ?? MAXIMUM_WAITING;
  const waiting: Task[] = [];
  let running: Promise<void> | undefined;

  function dropOldest() {
    const index = waiting.findIndex((task) => options.isDroppable(task));
    if (index === -1) return false;
    const [dropped] = waiting.splice(index, 1);
    options.onDropped(dropped);
    return true;
  }

  async function drain() {
    for (let task = waiting.shift(); task !== undefined; task = waiting.shift()) {
      try {
        await options.run(task);
      } catch (error) {
        options.onError(error);
      }
    }
    running = undefined;
  }

  return {
    add(task) {
      waiting.push(task);
      while (waiting.length > maximumWaiting) {
        if (!dropOldest()) break;
      }
      running ??= drain();
    },
    get waiting() {
      return waiting.length;
    },
    async idle() {
      while (running !== undefined) await running;
    },
  };
}
