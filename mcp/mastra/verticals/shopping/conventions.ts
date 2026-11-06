import type { Conventions } from '../../knowledge/conventions.js';

/**
 * How the household shops: which product it means by a name on the list, and which of several
 * products it prefers. Kept at `conventions:home#shopping`, where the shopping list agent reads it
 * on every run and adds what sir says from now on as notes.
 *
 * Only the household's own taste is here. What is true of every shop — that products are named in
 * Danish, the markers an organic product carries, the priority hierarchy, which
 * `ATTRIBUTE_PREFERENCE_ORDER` in `tools.ts` enforces as well — stays in the agent's instructions,
 * and so do the rules for herbs, quantities and searching.
 *
 * Only the shopping list agent reads it. The shopping workflow's mutator agent and the product
 * choice classifier never had these, so giving them the page would change what they choose.
 */
export const shoppingConventions: Conventions = {
  key: 'shopping',
  name: 'Shopping',
  description: 'Which product the household means by a name on its shopping list, and which of several it prefers.',
  body: `- **Soja** → Sojasauce
- **Rødkål** → Rød spidskål
- **Kyllingefillet** → Kyllingebrystfillet
- **Soltørrede tomater i olie** → Soltørrede tomater
- **Juice:** Avoid juice from concentrate.
- **Milk:** Always use "skummetmælk" if available
- **Cheese:** If asked to just buy cheese, buy solid cheese, but in slices.`,
};
