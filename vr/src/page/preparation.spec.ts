import { describe, expect, it } from 'bun:test';
import { type PreparationTask, runPreparation } from './preparation';
import type { PreparationState } from './prerequisites';

/** A task the test finishes by hand, reporting progress when told. */
function manualTask(name: string, weight: number) {
  let report: (fraction: number) => void = () => undefined;
  let finish: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  let runs = 0;
  const task: PreparationTask = {
    name,
    weight,
    run(onProgress) {
      runs += 1;
      report = onProgress;
      return new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    },
  };
  return {
    task,
    progress: (fraction: number) => report(fraction),
    finish: () => finish(),
    fail: (message: string) => fail(new Error(message)),
    get runs() {
      return runs;
    },
  };
}

function recorder() {
  const states: PreparationState[] = [];
  return { states, onChange: (state: PreparationState) => states.push(state) };
}

describe('runPreparation', () => {
  it('is done at once with nothing to prepare', async () => {
    const { states, onChange } = recorder();
    expect(await runPreparation([], onChange)).toEqual({ state: 'done' });
    expect(states).toEqual([{ state: 'running', fraction: 1 }, { state: 'done' }]);
  });

  it('weighs each task’s progress by its share', async () => {
    const models = manualTask('the wake-word models', 3);
    const drawing = manualTask('the drawing', 1);
    const { states, onChange } = recorder();
    const running = runPreparation([models.task, drawing.task], onChange);
    models.progress(0.5);
    drawing.finish();
    await Promise.resolve();
    await Promise.resolve();
    models.finish();
    expect(await running).toEqual({ state: 'done' });
    expect(states).toEqual([
      { state: 'running', fraction: 0 },
      { state: 'running', fraction: 0.375 },
      { state: 'running', fraction: 0.625 },
      { state: 'running', fraction: 1 },
      { state: 'done' },
    ]);
  });

  it('fails with the task’s name and reason, and reports nothing after', async () => {
    const models = manualTask('the wake-word models', 1);
    const drawing = manualTask('the drawing', 1);
    const { states, onChange } = recorder();
    const running = runPreparation([models.task, drawing.task], onChange);
    models.fail('HTTP 404');
    const result = await running;
    expect(result).toEqual({
      state: 'failed',
      problem: 'Jarvis could not get ready: the wake-word models did not load. HTTP 404',
    });
    drawing.progress(0.9);
    expect(states.at(-1)).toEqual(result);
  });

  it('only runs again what did not finish', async () => {
    const models = manualTask('the wake-word models', 1);
    const drawing = manualTask('the drawing', 1);
    const completed = new Set<PreparationTask>();
    const first = runPreparation([models.task, drawing.task], () => undefined, completed);
    drawing.finish();
    await Promise.resolve();
    await Promise.resolve();
    models.fail('offline');
    await first;

    const { states, onChange } = recorder();
    const second = runPreparation([models.task, drawing.task], onChange, completed);
    models.finish();
    expect(await second).toEqual({ state: 'done' });
    expect(drawing.runs).toBe(1);
    expect(models.runs).toBe(2);
    expect(states[0]).toEqual({ state: 'running', fraction: 0.5 });
  });
});
