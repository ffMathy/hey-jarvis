/**
 * The Valdemarsro lookups a recipe question or a meal plan waits on.
 *
 * A meal plan starts by walking the whole recipe catalogue, which used to be one page after
 * another; a search fetched twenty-five whole recipes for the model to read. These pin what
 * replaced that -- pages read ahead with exactly the old result, recipes and the catalogue reused
 * rather than fetched again, and a shorter search by default -- without touching the network:
 * Valdemarsro is faked at `fetch`, scoped to each test.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { executeTool } from '../../utils/tool-factory.js';
import {
  collectPages,
  getRecipeById,
  getRecipeCatalog,
  type ListingPage,
  resetCookingCachesForTest,
  searchRecipes,
} from './tools.js';

const API_KEY_ENV = 'HEY_JARVIS_VALDEMARSRO_API_KEY';

function valdemarsroRecipe(recipeId: number) {
  return {
    recipe_id: recipeId,
    title: `Opskrift ${recipeId}`,
    description: '<p>Nem aftensmad</p>',
    directions: 'Kog det hele.',
    categories: [{ name: 'Aftensmad' }],
    ingredients: [{ ingrediens: { name: 'løg' }, maengde: '1', enhed: 'stk' }],
    url: `https://www.valdemarsro.dk/${recipeId}`,
    media: `https://www.valdemarsro.dk/${recipeId}.jpg`,
    fields: {},
  };
}

/**
 * A stand-in for `fetch` that hands each request's URL to `handle`, and records it.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
function fakeValdemarsro(handle: (url: URL) => unknown) {
  const paths: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        return new Response(JSON.stringify(handle(url)));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { paths, fetchSpy };
}

/**
 * A listing of `pageCount` pages of `pageSize` numbered items, as the one-page-at-a-time walk
 * saw it: page `i` reports `firstPageNumber + i`, and the walk continues while that is below
 * `maxPages`.
 */
function fakeListing(options: { pageCount: number; pageSize: number; maxPages: number; firstPageNumber?: number }) {
  const requested: number[] = [];
  let inFlight = 0;
  let mostInFlight = 0;

  const fetchPage = async (pageIndex: number): Promise<ListingPage<number>> => {
    requested.push(pageIndex);
    inFlight++;
    mostInFlight = Math.max(mostInFlight, inFlight);
    await Bun.sleep(1);
    inFlight--;

    if (pageIndex >= options.pageCount) {
      throw new Error(`No page ${pageIndex}`);
    }

    const pageNumber = (options.firstPageNumber ?? 0) + pageIndex;
    return {
      items: Array.from({ length: options.pageSize }, (_, offset) => pageIndex * options.pageSize + offset),
      hasNext: pageNumber < options.maxPages,
      pagesAfter: options.maxPages - pageNumber,
    };
  };

  return { fetchPage, requested, mostInFlight: () => mostInFlight };
}

/** What asking for one page after another collects, for comparison. */
async function collectOneAtATime(
  fetchPage: (pageIndex: number) => Promise<ListingPage<number>>,
  amount?: number,
): Promise<number[]> {
  const collected: number[] = [];
  for (let pageIndex = 0; ; pageIndex++) {
    const page = await fetchPage(pageIndex);
    collected.push(...page.items);
    if (amount && collected.length >= amount) {
      return collected.slice(0, amount);
    }
    if (!page.hasNext) {
      return collected;
    }
  }
}

