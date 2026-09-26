/**
 * The Bilka calls a shopping request waits on.
 *
 * "Add milk, eggs and rye bread" used to search the catalogue up to six times per product, one
 * filter after another, then change the basket one product per model round trip. These pin what
 * replaced that: one catalogue request per product that still answers with the most preferred
 * filter's products, list-shaped tools, basket changes made in order, and one sign-in shared by
 * every caller that needs it at the same time.
 *
 * Bilka, Algolia and Gigya are faked at `fetch`, scoped to each test.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { z } from 'zod';
import { executeTool } from '../../utils/tool-factory.js';
import { authenticateWithBilka, resetBilkaSignInForTest } from './bilka/auth.js';
import { findProductInCatalog, setProductBasketQuantity } from './tools.js';

const BILKA_ENV = [
  'HEY_JARVIS_BILKA_EMAIL',
  'HEY_JARVIS_BILKA_PASSWORD',
  'HEY_JARVIS_BILKA_API_KEY',
  'HEY_JARVIS_BILKA_USER_TOKEN',
  'HEY_JARVIS_ALGOLIA_API_KEY',
  'HEY_JARVIS_ALGOLIA_APPLICATION_ID',
] as const;

const algoliaRequestSchema = z.object({ requests: z.array(z.object({ params: z.string() })) });

/**
 * A stand-in for `fetch` that hands each request's URL and body to `handle`.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
function fakeFetch(handle: (url: string, body: string) => Response | Promise<Response>): typeof fetch {
  return Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      await handle(String(input), String(init?.body ?? '')),
    { preconnect: globalThis.fetch.preconnect },
  );
}

/** The attribute filter an Algolia query carries, or `undefined` for an unfiltered one. */
function filterOf(params: string): string | undefined {
  const filter = new URLSearchParams(params).get('filters');
  return filter?.match(/attributeName:"(.*)"/)?.[1];
}

function catalogHit(objectID: string, name: string, attributeNames: string[]) {
  return {
    objectID,
    name,
    brand: 'Brand',
    subBrand: 'Sub',
    price: 1295,
    attributes: attributeNames.map((attributeName) => ({ attributeName })),
  };
}

/** Answers catalogue searches with `hitsFor(query, filter)`, and signs in anyone who asks. */
function fakeBilka(options: {
  hitsFor?: (query: string, filter: string | undefined) => unknown[];
  changeLine?: (productId: string) => Response | Promise<Response>;
}) {
  const algoliaFilters: Array<Array<string | undefined>> = [];
  const logins: string[] = [];
  const changedProducts: string[] = [];

  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    fakeFetch(async (url, body) => {
      if (url.includes('algolia.net')) {
        const { requests } = algoliaRequestSchema.parse(JSON.parse(body));
        algoliaFilters.push(requests.map((request) => filterOf(request.params)));
        const results = requests.map((request) => ({
          hits:
            options.hitsFor?.(new URLSearchParams(request.params).get('query') ?? '', filterOf(request.params)) ?? [],
        }));
        return new Response(JSON.stringify({ results }));
      }

      if (url.includes('accounts.login')) {
        logins.push(url);
        return new Response(JSON.stringify({ sessionInfo: { cookieValue: 'cookie', cookieName: 'session' } }));
      }

      if (url.includes('accounts.getJWT')) {
        return new Response(JSON.stringify({ id_token: 'jwt' }));
      }

      if (url.includes('ChangeLineCount')) {
        const productId = new URL(url).searchParams.get('productId') ?? '';
        changedProducts.push(productId);
        return (await options.changeLine?.(productId)) ?? new Response('{}');
      }

      throw new Error(`Unexpected request to ${url}`);
    }),
  );

  return { algoliaFilters, logins, changedProducts, fetchSpy };
}

describe('Bilka shopping tools', () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of BILKA_ENV) {
      saved.set(name, process.env[name]);
      process.env[name] = 'test-value';
    }
    resetBilkaSignInForTest();
  });

  afterEach(() => {
    for (const name of BILKA_ENV) {
      const value = saved.get(name);
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    resetBilkaSignInForTest();
  });

  describe('findProductInCatalog', () => {
    it('asks for every filter in one request and answers with the most preferred one that has products', async () => {
      const { algoliaFilters, fetchSpy } = fakeBilka({
        hitsFor: (_query, filter) => {
          if (filter === 'Dansk') {
            return [catalogHit('danish-milk', 'Dansk mælk', ['Dansk'])];
          }
          return filter === undefined ? [catalogHit('any-milk', 'Mælk', [])] : [];
        },
      });

      const searches = await executeTool(findProductInCatalog, { search_queries: ['mælk'] });

      expect(algoliaFilters).toEqual([
        ['Økomærket DK', 'Økomærket EU', 'Nøglehulsmærket', 'Dansk', 'Europæisk ejerskab', undefined],
      ]);
      expect(searches).toEqual([
        {
          search_query: 'mælk',
          products: [
            { objectID: 'danish-milk', name: 'Dansk mælk', brand: 'Brand Sub', price: 12.95, attributes: ['Dansk'] },
          ],
        },
      ]);
      fetchSpy.mockRestore();
    });

    it('searches for every product in one call, each answered on its own', async () => {
      const { algoliaFilters, fetchSpy } = fakeBilka({
        hitsFor: (query, filter) => (query === 'æg' && filter === undefined ? [catalogHit('eggs', 'Æg', [])] : []),
      });

      const searches = await executeTool(findProductInCatalog, { search_queries: ['æg', 'dragefrugt'] });

      expect(algoliaFilters).toHaveLength(2);
      expect(searches.map((search) => search.search_query)).toEqual(['æg', 'dragefrugt']);
      expect(searches[0].products.map((product) => product.objectID)).toEqual(['eggs']);
      expect(searches[1].products).toEqual([]);
      fetchSpy.mockRestore();
    });
  });

  describe('setProductBasketQuantity', () => {
    it('makes every change in the order given, one at a time, and reports a failed one beside the rest', async () => {
      let inFlight = 0;
      let mostInFlight = 0;
      const { changedProducts, fetchSpy } = fakeBilka({
        changeLine: async (productId) => {
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);
          await Bun.sleep(1);
          inFlight--;
          return productId === 'sold-out'
            ? new Response('nope', { status: 500, statusText: 'Internal Server Error' })
            : new Response('{}');
        },
      });

      const result = await executeTool(setProductBasketQuantity, {
        items: [
          { object_id: 'milk', quantity: 2, product_name: 'Mælk' },
          { object_id: 'sold-out', quantity: 1, product_name: 'Udsolgt' },
          { object_id: 'eggs', quantity: 0, product_name: 'Æg' },
        ],
      });

      expect(changedProducts).toEqual(['milk', 'sold-out', 'eggs']);
      expect(mostInFlight).toBe(1);
      expect(result.success).toBe(false);
      expect(result.results.map((change) => change.success)).toEqual([true, false, true]);
      expect(result.results[1].message).toContain('500');
      fetchSpy.mockRestore();
    });
  });

  describe('authenticateWithBilka', () => {
    it('signs in once for callers that arrive together, and reuses the sign-in afterwards', async () => {
      const { logins, fetchSpy } = fakeBilka({});

      const tokens = await Promise.all([authenticateWithBilka(), authenticateWithBilka(), authenticateWithBilka()]);
      await authenticateWithBilka();

      expect(logins).toHaveLength(1);
      expect(tokens.map((token) => token.jwtToken)).toEqual(['jwt', 'jwt', 'jwt']);
      fetchSpy.mockRestore();
    });
  });
});
