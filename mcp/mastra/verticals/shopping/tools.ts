import { z } from 'zod';
import { createTool } from '../../utils/tool-factory.js';
import { changeProductQuantity, clearCart, getCartContents, searchProductCatalog } from './bilka/client.js';
import type { CatalogProduct } from './bilka/types.js';

/**
 * Searches for products in the Bilka catalog using Algolia search
 */
export const findProductInCatalog = createTool({
  id: 'findProductInCatalog',
  description: 'Finds a certain product in the catalogue.',
  inputSchema: z.object({
    search_query: z.string().describe('The product to search for, in Danish. For instance, "agurk".'),
  }),
  outputSchema: z.array(
    z.object({
      objectID: z.string(),
      name: z.string(),
      brand: z.string(),
      price: z.number(),
      attributes: z.array(z.string()),
    }),
  ),
  execute: async (inputData) => {
    const attributeNameOrder = ['Økomærket DK', 'Økomærket EU', 'Nøglehulsmærket', 'Dansk', 'Europæisk ejerskab', ''];

    for (const attributeName of attributeNameOrder) {
      const response = await searchProductCatalog(inputData.search_query, attributeName || undefined);
      const results = response.results
        .flatMap((x) => x.hits)
        .map((hit) => {
          const result = {
            ...hit,
            brand: `${hit.brand} ${hit.subBrand}`.trim(),
            attributes: hit.attributes.map((attr) => attr.attributeName),
            price: hit.price / 100,
          };

          delete result['_highlightResult'];
          delete result['subBrand'];

          return result as Omit<CatalogProduct, 'subBrand' | 'attributes'> & {
            attributes: string[];
          };
        });

      if (results.length > 0) {
        return results;
      }
    }

    return [];
  },
});

/**
 * Sets the basket quantity for a certain item
 */
export const setProductBasketQuantity = createTool({
  id: 'setProductBasketQuantity',
  description: 'Sets the basket quantity for a certain item.',
  inputSchema: z.object({
    object_id: z
      .string()
      .describe(
        'The object ID (found by looking at the objectID property) of the product to adjust the basket quantity of. You get the object ID by searching in the catalogue for new items (and taking the `objectID` property of a product in the hits, or from the existing basket contents (and also taking the `objectID` property of the product from there). This object must come from a product in the catalogue, and cannot be made up.',
      ),
    quantity: z.number().describe('The quantity of the product. For instance, 2.'),
    product_name: z.string().describe('The name of the product.'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
  }),
  execute: async (inputData) => {
    const result = await changeProductQuantity(inputData.object_id, inputData.quantity, inputData.product_name);
    return {
      success: true,
      message: `Updated ${inputData.product_name} quantity to ${inputData.quantity}`,
    };
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
