import { z } from 'zod';
import { extractErrorMessage } from '../../utils/errors.js';
import { createTool } from '../../utils/tool-factory.js';
import { changeProductQuantity, clearCart, getCartContents, searchProductCatalog } from './bilka/client.js';

/**
 * The attribute filters a product search tries, best first.
 *
 * Mirrors the agent's priority hierarchy: Danish organic, EU organic, the keyhole label, Danish
 * origin, European ownership, and finally anything at all.
 */
const ATTRIBUTE_PREFERENCE_ORDER = [
  'Økomærket DK',
  'Økomærket EU',
  'Nøglehulsmærket',
  'Dansk',
  'Europæisk ejerskab',
  undefined,
];

const catalogProductSchema = z.object({
  objectID: z.string(),
  name: z.string(),
  brand: z.string(),
  price: z.number(),
  attributes: z.array(z.string()),
});

type CatalogProduct = z.infer<typeof catalogProductSchema>;

/**
 * The products for one search: those of the most preferred filter that has any.
 *
 * Every filter is asked for in one request and the answers are read in order of preference, so
 * the result is what trying the filters one at a time gave -- which cost a round trip to Algolia
 * for every filter that came back empty, up to six of them for a product nobody certifies.
 */
export async function findPreferredProducts(searchQuery: string): Promise<CatalogProduct[]> {
  const hitsPerFilter = await searchProductCatalog(searchQuery, ATTRIBUTE_PREFERENCE_ORDER);
  const preferredHits = hitsPerFilter.find((hits) => hits.length > 0) ?? [];

  return preferredHits.map((hit) => ({
    objectID: hit.objectID,
    name: hit.name,
    brand: `${hit.brand ?? ''} ${hit.subBrand ?? ''}`.trim(),
    price: hit.price / 100,
    attributes: (hit.attributes ?? []).map((attribute) => attribute.attributeName),
  }));
}

/**
 * Searches for products in the Bilka catalog using Algolia search.
 *
 * Takes a list, because a shopping list is one: a single call searches for every item on it,
 * where one call per item cost the user a model round trip per item.
 */
export const findProductInCatalog = createTool({
  id: 'findProductInCatalog',
  description:
    'Finds products in the catalogue. Search for every product you need in one call, by passing all the search queries together.',
  inputSchema: z.object({
    search_queries: z
      .array(z.string())
      .min(1)
      .describe('The products to search for, in Danish, one query per product. For instance, ["agurk", "mælk"].'),
  }),
  outputSchema: z.array(
    z.object({
      search_query: z.string().describe('The query these products were found for'),
      products: z
        .array(catalogProductSchema)
        .describe('The matching products, the best certified ones only. Empty when nothing was found.'),
    }),
  ),
  execute: async (inputData) =>
    await Promise.all(
      inputData.search_queries.map(async (searchQuery) => ({
        search_query: searchQuery,
        products: await findPreferredProducts(searchQuery),
      })),
    ),
});

const basketChangeResultSchema = z.object({
  product_name: z.string(),
  quantity: z.number(),
  success: z.boolean(),
  message: z.string(),
});

/**
 * Sets the basket quantity for one or more items.
 *
 * Takes a list for the same reason as the search. The changes are still made one after another
 * rather than all at once: they all write to the same cart, and nothing says Bilka's cart
 * endpoint is safe to hit concurrently. What costs the user time is the model round trip per
 * item, not these requests. A failed change is reported beside the others rather than hiding
 * whether they went through.
 */
export const setProductBasketQuantity = createTool({
  id: 'setProductBasketQuantity',
  description:
    'Sets the basket quantity for one or more items. Make every basket change in one call, by passing all of them together.',
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          object_id: z
            .string()
            .describe(
              'The object ID (found by looking at the objectID property) of the product to adjust the basket quantity of. You get the object ID by searching in the catalogue for new items (and taking the `objectID` property of a product in the hits, or from the existing basket contents (and also taking the `objectID` property of the product from there). This object must come from a product in the catalogue, and cannot be made up.',
            ),
          quantity: z
            .number()
            .describe(
              'The quantity of the product. For instance, 2. It replaces the quantity already in the basket, and 0 removes the product.',
            ),
          product_name: z.string().describe('The name of the product.'),
        }),
      )
      .min(1)
      .describe('Every basket change to make'),
  }),
  outputSchema: z.object({
    success: z.boolean().describe('Whether every change was made'),
    results: z.array(basketChangeResultSchema).describe('What happened to each change, in the order given'),
  }),
  execute: async (inputData) => {
    const results: z.infer<typeof basketChangeResultSchema>[] = [];

    for (const item of inputData.items) {
      try {
        await changeProductQuantity(item.object_id, item.quantity, item.product_name);
        results.push({
          product_name: item.product_name,
          quantity: item.quantity,
          success: true,
          message: `Updated ${item.product_name} quantity to ${item.quantity}`,
        });
      } catch (error: unknown) {
        results.push({
          product_name: item.product_name,
          quantity: item.quantity,
          success: false,
          message: extractErrorMessage(error) ?? `Could not update ${item.product_name}`,
        });
      }
    }

    return { success: results.every((result) => result.success), results };
  },
});

/**
 * Gets the current cart contents
 */
export const getCurrentCartContents = createTool({
  id: 'getCurrentCartContents',
  description: 'Retrieves the current shopping cart contents from Bilka.',
  inputSchema: z.object({}),
  outputSchema: z.array(
    z.object({
      objectID: z.string(),
      name: z.string(),
      price: z.number(),
      brand: z.string(),
      units: z.number(),
      unitsOfMeasure: z.string(),
      quantity: z.number(),
      totalPrice: z.number(),
      attributes: z.array(z.string()),
      type: z.string(),
    }),
  ),
  execute: async () => {
    const cartResponse = await getCartContents();
    return cartResponse.lines
      .flatMap((x) => x.lines)
      .flatMap((x) => x.orderlines)
      .filter((x) => x.product.units > 0)
      .map((x) => ({
        objectID: x.product.objectID.toString(),
        name: x.product.name,
        price: x.product.price,
        brand: `${x.product.brand} ${x.product.subBrand}`.trim(),
        units: x.product.units,
        unitsOfMeasure: x.product.unitsOfMeasure,
        quantity: x.quantity,
        totalPrice: x.unitprice * x.quantity,
        attributes: x.product.attributes.map((attr) => attr.attributeName),
        type: x.product.productType,
      }));
  },
});

/**
 * Clears all items from the cart
 */
export const clearCartContents = createTool({
  id: 'clearCartContents',
  description: 'Empties the entire shopping cart.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
  }),
  execute: async () => {
    await clearCart();
    return { success: true };
  },
});

export const shoppingTools = {
  findProductInCatalog,
  setProductBasketQuantity,
  getCurrentCartContents,
  clearCartContents,
};
