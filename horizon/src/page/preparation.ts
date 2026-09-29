import type { PreparationState } from './prerequisites';

/**
 * Getting Jarvis ready before the room is entered: loading what he needs, with one progress bar
 * for all of it.
 *
 * The wake-word models and their runtime are megabytes, and warming them up takes seconds more; a
 * room entered before they are ready would tell the user to say "Hey Jarvis" to something that
 * cannot yet hear it. So they load on the 2D page, from the moment it opens, and the button shows
 * how far along they are. Each task says how big a share of the whole it is (its weight), so a
 * small task finishing does not make the bar leap.
 */

export interface PreparationTask {
  /** For the problem text when it fails: "the wake-word models". */
  name: string;
  /** Its share of the bar, relative to the others. */
  weight: number;
  /** Does the work, reporting its own progress from 0 to 1. */
  run(onProgress: (fraction: number) => void): Promise<void>;
}

/**
 * Runs every task at once, reporting the weighted progress of all of them, and settles on done, or
 * on the first failure.
 *
 * A task that already succeeded in an earlier run is not run again: `completed` is shared between
 * runs, so "try again" only retries what failed.
 */
export async function runPreparation(
  tasks: readonly PreparationTask[],
  onChange: (state: PreparationState) => void,
  completed: Set<PreparationTask> = new Set(),
): Promise<PreparationState> {
  const totalWeight = tasks.reduce((sum, task) => sum + Math.max(0, task.weight), 0);
  const progress = new Map<PreparationTask, number>(tasks.map((task) => [task, completed.has(task) ? 1 : 0]));
  let settled = false;

  const report = () => {
    if (settled) return;
    const done = tasks.reduce((sum, task) => sum + Math.max(0, task.weight) * (progress.get(task) ?? 0), 0);
    onChange({ state: 'running', fraction: totalWeight > 0 ? done / totalWeight : 1 });
  };

  report();
  try {
    await Promise.all(
      tasks
        .filter((task) => !completed.has(task))
        .map(async (task) => {
          try {
            await task.run((fraction) => {
              progress.set(task, Math.max(0, Math.min(1, fraction)));
              report();
            });
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new Error(`Jarvis could not get ready: ${task.name} did not load. ${reason}`.trim());
          }
          completed.add(task);
          progress.set(task, 1);
          report();
        }),
    );
  } catch (error) {
    settled = true;
    const failed: PreparationState = {
      state: 'failed',
      problem: error instanceof Error ? error.message : String(error),
    };
    onChange(failed);
    return failed;
  }
  settled = true;
  const done: PreparationState = { state: 'done' };
  onChange(done);
  return done;
}
