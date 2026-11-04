/**
 * The meal plan, run for real on a Mastra instance, with only the outside world faked: Valdemarsro
 * at `fetch`, and the model as a script that records what each agent is told.
 *
 * What it pins is that the baby reaches the agents as old as it is on the day the plan is made,
 * not as old as it was when the server started — the server stays up for days — and that a
 * household without a baby gets a plan with no baby in it.
 *
 * The birth date here is made up. The household's own is kept in 1Password, never in the repository.
 */

import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { Mastra } from '@mastra/core';
import { fakeValdemarsro, valdemarsroRecipe } from '../../../tests/utils/fake-valdemarsro.js';
import { createScriptedModel } from '../../../tests/utils/scripted-model.js';
import { BABY_BIRTH_DATE_VARIABLE } from './baby-food.js';
import { resetCookingCachesForTest } from './tools.js';
import { buildGenerateMealPlanWorkflow } from './workflows.js';

const API_KEY_VARIABLE = 'HEY_JARVIS_VALDEMARSRO_API_KEY';
const EXAMPLE_BIRTH_DATE = '2025-03-15';

const SELECTOR_INSTRUCTIONS = 'You are a recipe selection specialist.';
const SCHEDULER_INSTRUCTIONS = 'You are a meal scheduling specialist.';

const recipes = [
  valdemarsroRecipe(1, { title: 'Ovnbagt laks med kartofler' }),
  valdemarsroRecipe(2, { title: 'Kyllingegryde med ris' }),
  valdemarsroRecipe(3, { title: 'Frikadeller med kartofler og grønt' }),
];

/** What the scheduler hands back: both recipes, each with the direction for the baby. */
const scheduledPlan = {
  mealplan: [1, 2].map((recipeId, index) => ({
    days: index === 0 ? ['Mandag', 'Tirsdag', 'Onsdag'] : ['Torsdag', 'Fredag', 'Lørdag'],
    recipe: {
      title: `Opskrift ${recipeId}`,
      ingredients: ['1 stk løg'],
      directions: ['Kog det hele.', 'Til baby: Tag barnets portion fra, før der saltes, og mos den groft.'],
      imageUrl: `https://www.valdemarsro.dk/${recipeId}.jpg`,
      url: `https://www.valdemarsro.dk/${recipeId}`,
    },
  })),
};

function mealPlanHarness() {
  const scripted = createScriptedModel((call) =>
    call.transcript.includes(SELECTOR_INSTRUCTIONS)
      ? { text: JSON.stringify({ selectedRecipeIds: [1, 2] }) }
      : { text: JSON.stringify(scheduledPlan) },
  );
  const mastra = new Mastra({ workflows: { generateMealPlanWorkflow: buildGenerateMealPlanWorkflow(scripted.model) } });

  /** Makes the meal plan as if it were `instant`, and returns what each agent was told. */
  async function planAt(instant: string) {
    setSystemTime(new Date(instant));
    const callsBefore = scripted.calls.length;

    const run = await mastra.getWorkflow('generateMealPlanWorkflow').createRun();
    const result = await run.start({ inputData: {} });

    const calls = scripted.calls.slice(callsBefore);
    const toldTo = (instructions: string) =>
      calls.find((call) => call.transcript.includes(instructions))?.transcript ?? '';

    return { result, selector: toldTo(SELECTOR_INSTRUCTIONS), scheduler: toldTo(SCHEDULER_INSTRUCTIONS) };
  }

  return { planAt };
}

describe('generateMealPlanWorkflow', () => {
  const saved = new Map<string, string | undefined>();
  let valdemarsro: ReturnType<typeof fakeValdemarsro>;

  beforeEach(() => {
    for (const variable of [API_KEY_VARIABLE, BABY_BIRTH_DATE_VARIABLE]) {
      saved.set(variable, process.env[variable]);
    }
    process.env[API_KEY_VARIABLE] = 'test-key';
    resetCookingCachesForTest();

    valdemarsro = fakeValdemarsro((url) => {
      if (url.pathname.startsWith('/api/v2/recipes/page/')) {
        return { data: recipes, pagination: { page: 0, max_pages: 0, urls: {} } };
      }
      const recipeId = Number(url.pathname.split('/').pop());
      return { data: recipes.find((recipe) => recipe.recipe_id === recipeId) };
    });
  });

  afterEach(() => {
    valdemarsro.fetchSpy.mockRestore();
    setSystemTime();
    resetCookingCachesForTest();
    for (const [variable, value] of saved) {
      if (value === undefined) {
        delete process.env[variable];
      } else {
        process.env[variable] = value;
      }
    }
  });

  it('tells both agents how old the baby is on the day each plan is made', async () => {
    process.env[BABY_BIRTH_DATE_VARIABLE] = EXAMPLE_BIRTH_DATE;
    const { planAt } = mealPlanHarness();

    const atSixMonths = await planAt('2025-09-21T06:00:00Z');
    const atNineMonths = await planAt('2025-12-21T07:00:00Z');

    expect(atSixMonths.result.status).toBe('success');
    for (const toldTo of [atSixMonths.selector, atSixMonths.scheduler]) {
      expect(toldTo).toContain('6 months old');
      expect(toldTo).toContain('No honey');
      expect(toldTo).toContain('fried fish waits until it is 9 months');
    }
    expect(atSixMonths.scheduler).toContain('"Til baby:"');

    // The same workflow, built once, three months on: the advice has moved with the baby.
    expect(atNineMonths.result.status).toBe('success');
    expect(atNineMonths.selector).toContain('9 months old');
    expect(atNineMonths.scheduler).toContain('9 months old');
    expect(atNineMonths.scheduler).not.toContain('fried fish waits');
    expect(atNineMonths.scheduler).toContain('fried or roasted edges cut away');
  });

  it('plans adult dinners with no baby in them when no birth date is configured', async () => {
    delete process.env[BABY_BIRTH_DATE_VARIABLE];
    const { planAt } = mealPlanHarness();

    const plan = await planAt('2025-09-21T06:00:00Z');

    expect(plan.result.status).toBe('success');
    expect(plan.selector).toContain(SELECTOR_INSTRUCTIONS);
    expect(plan.scheduler).toContain(SCHEDULER_INSTRUCTIONS);
    for (const toldTo of [plan.selector, plan.scheduler]) {
      expect(toldTo).not.toContain('# The baby');
      expect(toldTo).not.toContain('Til baby');
    }
  });

  it('fails rather than plan for adults when the birth date cannot be read', async () => {
    process.env[BABY_BIRTH_DATE_VARIABLE] = '15/03/2025';
    const { planAt } = mealPlanHarness();

    const plan = await planAt('2025-09-21T06:00:00Z');

    expect(plan.result.status).toBe('failed');
    expect(plan.selector).toBe('');
  });
});
