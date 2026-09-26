import { z } from 'zod';
import { authenticateWithBilka } from './auth.js';
import type { BilkaCartResponse } from './types.js';

/**
 * The product fields a catalogue search asks Algolia for.
 *
 * Only what `findProductInCatalog` hands the model. Descriptions, images and nutrition tables
 * used to be fetched and parsed as well, only for the tool's output schema to drop them, and a
 * search now asks for several filtered result lists at once.
 */
const CATALOG_ATTRIBUTES_TO_RETRIEVE = ['objectID', 'name', 'brand', 'subBrand', 'price', 'attributes'];

const catalogHitSchema = z.object({
  objectID: z.string(),
  name: z.string(),
  brand: z.string().nullish(),
  subBrand: z.string().nullish(),
  /** In øre. */
  price: z.number(),
  attributes: z.array(z.object({ attributeName: z.string() })).nullish(),
});

export type CatalogHit = z.infer<typeof catalogHitSchema>;

const catalogSearchResponseSchema = z.object({
  results: z.array(z.object({ hits: z.array(catalogHitSchema) })),
});

/**
 * Searches the Bilka catalogue once per attribute filter, in a single request.
 *
 * Algolia's multi-query endpoint runs every query in the body and answers them together, so
 * asking for the organic, the Danish and the unfiltered results costs one round trip rather
 * than one per filter.
 *
 * @param searchQuery - What to search for
 * @param attributeFilters - One query per entry; `undefined` searches without a filter
 * @returns The hits of each query, in the order of `attributeFilters`
 */
export async function searchProductCatalog(
  searchQuery: string,
  attributeFilters: ReadonlyArray<string | undefined>,
): Promise<CatalogHit[][]> {
  const requestBody = {
    requests: attributeFilters.map((attributeName) => ({
      indexName: 'prod_BILKATOGO_PRODUCTS',
      params: [
        `attributesToRetrieve=${encodeURIComponent(JSON.stringify(CATALOG_ATTRIBUTES_TO_RETRIEVE))}`,
        `query=${encodeURIComponent(searchQuery)}`,
        `distinct=false`,
        `page=0`,
        `hitsPerPage=15`,
        `facets=${encodeURIComponent(JSON.stringify([]))}`,
        `clickAnalytics=true`,
        `analyticsTags=${encodeURIComponent(JSON.stringify([]))}`,
        `userToken=${process.env.HEY_JARVIS_BILKA_USER_TOKEN}`,
        `getRankingInfo=false`,
        attributeName && `filters=${encodeURIComponent(`attributes.attributeName:"${attributeName}"`)}`,
      ]
        .filter((x) => !!x)
        .join('&'),
    })),
    strategy: 'none',
  };

  const response = await fetch(
    'https://f9vbjlr1bk-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=Algolia%20for%20JavaScript%20(4.14.3)%3B%20Browser',
    {
      method: 'POST',
      headers: {
        'X-Algolia-Api-Key': process.env.HEY_JARVIS_ALGOLIA_API_KEY!,
        'X-Algolia-Application-Id': process.env.HEY_JARVIS_ALGOLIA_APPLICATION_ID!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status} ${response.statusText}`);
  }

  const { results } = catalogSearchResponseSchema.parse(await response.json());
  return results.map((result) => result.hits);
}

/**
 * Changes the quantity of a product in the cart
 */
export async function changeProductQuantity(objectId: string, quantity: number, productName: string): Promise<unknown> {
  const jwtToken = await authenticateWithBilka();

  const url = `https://api.bilkatogo.dk/api/shop/v6/ChangeLineCount?u=w&productId=${encodeURIComponent(objectId)}&count=${quantity}&fullCart=0&name=${encodeURIComponent(productName)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      jwt_token: jwtToken.jwtToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to set basket quantity: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Retrieves the current cart contents from Bilka
 */
export async function getCartContents(): Promise<BilkaCartResponse> {
  const jwtToken = await authenticateWithBilka();

  const response = await fetch('https://api.bilkatogo.dk/api/shop/v6/Cart?u=w&extra=deliveryAddress,deliveryDate', {
    method: 'GET',
    headers: {
      jwt_token: jwtToken.jwtToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get cart contents: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as BilkaCartResponse;
}

/**
 * Empties the entire shopping cart
 */
export async function clearCart(): Promise<unknown> {
  const jwtToken = await authenticateWithBilka();

  const response = await fetch('https://api.bilkatogo.dk/api/shop/v6/EmptyCart', {
    method: 'GET',
    headers: {
      jwt_token: jwtToken.jwtToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to clear cart: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}
