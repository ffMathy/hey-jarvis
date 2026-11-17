import type { Conventions } from '../../knowledge/conventions.js';

/**
 * How the household likes its dinners, kept as the page `conventions:home#cooking`.
 *
 * Only the household's taste is here. How to search Valdemarsro, how a meal plan is shaped and
 * scaled, and what the baby may have stay in the agents' own instructions: code relies on them (the
 * shortlist keeps to dinner recipes, the plan to two of them, three days each), and the baby's advice
 * is reviewed data pinned by `baby-food.spec.ts`.
 *
 * It is read into the instructions of the two agents that choose a dinner, the cooking agent and the
 * meal plan's recipe selector, on every run. The scheduler only portions out the dinners already
 * chosen, so it is not given them.
 */
export const cookingConventions: Conventions = {
  key: 'cooking',
  name: 'Cooking',
  description: 'How the household likes its dinners: what to cook for it, and what to leave off its table.',
  body: '- Avoid weird soups, such as "burgersuppe", "tacosuppe" and "lasagnesuppe".',
};

/** The conventions as a section of an agent's instructions, under the heading its rules point to. */
export function dinnerConventionsSection(conventions: string): string {
  return `# The household's dinner conventions\n${conventions}`;
}