describe('collectPages', () => {
  it('collects every page in order, several at a time', async () => {
    const listing = fakeListing({ pageCount: 11, pageSize: 3, maxPages: 10 });

    const collected = await collectPages(listing.fetchPage, { concurrency: 4 });

    expect(collected).toEqual(
      await collectOneAtATime(fakeListing({ pageCount: 11, pageSize: 3, maxPages: 10 }).fetchPage),
    );
    expect(collected).toHaveLength(33);
    expect(listing.mostInFlight()).toBe(4);
  });

  it('reads the listing numbered from one the same way the one-at-a-time walk did', async () => {
    const listing = fakeListing({ pageCount: 5, pageSize: 2, maxPages: 5, firstPageNumber: 1 });

    const collected = await collectPages(listing.fetchPage, { concurrency: 8 });

    expect(collected).toEqual(
      await collectOneAtATime(fakeListing({ pageCount: 5, pageSize: 2, maxPages: 5, firstPageNumber: 1 }).fetchPage),
    );
    expect(collected).toHaveLength(10);
  });

  it('ignores a page read ahead past the end, failure and all', async () => {
    const listing = fakeListing({ pageCount: 6, pageSize: 2, maxPages: 5 });
    // Overstates what follows, so the read-ahead asks for pages that do not exist.
    const overstated = async (pageIndex: number) => {
      const page = await listing.fetchPage(pageIndex);
      return { ...page, pagesAfter: page.pagesAfter + 3 };
    };

    const collected = await collectPages(overstated, { concurrency: 8 });

    expect(collected).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(listing.requested).toContain(6);
  });

  it('keeps going one page at a time when the listing has more pages than it said', async () => {
    const listing = fakeListing({ pageCount: 4, pageSize: 1, maxPages: 3 });
    // Claims the listing is over when it is not, so every read-ahead window is a single page.
    const understated = async (pageIndex: number) => ({ ...(await listing.fetchPage(pageIndex)), pagesAfter: 0 });

    expect(await collectPages(understated)).toEqual([0, 1, 2, 3]);
  });

  it('stops once it has the amount asked for, without reading far past it', async () => {
    const listing = fakeListing({ pageCount: 50, pageSize: 10, maxPages: 49 });

    const collected = await collectPages(listing.fetchPage, { amount: 25, concurrency: 6 });

    expect(collected).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(Math.max(...listing.requested)).toBeLessThan(4);
  });

  it('fails when a page the walk needs fails', async () => {
    const failing = async (pageIndex: number): Promise<ListingPage<number>> => {
      if (pageIndex === 2) {
        throw new Error('Failed to fetch recipes: Bad Gateway');
      }
      return { items: [pageIndex], hasNext: true, pagesAfter: 10 };
    };

    await expect(collectPages(failing)).rejects.toThrow('Bad Gateway');
  });
});

describe('cooking tools', () => {
  let savedApiKey: string | undefined;

  beforeEach(() => {
    savedApiKey = process.env[API_KEY_ENV];
    process.env[API_KEY_ENV] = 'test-key';
    resetCookingCachesForTest();
  });

  afterEach(() => {
    if (savedApiKey === undefined) {
      delete process.env[API_KEY_ENV];
    } else {
      process.env[API_KEY_ENV] = savedApiKey;
    }
    resetCookingCachesForTest();
  });

  it('fetches a recipe once and then reuses it', async () => {
    const { paths, fetchSpy } = fakeValdemarsro(() => ({ data: valdemarsroRecipe(51796) }));

    const first = await executeTool(getRecipeById, { recipeId: '51796' });
    const second = await executeTool(getRecipeById, { recipeId: '51796' });

    expect(second).toEqual(first);
    expect(first.title).toBe('Opskrift 51796');
    expect(paths).toEqual(['/api/v2/recipes/51796']);
    fetchSpy.mockRestore();
  });

  it('returns the ten most relevant recipes unless asked for more', async () => {
    const { fetchSpy } = fakeValdemarsro((url) => {
      if (url.pathname === '/api/v2/search') {
        return { data: { result: Array.from({ length: 30 }, (_, index) => ({ post_id: index + 1 })) } };
      }
      return { data: valdemarsroRecipe(Number(url.pathname.split('/').pop())) };
    });

    const defaultSearch = await executeTool(searchRecipes, { searchTerm: 'kylling' });
    const longerSearch = await executeTool(searchRecipes, { searchTerm: 'kylling', maxResults: 25 });

    expect(defaultSearch.results.map((recipe) => recipe.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 1),
    );
    expect(longerSearch.results).toHaveLength(25);
    fetchSpy.mockRestore();
  });

  it('walks the catalogue once for repeated meal plans', async () => {
    const { paths, fetchSpy } = fakeValdemarsro((url) => {
      const pageIndex = Number(url.pathname.split('/').pop());
      return {
        data: [valdemarsroRecipe(pageIndex * 2 + 1), valdemarsroRecipe(pageIndex * 2 + 2)],
        pagination: { page: pageIndex, max_pages: 2, urls: {} },
      };
    });

    const first = await executeTool(getRecipeCatalog, {});
    const second = await executeTool(getRecipeCatalog, {});

    expect(first.map((entry) => entry.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(first[0].summary).toBe('Nem aftensmad');
    expect(second).toEqual(first);
    expect(paths).toEqual(['/api/v2/recipes/page/0', '/api/v2/recipes/page/1', '/api/v2/recipes/page/2']);
    fetchSpy.mockRestore();
  });
});
