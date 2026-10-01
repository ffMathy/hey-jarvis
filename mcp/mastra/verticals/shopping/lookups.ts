import { asFacts, createDirectLookup } from '../../utils/direct-lookup-factory.js';
import { getCurrentCartContents } from './tools.js';

/**
 * "What is on the shopping list" answered without the agent: the basket as Bilka holds it.
 *
 * The shopping agent only adds and removes, so this is the one question it was never told how to
 * answer. Prices are left out: a spoken shopping list is the things on it. Like any read of the
 * basket, it reports the basket as what it read.
 */
export const shoppingLookups = [
  createDirectLookup({
    id: 'shoppingList.contents',
    agentId: 'shoppingList',
    description: 'What is on the shopping list, or in the grocery basket',
    answer: async (callTool) => {
      const items = await callTool(getCurrentCartContents, {});
      return asFacts({
        items: items.map(({ name, brand, quantity, units, unitsOfMeasure }) => ({
          name,
          brand,
          quantity,
          size: `${units} ${unitsOfMeasure}`,
        })),
      });
    },
  }),
];
