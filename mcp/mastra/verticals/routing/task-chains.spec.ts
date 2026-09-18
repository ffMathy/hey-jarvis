/**
 * What a plan of tasks runs as.
 *
 * The bug this file exists for was found in production rather than here: a live routing eval
 * watched a to-do reminder be written with a generic lasagna ingredient list while the recipe
 * lookup it depended on was still running. The planner had put both in parallel, and nothing
 * between it and the user disagreed.
 *
 * So what is pinned below is not that the derivation is tidy, but that a declared dependency
 * *sequences* -- and that every way a model can garble the declaration leaves the rest of the
 * request intact, because a plan is one user's whole question and dropping half of it is not a
 * safe failure.
 */

import { describe, expect, it } from 'bun:test';
import { chainsFromTasks, type PlannedTask } from './task-chains.js';

const KNOWN_AGENTS = new Set(['weather', 'calendar', 'cooking', 'todo', 'maps', 'shopping']);

/** Shorthand, so a case reads as its shape rather than as four fields repeated. */
function task(id: string, agentId: string, needs = ''): PlannedTask {
  return { id, agentId, prompt: `Do the ${id} part.`, needs };
}

/** The agent ids a set of chains runs, in order, which is the whole of what a chain decides. */
function shapeOf(chains: ReturnType<typeof chainsFromTasks>): string[][] {
  return chains.map((chain) => chain.delegations.map((delegation) => delegation.agentId));
}

describe('chains derived from a plan of tasks', () => {
  it('runs independent tasks beside each other', () => {
    const chains = chainsFromTasks([task('weather', 'weather'), task('calendar', 'calendar')], KNOWN_AGENTS);

    expect(shapeOf(chains)).toEqual([['weather'], ['calendar']]);
  });

  /** The regression this whole file is for. */
  it('puts a task after the one it needs, rather than beside it', () => {
    const chains = chainsFromTasks([task('todo', 'todo', 'recipe'), task('recipe', 'cooking')], KNOWN_AGENTS);

    expect(shapeOf(chains)).toEqual([['cooking', 'todo']]);
  });

  it('keeps a dependency chain in dependency order however the tasks were listed', () => {
    const chains = chainsFromTasks(
      [task('todo', 'todo', 'recipe'), task('recipe', 'cooking', 'shop'), task('shop', 'shopping')],
      KNOWN_AGENTS,
    );

    expect(shapeOf(chains)).toEqual([['shopping', 'cooking', 'todo']]);
  });

  it('separates a dependent pair from unrelated work', () => {
    const chains = chainsFromTasks(
      [task('location', 'maps'), task('weather', 'weather', 'location'), task('calendar', 'calendar')],
      KNOWN_AGENTS,
    );

    expect(shapeOf(chains)).toEqual([['maps', 'weather'], ['calendar']]);
  });

  it('carries the prompt of every task through to its delegation', () => {
    const chains = chainsFromTasks([task('recipe', 'cooking'), task('todo', 'todo', 'recipe')], KNOWN_AGENTS);

    expect(chains).toEqual([
      {
        delegations: [
          { agentId: 'cooking', prompt: 'Do the recipe part.' },
          { agentId: 'todo', prompt: 'Do the todo part.' },
        ],
      },
    ]);
  });

  describe('when two tasks need the same answer', () => {
    /**
     * A chain carries one answer forward, so the shared task is run once per dependent. The
     * alternative is dropping one of the edges, which is the bug this file exists for.
     */
    it('gives each dependent its own chain, repeating the work they share', () => {
      const chains = chainsFromTasks(
        [task('recipe', 'cooking'), task('todo', 'todo', 'recipe'), task('shop', 'shopping', 'recipe')],
        KNOWN_AGENTS,
      );

      expect(shapeOf(chains)).toEqual([
        ['cooking', 'todo'],
        ['cooking', 'shopping'],
      ]);
    });
  });

  describe('when the planner writes something that does not hold together', () => {
    it('drops a task whose agent does not exist, and keeps the rest', () => {
      const chains = chainsFromTasks(
        [task('weather', 'weather'), task('nonsense', 'agent-that-was-invented'), task('calendar', 'calendar')],
        KNOWN_AGENTS,
      );

      expect(shapeOf(chains)).toEqual([['weather'], ['calendar']]);
    });

    it('still runs a task whose dependency was dropped with its agent', () => {
      const chains = chainsFromTasks(
        [task('ghost', 'agent-that-was-invented'), task('todo', 'todo', 'ghost')],
        KNOWN_AGENTS,
      );

      expect(shapeOf(chains)).toEqual([['todo']]);
    });

    it('still runs a task that needs one nothing in the plan provides', () => {
      const chains = chainsFromTasks([task('todo', 'todo', 'a-task-that-was-never-written')], KNOWN_AGENTS);

      expect(shapeOf(chains)).toEqual([['todo']]);
    });

    it('still runs a task that needs itself', () => {
      const chains = chainsFromTasks([task('todo', 'todo', 'todo')], KNOWN_AGENTS);

      expect(shapeOf(chains)).toEqual([['todo']]);
    });

    it('runs every task of a two-task cycle, by cutting one link', () => {
      const chains = chainsFromTasks([task('recipe', 'cooking', 'todo'), task('todo', 'todo', 'recipe')], KNOWN_AGENTS);

      expect(shapeOf(chains)).toEqual([['cooking', 'todo']]);
    });

    it('runs every task of a longer cycle', () => {
      const chains = chainsFromTasks(
        [task('a', 'weather', 'c'), task('b', 'calendar', 'a'), task('c', 'cooking', 'b')],
        KNOWN_AGENTS,
      );

      expect(shapeOf(chains).flat().sort()).toEqual(['calendar', 'cooking', 'weather']);
    });

    it('runs a task given no id, and one given an id already taken', () => {
      const chains = chainsFromTasks(
        [task('recipe', 'cooking'), task('', 'weather'), task('recipe', 'calendar')],
        KNOWN_AGENTS,
      );

      expect(shapeOf(chains)).toEqual([['cooking'], ['weather'], ['calendar']]);
    });

    it('resolves a dependency on a reused id to the first task that claimed it', () => {
      const chains = chainsFromTasks(
        [task('recipe', 'cooking'), task('recipe', 'calendar'), task('todo', 'todo', 'recipe')],
        KNOWN_AGENTS,
      );

      expect(shapeOf(chains)).toEqual([['cooking', 'todo'], ['calendar']]);
    });

    it('treats surrounding whitespace in an id or a dependency as no part of it', () => {
      const chains = chainsFromTasks([task('  recipe  ', 'cooking'), task('todo', 'todo', ' recipe ')], KNOWN_AGENTS);

      expect(shapeOf(chains)).toEqual([['cooking', 'todo']]);
    });

    it('returns nothing for a plan with nothing runnable in it', () => {
      expect(chainsFromTasks([], KNOWN_AGENTS)).toEqual([]);
      expect(chainsFromTasks([task('nonsense', 'agent-that-was-invented')], KNOWN_AGENTS)).toEqual([]);
    });
  });
});
